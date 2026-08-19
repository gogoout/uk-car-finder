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

/**
 * The advert is no longer on AutoTrader.
 *
 * Sold and withdrawn adverts do not 404: the page still renders, with the same
 * hydration blob, simply carrying no `aggregatorAdvert`. That is the difference
 * between a car that has gone and a page we can no longer parse — one is
 * ordinary and expected, the other means their layout changed and we should
 * hear about it. Treating both as a parse failure made every sold car look like
 * a bug.
 */
export class AdvertGone extends Error {
  constructor(readonly advertId?: string) {
    super('This advert is no longer on AutoTrader');
    this.name = 'AdvertGone';
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
  // The blob parsed, so the page is the shape we expect — it just holds no
  // advert any more.
  const advert = data.loaderData?.['car-details']?.aggregatorAdvert;
  if (!advert) throw new AdvertGone();
  return advert;
}
