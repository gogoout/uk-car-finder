/**
 * Extracts the whole advert for the detail modal.
 *
 * `normaliseAdvert` deliberately pulls only the handful of fields that matching
 * and the result cards need. This is the fuller read: every photo, the spec
 * tables, the equipment list, the seller's own description and the history —
 * roughly what AutoTrader's own page shows, minus their finance and insurance
 * promotions.
 *
 * Kept separate from `normalise.ts` so the enrichment path stays small and its
 * behaviour can't be disturbed by changes made for the modal. Both read the
 * same `RawAdvert` from `detail.ts`.
 *
 * Every section is optional on AutoTrader's side — a private advert may have no
 * spec table, no description and ten photos, while a dealer's has 44 and six
 * feature categories. Nothing here may throw on a missing section.
 */

import type { RawAdvert } from './detail';
import type { CheckStatus, PriceIndicator, ServiceHistory } from '../types';

export interface GalleryImage {
  /** Contains a `{resize}` token — pass through `expandImageUrl` before use. */
  url: string;
  /** e.g. "Interior Front". */
  label: string | null;
  /** e.g. "Interior" / "Exterior", for the filter chips. */
  category: string | null;
}

export interface SpecGroup {
  category: string;
  items: { name: string; value: string }[];
}

export interface FeatureGroup {
  category: string;
  items: { name: string; type: string | null }[];
}

export interface HistoryCheck {
  id: string;
  label: string;
  status: CheckStatus;
}

export interface FullDetail {
  advertId: string;
  title: string;
  subTitle: string | null;
  attentionGrabber: string | null;
  price: number | null;
  priceLabel: string | null;
  priceIndicator: PriceIndicator | null;
  /** The chips under the title: mileage, reg year, gearbox, fuel. */
  pills: string[];
  images: GalleryImage[];
  /** Key specs as AutoTrader labels them, e.g. Mileage / Engine / Gearbox. */
  keySpecs: { label: string; value: string }[];
  specs: SpecGroup[];
  features: FeatureGroup[];
  /** The seller's own advert text, split into paragraphs. */
  description: string[];
  serviceHistory: ServiceHistory | null;
  serviceHistoryLabel: string | null;
  lastServiceDate: string | null;
  motLabel: string | null;
  checks: HistoryCheck[];
  sellerName: string | null;
  sellerLocation: string | null;
  sellerPhone: string | null;
  detailUrl: string;
}

/**
 * AutoTrader's image URLs carry a literal `{resize}` token which their own site
 * replaces with `w600`, `w800` and so on. Left unreplaced the URL 404s.
 */
export function expandImageUrl(url: string, width: number): string {
  return url.replace('{resize}', `w${width}`);
}

/**
 * Fallback wording only. AutoTrader phrases each check as a statement of the
 * finding — "Not recorded as stolen", "Imported from another country" — which
 * is far clearer than a bare noun plus a status, so their label wins whenever
 * they send one.
 */
const CHECK_LABELS: Record<string, string> = {
  STOLEN: 'Stolen',
  SCRAPPED: 'Scrapped',
  IMPORTED: 'Imported from another country',
  EXPORTED: 'Exported',
  WRITE_OFF: 'Written off',
};

function asCheckStatus(value: unknown): CheckStatus {
  return value === 'PASSED' || value === 'FAILED' ? value : 'UNKNOWN';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    // AutoTrader stuffs the whole advert into one string with newlines.
    .flatMap((v) => v.split(/\n{1,}/))
    .map((v) => v.trim())
    .filter(Boolean);
}

function galleryImages(advert: RawAdvert): GalleryImage[] {
  const images = advert.gallery?.images;
  if (!Array.isArray(images)) return [];

  return images
    .filter((img: any) => typeof img?.url === 'string')
    .map((img: any) => {
      const tag = (img.classificationTags ?? [])[0] ?? {};
      return {
        url: img.url as string,
        label: typeof tag.label === 'string' ? tag.label : null,
        // Untagged images come back with a null category; the UI groups those
        // under "All" rather than inventing a bucket.
        category: typeof tag.category === 'string' ? tag.category : null,
      };
    });
}

function specGroups(advert: RawAdvert): SpecGroup[] {
  if (!Array.isArray(advert.specs)) return [];

  return advert.specs
    .filter((group: any) => group?.category && Array.isArray(group.items))
    .map((group: any) => ({
      category: String(group.category),
      items: group.items
        .filter((item: any) => item?.name !== undefined && item?.value !== undefined)
        .map((item: any) => ({ name: String(item.name), value: String(item.value) })),
    }))
    .filter((group: SpecGroup) => group.items.length > 0);
}

function featureGroups(advert: RawAdvert): FeatureGroup[] {
  const features = advert.featuresWithDisclaimer?.features;
  if (!Array.isArray(features)) return [];

  return features
    .filter((group: any) => Array.isArray(group?.items))
    .map((group: any) => ({
      category: String(group.category ?? group.title ?? 'Other'),
      items: group.items
        .filter((item: any) => item?.name !== undefined)
        .map((item: any) => ({
          name: String(item.name),
          type: typeof item.type === 'string' ? item.type : null,
        })),
    }))
    .filter((group: FeatureGroup) => group.items.length > 0);
}

function historyChecks(advert: RawAdvert): HistoryCheck[] {
  const checks = advert.history?.vehicleCheck?.basicChecks;
  if (!Array.isArray(checks)) return [];

  return checks
    .filter((check: any) => typeof check?.id === 'string')
    .map((check: any) => ({
      id: check.id as string,
      // Their label states the finding; ours is only used if they send none.
      label: typeof check.label === 'string' && check.label
        ? check.label
        : (CHECK_LABELS[check.id as string] ?? String(check.id)),
      status: asCheckStatus(check.status),
    }));
}

function keySpecs(advert: RawAdvert): { label: string; value: string }[] {
  const source = advert.overviewV2?.keySpecification ?? advert.keySpecification;
  if (!Array.isArray(source)) return [];

  return source
    .filter((item: any) => item?.label && item?.value !== undefined)
    .map((item: any) => ({ label: String(item.label), value: String(item.value) }));
}

const PRICE_INDICATORS: PriceIndicator[] = ['GREAT', 'GOOD', 'FAIR', 'HIGH', 'LOW', 'NOANALYSIS'];
const SERVICE_HISTORIES: ServiceHistory[] = ['FULL', 'PART', 'NO_HISTORY', 'UNKNOWN'];

export function normaliseFullDetail(advert: RawAdvert, advertId?: string): FullDetail {
  const id = String(advert.id ?? advert.advertTrackingData?.advertContext?.advertId ?? advertId ?? '');
  const heading = advert.heading ?? {};
  const serviceHistory = advert.history?.serviceHistory ?? {};
  const sellerInfo = advert.ownershipAndHistory?.sellerInformation ?? {};

  const indicator = PRICE_INDICATORS.includes(heading.priceIndicator)
    ? (heading.priceIndicator as PriceIndicator)
    : null;

  return {
    advertId: id,
    title: String(heading.title ?? advert.details?.title ?? ''),
    subTitle: heading.subTitle ?? advert.details?.subTitle ?? null,
    attentionGrabber: advert.overviewV2?.attentionGrabber ?? null,
    price: advert.advertTrackingData?.advertContext?.price ?? heading.priceBreakdown?.price?.price ?? null,
    priceLabel: heading.priceBreakdown?.price?.priceFormatted ?? null,
    // NOANALYSIS means AutoTrader has no verdict, which is not a verdict.
    priceIndicator: indicator === 'NOANALYSIS' ? null : indicator,
    pills: (heading.headingPills ?? [])
      .map((pill: any) => pill?.label)
      .filter((label: unknown): label is string => typeof label === 'string'),
    images: galleryImages(advert),
    keySpecs: keySpecs(advert),
    specs: specGroups(advert),
    features: featureGroups(advert),
    description: textList(advert.description?.text),
    serviceHistory: SERVICE_HISTORIES.includes(serviceHistory.historyType)
      ? (serviceHistory.historyType as ServiceHistory)
      : null,
    serviceHistoryLabel: serviceHistory.description ?? null,
    lastServiceDate:
      (serviceHistory.additionalItems ?? []).find((item: any) =>
        typeof item?.label === 'string' && item.label.toLowerCase().includes('last service'),
      )?.value ?? null,
    motLabel: (sellerInfo.mot?.items ?? [])
      .map((item: any) => [item?.label, item?.value].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' · ') || advert.history?.mot?.status || null,
    checks: historyChecks(advert),
    sellerName: advert.seller?.name ?? null,
    sellerLocation: advert.seller?.location?.town ?? advert.contactDetails?.advertiserTown ?? null,
    sellerPhone: advert.contactDetails?.phoneNumberOne ?? null,
    detailUrl: `https://www.autotrader.co.uk/car-details/${id}`,
  };
}
