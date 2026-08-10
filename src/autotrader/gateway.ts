/**
 * Client for AutoTrader's undocumented GraphQL gateway.
 *
 * The public site's SPA posts to `/at-gateway?opname=...` with no auth. We send
 * the same headers it does. Introspection is blocked by their WAF, but field
 * validation errors include "Did you mean ..." suggestions, which is how the
 * query documents in search.ts were derived.
 *
 * Keep the request rate low — this is a personal-volume tool.
 */

const ORIGIN = 'https://www.autotrader.co.uk';
const GATEWAY = `${ORIGIN}/at-gateway`;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export interface GraphQLError {
  message: string;
}

export class AutoTraderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly errors?: GraphQLError[],
  ) {
    super(message);
    this.name = 'AutoTraderError';
  }
}

export interface FetchOptions {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Attempts per request, including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in ms. */
  backoffMs?: number;
  /** Injectable for tests, so retry paths don't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'user-agent': USER_AGENT,
    'accept-language': 'en-GB,en;q=0.9',
    origin: ORIGIN,
    referer: `${ORIGIN}/car-search`,
    ...extra,
  };
}

/** True for transient failures worth retrying. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

async function withRetry<T>(
  opts: FetchOptions,
  attempt: (attemptNo: number) => Promise<T>,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await attempt(i);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof AutoTraderError && err.status !== undefined && isRetryable(err.status);
      if (!retryable || i === maxAttempts) throw err;
      await sleep(backoffMs * 2 ** (i - 1));
    }
  }
  throw lastError;
}

/** POST a GraphQL operation to the gateway and return `data`. */
export async function gatewayQuery<T>(
  opname: string,
  query: string,
  variables: Record<string, unknown>,
  opts: FetchOptions = {},
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;

  return withRetry(opts, async () => {
    const res = await doFetch(`${GATEWAY}?opname=${encodeURIComponent(opname)}`, {
      method: 'POST',
      headers: browserHeaders({
        'content-type': 'application/json',
        'x-sauron-app-name': 'sauron-search-results-app',
      }),
      body: JSON.stringify({ operationName: opname, variables, query }),
    });

    // A bad filter name or field comes back as HTTP 400 with a GraphQL error
    // body that names the offender and often suggests the correct value, so
    // the body is worth far more than the status code. Read it either way, and
    // tolerate a non-JSON response such as a Cloudflare block page.
    let body: { data?: T; errors?: GraphQLError[] } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Falls through to the status check below.
    }

    if (body.errors?.length) {
      // These mean our query document is wrong, not that AutoTrader is busy —
      // retrying would just repeat the same mistake.
      throw new AutoTraderError(
        `Gateway ${opname} returned errors: ${body.errors.map((e) => e.message).join('; ')}`,
        undefined,
        body.errors,
      );
    }

    if (!res.ok) {
      throw new AutoTraderError(`Gateway ${opname} returned HTTP ${res.status}`, res.status);
    }
    if (!body.data) throw new AutoTraderError(`Gateway ${opname} returned no data`);
    return body.data;
  });
}

/** GET a listing's detail page as HTML. */
export async function fetchDetailPage(advertId: string, opts: FetchOptions = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;

  return withRetry(opts, async () => {
    const res = await doFetch(`${ORIGIN}/car-details/${encodeURIComponent(advertId)}`, {
      headers: browserHeaders({
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }),
    });
    if (!res.ok) {
      throw new AutoTraderError(`Detail page ${advertId} returned HTTP ${res.status}`, res.status);
    }
    return res.text();
  });
}

export const listingUrl = (advertId: string): string => `${ORIGIN}/car-details/${advertId}`;
