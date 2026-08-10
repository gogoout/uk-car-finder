/**
 * Turns AutoTrader's facet payload into something renderable.
 *
 * Shared between the Worker and the SPA (like `types.ts`) so the logic is
 * typechecked and unit-tested with the rest of `src`, rather than hiding in a
 * component.
 */

import type { Facet, FacetData } from './autotrader/facets';
import type { FilterSelections } from './types';

/**
 * AutoTrader's `facetGroups` gives the UI groups and their titles, but not
 * which facets belong to each. Most groups share a name with their facet; these
 * are the ones that don't, derived by diffing the live payload.
 *
 * Anything not listed here falls back to the same-name facet, and any facet
 * left over gets a group of its own — so a filter AutoTrader adds tomorrow
 * still appears, just under its own heading.
 */
export const GROUP_FACETS: Record<string, string[]> = {
  make_and_model: ['make', 'model', 'aggregated_trim'],
  year: ['year_manufactured'],
  gearbox: ['transmission'],
  previously_written_off: ['is_writeoff'],
  doors: ['doors_values'],
  seats: ['seats_values'],
  acceleration: ['acceleration_values'],
  tax_per_year: ['annual_tax_values'],
  co2_emissions: ['co2_emission_values'],
  boot_space: ['boot_size_values'],
  fuel_consumption: ['fuel_consumption_values'],
  battery_range: ['battery_range_values'],
  charging_time: ['battery_charge_time_values', 'battery_quick_charge_time_values'],
  keyword_search: ['keywords'],
  drive_type: ['drivetrain'],
  digital_retailing: ['with_digital_retailing'],
};

/**
 * Filters that describe the searcher or the request rather than the car. They
 * live on the saved search, so the per-combo editor must not offer them.
 */
export const SEARCH_LEVEL_FACETS = new Set(['postcode', 'price_search_type', 'distance']);

/**
 * AutoTrader returns their groups roughly alphabetically, which buries "Make
 * and model" eighteen rows down. These lead instead — the ones an actual car
 * search starts from — and everything else keeps AutoTrader's order behind them.
 */
export const PRIORITY_GROUPS = [
  'make_and_model',
  'price',
  'year',
  'mileage',
  'gearbox',
  'fuel_type',
  'body_type',
  'engine_size',
  'previously_written_off',
];

/** Machine names whose humanised form would be unhelpful. */
const TITLE_OVERRIDES: Record<string, string> = {
  ni_only: 'Northern Ireland only',
  is_manufacturer_approved: 'Manufacturer approved',
};

export interface RenderableGroup {
  name: string;
  title: string;
  facets: Facet[];
}

/** "doors_values" -> "Doors" */
export function humanise(name: string): string {
  const override = TITLE_OVERRIDES[name];
  if (override) return override;
  const words = name.replace(/_values$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Groups facets in AutoTrader's own order, then appends any facet their groups
 * didn't account for. Groups whose facets are all missing are dropped, so an
 * empty accordion row never appears.
 */
export function buildGroups(data: FacetData): RenderableGroup[] {
  const used = new Set<string>(SEARCH_LEVEL_FACETS);
  const groups: RenderableGroup[] = [];

  for (const group of data.groups) {
    const names = GROUP_FACETS[group.name] ?? [group.name];
    for (const name of names) used.add(name);

    const facets = names
      // A group made up entirely of search-level facets (Distance from you)
      // drops out here rather than being duplicated into every combo.
      .filter((n) => !SEARCH_LEVEL_FACETS.has(n))
      .map((n) => data.facets[n])
      .filter((f): f is Facet => Boolean(f));

    if (facets.length > 0) groups.push({ name: group.name, title: group.title, facets });
  }

  // Facets AutoTrader's groups didn't mention — including any they add later.
  for (const [name, facet] of Object.entries(data.facets)) {
    if (used.has(name)) continue;
    groups.push({ name, title: humanise(name), facets: [facet] });
  }

  // Lead with the groups a search actually starts from; keep AutoTrader's
  // relative order for the rest.
  const rank = (name: string): number => {
    const index = PRIORITY_GROUPS.indexOf(name);
    return index === -1 ? PRIORITY_GROUPS.length : index;
  };
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group.name) - rank(b.group.name) || a.index - b.index)
    .map(({ group }) => group);
}

export type ControlKind = 'range' | 'multi';

/**
 * A facet whose filters are a `min_`/`max_` pair renders as two dropdowns;
 * everything else renders as a multi-select, since every non-range filter
 * accepts an array of values as an OR.
 *
 * Deliberately structural rather than a list of known facets, so filters we
 * have never seen still render sensibly.
 */
export function controlKind(facet: Facet): ControlKind {
  const names = facet.filters.map((f) => f.filter);
  const hasMin = names.some((n) => n.startsWith('min_'));
  const hasMax = names.some((n) => n.startsWith('max_'));
  return names.length === 2 && hasMin && hasMax ? 'range' : 'multi';
}

/** Options beyond this many get a type-to-filter box. */
export const SEARCHABLE_THRESHOLD = 12;

const labelFor = (facet: Facet, filterName: string, value: string): string =>
  facet.filters
    .find((f) => f.filter === filterName)
    ?.options.find((o) => o.value === value)?.label ?? value;

/**
 * Short description of a group's current selection, shown on the collapsed
 * accordion row so the whole combo is readable without opening anything.
 */
export function summariseGroup(group: RenderableGroup, selections: FilterSelections): string {
  const parts: string[] = [];

  for (const facet of group.facets) {
    if (controlKind(facet) === 'range') {
      const min = facet.filters.find((f) => f.filter.startsWith('min_'));
      const max = facet.filters.find((f) => f.filter.startsWith('max_'));
      const from = min ? selections[min.filter]?.[0] : undefined;
      const to = max ? selections[max.filter]?.[0] : undefined;
      if (from && to) parts.push(`${labelFor(facet, min!.filter, from)} – ${labelFor(facet, max!.filter, to)}`);
      else if (from) parts.push(`from ${labelFor(facet, min!.filter, from)}`);
      else if (to) parts.push(`up to ${labelFor(facet, max!.filter, to)}`);
      continue;
    }

    for (const filter of facet.filters) {
      const selected = selections[filter.filter] ?? [];
      if (selected.length === 0) continue;
      // Listing five colours would blow the row's width; summarise instead.
      parts.push(
        selected.length > 2
          ? `${selected.length} selected`
          : selected.map((v) => labelFor(facet, filter.filter, v)).join(', '),
      );
    }
  }

  return parts.join(' · ');
}

/** Filter names a group owns, for clearing it in one go. */
export const groupFilterNames = (group: RenderableGroup): string[] =>
  group.facets.flatMap((f) => f.filters.map((fl) => fl.filter));

/**
 * Choosing a make invalidates the model, and a model invalidates the variant —
 * AutoTrader would otherwise return nothing for a stale child selection.
 */
export const CASCADE_CHILDREN: Record<string, string[]> = {
  make: ['model', 'aggregated_trim'],
  model: ['aggregated_trim'],
};

export function applyCascade(selections: FilterSelections, changedFilter: string): FilterSelections {
  const children = CASCADE_CHILDREN[changedFilter];
  if (!children) return selections;

  const next = { ...selections };
  for (const child of children) delete next[child];
  return next;
}
