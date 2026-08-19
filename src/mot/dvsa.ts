/**
 * DVSA MOT History API.
 *
 * Registration: https://documentation.history.mot.api.gov.uk/mot-history-api/register
 * You are emailed a client id, client secret, API key and a tenant-specific
 * token URL. Auth is OAuth2 client-credentials against Microsoft Entra ID;
 * calls need both a bearer token and the `X-API-Key` header.
 *
 * The API is keyed on the registration plate, which AutoTrader does not publish
 * — so this runs only for cars where you have supplied a VRM.
 *
 * Fetching and interpreting are deliberately separate. `fetchMotRaw` returns
 * DVSA's payload untouched so it can be stored verbatim; everything a card or
 * the modal shows is derived from that stored payload on read.
 */

import type {
  MileageReading,
  MotHistory,
  MotRaw,
  MotSummary,
  MotTest,
} from '../types';
import type { Env } from '../index';

const SCOPE = 'https://tapi.dvsa.gov.uk/.default';
const API_BASE = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration';

/** Tokens last 60 minutes; refresh a little early to avoid edge failures. */
const TOKEN_TTL_MS = 55 * 60 * 1000;

/**
 * Advertised mileage is often rounded, and a car gains miles between its test
 * and the advert going up. Only flag the impossible direction, with enough
 * slack that rounding alone never trips it.
 */
export const MILEAGE_TOLERANCE_MILES = 500;

const KM_TO_MILES = 0.621371;

let cachedToken: { value: string; expiresAt: number } | null = null;

/** DVSA holds no record for this plate — a different thing from a failure. */
export class MotNotFound extends Error {
  constructor(plate: string) {
    super(`DVSA holds no MOT record for ${plate}`);
    this.name = 'MotNotFound';
  }
}

export function isMotConfigured(env: Env): boolean {
  return Boolean(env.DVSA_CLIENT_ID && env.DVSA_CLIENT_SECRET && env.DVSA_API_KEY && env.DVSA_TOKEN_URL);
}

/** Uppercase, no spaces — the form DVSA expects and the cache is keyed on. */
export function normalisePlate(vrm: string): string {
  return vrm.toUpperCase().replace(/\s+/g, '');
}

async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const res = await fetch(env.DVSA_TOKEN_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.DVSA_CLIENT_ID!,
      client_secret: env.DVSA_CLIENT_SECRET!,
      scope: SCOPE,
    }),
  });

  if (!res.ok) throw new Error(`DVSA token request failed with HTTP ${res.status}`);

  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('DVSA token response contained no access_token');

  cachedToken = { value: body.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return body.access_token;
}

/** DVSA's response, unmodified — this is what gets stored. */
export async function fetchMotRaw(env: Env, vrm: string): Promise<MotRaw> {
  const plate = normalisePlate(vrm);
  const token = await getAccessToken(env);

  const res = await fetch(`${API_BASE}/${encodeURIComponent(plate)}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-key': env.DVSA_API_KEY!,
      accept: 'application/json',
    },
  });

  if (res.status === 404) throw new MotNotFound(plate);
  if (!res.ok) throw new Error(`DVSA MOT lookup failed with HTTP ${res.status}`);

  return (await res.json()) as MotRaw;
}

/* ------------------------------------------------------------- derivations */

/**
 * DVSA has used two date formats over the life of the API — ISO
 * ("2023-05-12T10:57:24.000Z") on current records and dotted
 * ("2018.05.12 10:57:24") on older ones. Reduce both to a plain date, so
 * sorting and display don't depend on which era a test comes from.
 */
export function parseTestDate(value: string | undefined): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = value.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (dotted) return `${dotted[1]}-${dotted[2]}-${dotted[3]}`;
  return null;
}

/**
 * An odometer reading in miles, or null when the test recorded none.
 *
 * Kilometre readings are real and do appear — usually on an import. Treating
 * one as miles among mile readings invents a jump in both directions and
 * fabricates a clocking warning, so convert rather than compare raw numbers.
 */
export function odometerMiles(test: MotTest): number | null {
  if (!test.odometerValue || !/^\d+$/.test(test.odometerValue)) return null;
  const value = Number(test.odometerValue);
  return /^km$/i.test(test.odometerUnit ?? '') ? Math.round(value * KM_TO_MILES) : value;
}

/** Readings oldest-first, for spotting an implausible jump back. */
export function buildMileageTimeline(tests: MotTest[]): MileageReading[] {
  return tests
    .map((test) => ({ date: parseTestDate(test.completedDate), miles: odometerMiles(test) }))
    .filter((r): r is MileageReading => r.date !== null && r.miles !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** True if the odometer ever reads lower than an earlier test. */
export function detectClocking(timeline: MileageReading[]): boolean {
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i]!.miles < timeline[i - 1]!.miles) return true;
  }
  return false;
}

/** Newest test first, whatever order DVSA returned them in. */
function sortedTests(raw: MotRaw): MotTest[] {
  return [...(raw.motTests ?? [])].sort((a, b) =>
    (parseTestDate(b.completedDate) ?? '').localeCompare(parseTestDate(a.completedDate) ?? ''),
  );
}

/** Case- and punctuation-insensitive, matching how models are compared. */
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface AdvertFacts {
  /** Advertised mileage, to check the last MOT reading against. */
  mileage?: number | null;
  /** Advertised make, to catch a mistyped plate. */
  make?: string | null;
}

/**
 * The verdict, derived from the stored payload every time it is read.
 *
 * `advert` is what the listing claims; the two comparisons it enables are the
 * whole reason for looking a plate up — an odometer that contradicts the advert
 * and a plate that belongs to a different car.
 */
export function summariseMot(raw: MotRaw, advert: AdvertFacts = {}): MotSummary {
  const tests = sortedTests(raw);
  const timeline = buildMileageTimeline(tests);
  const latest = timeline.at(-1) ?? null;
  const lastTest = tests[0] ?? null;

  // The expiry worth showing is the one from the most recent pass; a later
  // failed test doesn't shorten a certificate that is still valid.
  const lastPass = tests.find((test) => /^pass/i.test(test.testResult) && test.expiryDate);

  const advertMileage = advert.mileage ?? null;
  const mileageMismatch =
    latest !== null && advertMileage !== null && latest.miles - advertMileage > MILEAGE_TOLERANCE_MILES
      ? latest.miles - advertMileage
      : null;

  // Only the make is compared. DVSA writes "COOPER S" where AutoTrader says
  // "Cooper", so a model comparison would cry wolf on half the shortlist.
  const dvsaMake = raw.make ?? null;
  const plateMismatch =
    dvsaMake && advert.make && !squash(dvsaMake).startsWith(squash(advert.make))
      ? [dvsaMake, raw.model].filter(Boolean).join(' ')
      : null;

  return {
    registration: raw.registration ?? null,
    vehicle: [raw.make, raw.model].filter(Boolean).join(' ') || null,
    lastTestDate: lastTest ? parseTestDate(lastTest.completedDate) : null,
    expiryDate: lastPass?.expiryDate ?? null,
    latestOdometer: latest?.miles ?? null,
    testCount: tests.length,
    possibleClocking: detectClocking(timeline),
    mileageMismatch,
    plateMismatch,
  };
}

/** Everything the modal shows, derived from the same stored payload. */
export function buildMotHistory(
  raw: MotRaw,
  meta: { fetchedAt: string; source: MotHistory['source'] },
  advert: AdvertFacts = {},
): MotHistory {
  const tests = sortedTests(raw);

  return {
    ...summariseMot(raw, advert),
    make: raw.make ?? null,
    model: raw.model ?? null,
    firstUsedDate: raw.firstUsedDate ?? null,
    fuelType: raw.fuelType ?? null,
    tests,
    mileageTimeline: buildMileageTimeline(tests),
    fetchedAt: meta.fetchedAt,
    source: meta.source,
  };
}
