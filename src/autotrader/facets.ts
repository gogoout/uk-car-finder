/**
 * AutoTrader's facet API — the query that populates their own filter dropdowns.
 *
 * This is what makes the filter editor self-maintaining. Asking for a single
 * facet returns *all* of them (34 for cars) with per-option labels, values and
 * live result counts, plus `facetGroups` giving AutoTrader's own UI grouping and
 * human titles. We render whatever comes back, so filters they add appear here
 * without a code change.
 *
 * The Make/Model/Variant cascade needs no taxonomy of our own: pass the filters
 * chosen so far and AutoTrader returns the valid children. With no make, `model`
 * comes back with zero options; with `make: MINI` it returns that make's models;
 * add `model: Cooper` and `aggregated_trim` returns that model's variants.
 */

import { gatewayQuery, type FetchOptions } from './gateway';
import type { FilterInput } from './filters';

const OPNAME = 'SearchResultsFacetsWithGroupsQuery';

/**
 * Lifted from their SPA bundle, trimmed to the fields we render. `$facets` is
 * required but its contents barely matter — the response covers everything
 * regardless — so callers pass a single cheap facet.
 */
const QUERY = `query ${OPNAME}($facets: [FacetName!]!, $filters: [FilterInput!]!, $channel: Channel!) {
  searchResults(input: {facets: $facets, filters: $filters, channel: $channel}) {
    facets {
      facet
      filters {
        filter
        options { label value count }
        selected
      }
    }
    facetGroups(filters: $filters) {
      facetGroupName
      title
      helpText
    }
    page { results { count } }
  }
}`;

export interface FacetOption {
  label: string;
  value: string;
  count: number | null;
}

/** One control: either a standalone filter or one half of a min/max pair. */
export interface FacetFilter {
  filter: string;
  options: FacetOption[];
  selected: string[];
}

export interface Facet {
  facet: string;
  filters: FacetFilter[];
}

export interface FacetGroup {
  name: string;
  title: string;
  helpText: string | null;
}

export interface FacetData {
  /** AutoTrader's UI groups, in their order. */
  groups: FacetGroup[];
  /** Keyed by facet name, e.g. `price` -> min_price + max_price. */
  facets: Record<string, Facet>;
  /** Total listings matching the filters passed in. */
  resultCount: number | null;
}

interface RawFacetResponse {
  searchResults: {
    facets: {
      facet?: string | null;
      filters?:
        | {
            filter?: string | null;
            options?: ({ label?: string | null; value?: string | null; count?: number | null } | null)[] | null;
            selected?: string[] | null;
          }[]
        | null;
    }[];
    facetGroups?: ({ facetGroupName?: string | null; title?: string | null; helpText?: string | null } | null)[] | null;
    page?: { results?: { count?: number | null } | null } | null;
  };
}

export function parseFacetResponse(data: RawFacetResponse): FacetData {
  const facets: Record<string, Facet> = {};

  for (const raw of data.searchResults.facets ?? []) {
    if (!raw?.facet) continue;
    facets[raw.facet] = {
      facet: raw.facet,
      filters: (raw.filters ?? [])
        .filter((f): f is NonNullable<typeof f> => Boolean(f?.filter))
        .map((f) => ({
          filter: f.filter!,
          selected: f.selected ?? [],
          options: (f.options ?? [])
            .filter((o): o is NonNullable<typeof o> => Boolean(o?.value !== undefined && o?.value !== null))
            .map((o) => ({
              label: o.label ?? String(o.value),
              value: String(o.value),
              count: o.count ?? null,
            })),
        })),
    };
  }

  return {
    groups: (data.searchResults.facetGroups ?? [])
      .filter((g): g is NonNullable<typeof g> => Boolean(g?.facetGroupName))
      .map((g) => ({
        name: g.facetGroupName!,
        title: g.title ?? g.facetGroupName!,
        helpText: g.helpText ?? null,
      })),
    facets,
    resultCount: data.searchResults.page?.results?.count ?? null,
  };
}

/**
 * AutoTrader rejects a facet request without a price search type, so it is
 * always sent. Unlike the search itself, a postcode is *not* required — which is
 * what lets the editor render its dropdowns before one has been typed.
 */
export function facetFilters(filters: FilterInput[]): FilterInput[] {
  const hasPriceType = filters.some((f) => f.filter === 'price_search_type');
  return hasPriceType ? filters : [...filters, { filter: 'price_search_type', selected: ['total'] }];
}

export async function fetchFacets(
  filters: FilterInput[],
  opts: FetchOptions = {},
): Promise<FacetData> {
  const data = await gatewayQuery<RawFacetResponse>(
    OPNAME,
    QUERY,
    {
      // One cheap facet; the response includes every facet regardless.
      facets: ['make'],
      filters: facetFilters(filters),
      channel: 'cars',
    },
    opts,
  );
  return parseFacetResponse(data);
}
