/**
 * Extracts the embedded state blob from a `/car-details/{id}` page.
 *
 * The page is server-rendered by a React Router app that hydrates from
 * `window.__staticRouterHydrationData = JSON.parse("<json string literal>")`.
 * That's a JSON string containing JSON, so it needs parsing twice.
 *
 * (`window['AT_APOLLO_STATE']` also appears on the page but is always `{}`.)
 */

const HYDRATION_RE =
  /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(\s*("(?:[^"\\]|\\.)*")\s*\)/;

export class DetailParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetailParseError';
  }
}

/** The advert object, left loosely typed — normalise.ts owns the field mapping. */
export type RawAdvert = Record<string, any>;

export function extractHydrationData(html: string): unknown {
  const match = html.match(HYDRATION_RE);
  if (!match?.[1]) {
    throw new DetailParseError('No __staticRouterHydrationData found — page layout changed?');
  }
  const inner = JSON.parse(match[1]) as string;
  return JSON.parse(inner);
}

export function extractAdvert(html: string): RawAdvert {
  const data = extractHydrationData(html) as {
    loaderData?: { 'car-details'?: { aggregatorAdvert?: RawAdvert } };
  };
  const advert = data.loaderData?.['car-details']?.aggregatorAdvert;
  if (!advert) {
    throw new DetailParseError('Hydration data had no loaderData["car-details"].aggregatorAdvert');
  }
  return advert;
}
