/**
 * Maps AutoTrader's advert payload onto our ListingDetail model.
 *
 * Every field here is optional on their side — `vehicleCheck` is missing on a
 * large share of adverts, `priceIndicator` is often "NOANALYSIS", and dealers
 * routinely omit service history. Nothing in here may throw on a missing field:
 * a half-populated listing is far more useful than a failed fetch.
 */

import type { RawAdvert } from './detail';
import type {
  CheckStatus,
  ListingDetail,
  PriceIndicator,
  ServiceHistory,
  Transmission,
} from '../types';

const PRICE_INDICATORS: PriceIndicator[] = ['GREAT', 'GOOD', 'FAIR', 'HIGH', 'LOW', 'NOANALYSIS'];
const SERVICE_HISTORIES: ServiceHistory[] = ['FULL', 'PART', 'NO_HISTORY', 'UNKNOWN'];

function keySpecs(advert: RawAdvert): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const item of advert.keySpecification ?? []) {
    if (item?.specKey && typeof item.value === 'string') specs[item.specKey] = item.value;
  }
  return specs;
}

/** "1.5L" -> 1.5 */
export function parseEngineLitres(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)\s*L/i);
  return match?.[1] ? Number(match[1]) : null;
}

/** "2016 (66 reg)" -> "66" */
function parsePlateReg(value: string | undefined): string | null {
  return value?.match(/\(([^)]+?)\s*reg\)/i)?.[1] ?? null;
}

function parseTransmission(value: string | undefined): Transmission | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes('auto')) return 'Automatic';
  if (lower.includes('manual')) return 'Manual';
  return null;
}

function asPriceIndicator(value: unknown): PriceIndicator {
  return PRICE_INDICATORS.includes(value as PriceIndicator)
    ? (value as PriceIndicator)
    : 'NOANALYSIS';
}

function asServiceHistory(value: unknown): ServiceHistory {
  return SERVICE_HISTORIES.includes(value as ServiceHistory)
    ? (value as ServiceHistory)
    : 'UNKNOWN';
}

/**
 * Reads one entry out of `history.vehicleCheck.basicChecks`.
 * Absent block or absent check both mean UNKNOWN, never PASSED — we must not
 * report a car as "not written off" on the strength of missing data.
 */
export function checkStatus(advert: RawAdvert, id: string): CheckStatus {
  const checks = advert.history?.vehicleCheck?.basicChecks;
  if (!Array.isArray(checks)) return 'UNKNOWN';
  const status = checks.find((c: any) => c?.id === id)?.status;
  return status === 'PASSED' || status === 'FAILED' ? status : 'UNKNOWN';
}

/**
 * Some dealer groups leak the plate in their own deep-link, e.g.
 * `...?vehicleid=123&VRM=YT66CNK`. Most don't, so this is a bonus that saves
 * typing rather than something to rely on.
 */
export function extractVrm(advert: RawAdvert): string | null {
  const candidates = [advert.seller?.contact?.website, advert.contactDetails?.website];
  for (const url of candidates) {
    if (typeof url !== 'string') continue;
    const match = url.match(/[?&]vrm=([A-Za-z0-9]{2,8})\b/i);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** Roughly the longest advert text worth keeping; the tail is boilerplate. */
const MAX_ADVERT_TEXT = 8000;

/**
 * The seller's own words, as one string: description, attention grabber and
 * subtitle. Stored so anything derived from the advert's wording can be
 * recomputed later without re-fetching the page.
 */
export function advertText(advert: RawAdvert): string | null {
  const text = [
    ...(advert.description?.text ?? []),
    advert.overviewV2?.attentionGrabber ?? '',
    advert.heading?.subTitle ?? '',
  ]
    .filter((part: unknown): part is string => typeof part === 'string')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text.slice(0, MAX_ADVERT_TEXT) : null;
}

/** Words that flip the meaning when they appear just before "import". */
const NEGATIONS = /\b(not|never|non|no|isn'?t|wasn'?t)\b/i;
/** Nouns that make "import" describe a component rather than the car. */
const NOT_THE_CAR = /^\s*(parts?|spec\b|specification|components?|panels?|wheels?|alloys?)/i;

/**
 * Whether the advert's own words claim the car is an import.
 *
 * Takes the text rather than the advert, so it can run against the stored
 * `advert_text` at read time. That is the point: the flag is derived, never
 * persisted, so changing this pattern takes effect on every listing at once
 * instead of leaving old rows holding a stale answer.
 *
 * Only consulted when AutoTrader publishes no vehicle check. Deliberately
 * strict: a wrong badge here costs a wasted trip across the country, so
 * "imported parts", "import spec alloys" and "not imported" must all be
 * rejected. Anything looser is worse than showing nothing.
 */
export function mentionsImport(text: string | null | undefined): boolean {
  if (!text) return false;

  for (const match of text.matchAll(/\bimport(ed|s)?\b/gi)) {
    const index = match.index ?? 0;
    // A negation within roughly two words before it.
    const before = text.slice(Math.max(0, index - 24), index);
    if (NEGATIONS.test(before)) continue;
    if (NOT_THE_CAR.test(text.slice(index + match[0].length))) continue;
    return true;
  }

  return false;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Dealers appear as `seller.name`; private sellers have no name at all. The
 * advertiser block carries a prefixed variant ("From Evans Halshaw …") which is
 * only worth using as a fallback.
 */
function sellerName(advert: RawAdvert): string | null {
  const name = firstString(advert.seller?.name, advert.details?.advertiser?.displayName);
  return name ? name.replace(/^From\s+/i, '') : null;
}

/** Town lives in different places depending on seller type. */
function sellerLocation(advert: RawAdvert): string | null {
  return firstString(
    advert.seller?.location?.town,
    advert.contactDetails?.advertiserTown,
    advert.details?.advertiser?.locationDescription,
    advert.seller?.location?.locationHeaderDescription,
  );
}

export function normaliseAdvert(advert: RawAdvert): ListingDetail {
  const specs = keySpecs(advert);
  const tracking = advert.advertTrackingData?.advertContext ?? {};
  const serviceHistory = advert.history?.serviceHistory ?? {};
  const pills: string[] = (advert.heading?.headingPills ?? [])
    .map((p: any) => p?.label)
    .filter((l: unknown): l is string => typeof l === 'string');

  const lastService = (serviceHistory.additionalItems ?? []).find((item: any) =>
    typeof item?.label === 'string' && item.label.toLowerCase().includes('last service'),
  );

  return {
    advertId: String(advert.id ?? tracking.advertId ?? ''),
    make: tracking.make ?? null,
    model: tracking.model ?? null,
    year: firstNumber(tracking.year),
    price: firstNumber(tracking.price, advert.heading?.priceBreakdown?.price?.price),
    mileage: firstNumber(tracking.mileage),
    plateReg: parsePlateReg(specs.REGISTRATION),
    engineLitres: parseEngineLitres(specs.ENGINESIZELITRES),
    // GEARBOX is the reliable source; the heading pills are a fallback for the
    // adverts that omit it from the spec table.
    transmission:
      parseTransmission(specs.GEARBOX) ??
      parseTransmission(pills.find((p) => /auto|manual/i.test(p))),
    fuel: specs.FUELTYPE ?? null,
    bodyType: specs.BODYTYPE ?? null,
    doors: specs.DOORS ? Number(specs.DOORS) : null,
    priceIndicator: asPriceIndicator(advert.heading?.priceIndicator),
    serviceHistory: asServiceHistory(serviceHistory.historyType),
    lastServiceDate: lastService?.value ?? null,
    writeOff: checkStatus(advert, 'WRITE_OFF'),
    stolen: checkStatus(advert, 'STOLEN'),
    scrapped: checkStatus(advert, 'SCRAPPED'),
    imported: checkStatus(advert, 'IMPORTED'),
    motStatus: advert.history?.mot?.status ?? null,
    sellerName: sellerName(advert),
    sellerType: tracking.advertiserType ?? null,
    location: sellerLocation(advert),
    imageUrl: advert.pageMetaData?.mainImageUrl ?? null,
    vrm: extractVrm(advert),
    advertText: advertText(advert),
  };
}
