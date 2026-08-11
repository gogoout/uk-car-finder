import type { Combo, FilterSelections, ResultListing, SavedSearch } from '../../src/types';
import type { FacetData } from '../../src/autotrader/facets';
import type { FullDetail } from '../../src/autotrader/fullDetail';

export type { Combo, FacetData, FilterSelections, FullDetail, ResultListing, SavedSearch };

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  pages_fetched: number;
  listings_seen: number;
  new_count: number;
  price_drop_count: number;
  rejected_count: number;
  error: string | null;
}

export interface ResultsResponse {
  search: SavedSearch;
  results: ResultListing[];
  pendingDetails: number;
  discardedCount: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SearchInput {
  name: string;
  postcode: string;
  radius: number | 'national';
  /** Applied to every combination; a combination's own filters override. */
  globalFilters: FilterSelections;
  combos: Combo[];
}

export const api = {
  /**
   * Filter options for the editor. Passing the combo's current filters is what
   * drives the Make -> Model -> Variant cascade: AutoTrader returns the valid
   * children of whatever is already chosen.
   */
  getFacets: (filters: FilterSelections, postcode: string, radius: number | 'national') =>
    request<FacetData>('/api/facets', {
      method: 'POST',
      body: JSON.stringify({ filters, postcode: postcode || undefined, radius }),
    }),

  /** Everything AutoTrader publishes about one advert, fetched on demand. */
  getListingDetail: (advertId: string) =>
    request<FullDetail>(`/api/listings/${advertId}/detail`),

  listSearches: () => request<SavedSearch[]>('/api/searches'),

  createSearch: (input: SearchInput) =>
    request<SavedSearch>('/api/searches', { method: 'POST', body: JSON.stringify(input) }),

  updateSearch: (id: string, input: SearchInput) =>
    request<SavedSearch>(`/api/searches/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  deleteSearch: (id: string) => request<{ ok: true }>(`/api/searches/${id}`, { method: 'DELETE' }),

  getResults: (id: string, excludeWriteOffs: boolean, includeDiscarded = false) =>
    request<ResultsResponse>(
      `/api/searches/${id}/results?excludeWriteOffs=${excludeWriteOffs ? 'true' : 'false'}` +
        `&includeDiscarded=${includeDiscarded ? 'true' : 'false'}`,
    ),

  getRuns: (id: string) => request<RunRow[]>(`/api/searches/${id}/runs`),

  refresh: (id: string) => request<unknown>(`/api/searches/${id}/refresh`, { method: 'POST' }),

  setStarred: (advertId: string, starred: boolean) =>
    request<{ ok: true }>(`/api/listings/${advertId}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred }),
    }),

  /** Rule a car out, hiding it from every search that finds it. */
  setDiscarded: (advertId: string, discarded: boolean) =>
    request<{ ok: true }>(`/api/listings/${advertId}/discard`, {
      method: 'POST',
      body: JSON.stringify({ discarded }),
    }),

  setVrm: (advertId: string, vrm: string | null) =>
    request<{ ok: true }>(`/api/listings/${advertId}/vrm`, {
      method: 'PUT',
      body: JSON.stringify({ vrm }),
    }),
};

/**
 * The list of searches *you* care about, kept per-device. The searches
 * themselves live server-side so the cron can poll them and so a /s/:id link
 * opens on any device.
 */
const STORAGE_KEY = 'uk-car-finder:my-searches';

export function loadMySearchIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberSearchId(id: string): void {
  const ids = loadMySearchIds();
  if (!ids.includes(id)) localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids, id]));
}

export function forgetSearchId(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadMySearchIds().filter((x) => x !== id)));
}
