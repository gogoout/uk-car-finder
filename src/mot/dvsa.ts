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
 */

import type { Env } from '../index';

const SCOPE = 'https://tapi.dvsa.gov.uk/.default';
const API_BASE = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration';

/** Tokens last 60 minutes; refresh a little early to avoid edge failures. */
const TOKEN_TTL_MS = 55 * 60 * 1000;

let cachedToken: { value: string; expiresAt: number } | null = null;

export function isMotConfigured(env: Env): boolean {
  return Boolean(env.DVSA_CLIENT_ID && env.DVSA_CLIENT_SECRET && env.DVSA_API_KEY && env.DVSA_TOKEN_URL);
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

export interface MotTest {
  completedDate: string;
  testResult: string;
  expiryDate?: string;
  odometerValue?: string;
  odometerUnit?: string;
  defects?: { text: string; type: string }[];
}

export interface MotHistory {
  registration: string;
  make?: string;
  model?: string;
  firstUsedDate?: string;
  motTests: MotTest[];
  /** Odometer readings oldest-first, for spotting an implausible jump back. */
  mileageTimeline: { date: string; miles: number }[];
  possibleClocking: boolean;
}

export function buildMileageTimeline(tests: MotTest[]): MotHistory['mileageTimeline'] {
  return tests
    .filter((t) => t.odometerValue && /^\d+$/.test(t.odometerValue))
    .map((t) => ({ date: t.completedDate, miles: Number(t.odometerValue) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** True if the odometer ever reads lower than an earlier test. */
export function detectClocking(timeline: MotHistory['mileageTimeline']): boolean {
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i]!.miles < timeline[i - 1]!.miles) return true;
  }
  return false;
}

export async function fetchMotHistory(env: Env, vrm: string): Promise<MotHistory> {
  const plate = vrm.toUpperCase().replace(/\s+/g, '');
  const token = await getAccessToken(env);

  const res = await fetch(`${API_BASE}/${encodeURIComponent(plate)}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-key': env.DVSA_API_KEY!,
      accept: 'application/json',
    },
  });

  if (res.status === 404) throw new Error(`No MOT history found for ${plate}`);
  if (!res.ok) throw new Error(`DVSA MOT lookup failed with HTTP ${res.status}`);

  const body = (await res.json()) as {
    registration?: string;
    make?: string;
    model?: string;
    firstUsedDate?: string;
    motTests?: MotTest[];
  };

  const motTests = body.motTests ?? [];
  const mileageTimeline = buildMileageTimeline(motTests);

  return {
    registration: body.registration ?? plate,
    make: body.make,
    model: body.model,
    firstUsedDate: body.firstUsedDate,
    motTests,
    mileageTimeline,
    possibleClocking: detectClocking(mileageTimeline),
  };
}
