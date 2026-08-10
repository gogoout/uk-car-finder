import { SearchableSelect } from './SearchableSelect';
import { controlKind, humanise, SEARCHABLE_THRESHOLD } from '../../src/facetUi';
import type { Facet } from '../../src/autotrader/facets';
import type { FilterSelections } from '../../src/types';

/** Only make/model/variant are genuinely exclusive; the rest OR together. */
const SINGLE_SELECT = new Set(['make', 'model', 'aggregated_trim', 'is_writeoff']);

const PLACEHOLDER: Record<string, string> = {
  make: 'Any make',
  model: 'Any model',
  aggregated_trim: 'Any variant',
};

const EMPTY_MESSAGE: Record<string, string> = {
  model: 'Choose a make first',
  aggregated_trim: 'Choose a model first',
};

const FILTER_LABEL: Record<string, string> = {
  make: 'Make',
  model: 'Model',
  aggregated_trim: 'Variant',
  is_writeoff: 'Write-offs',
};

/**
 * Renders one facet, choosing the widget from its shape rather than a hardcoded
 * list — a `min_`/`max_` pair becomes two dropdowns, anything else a
 * multi-select. That way filters AutoTrader adds later render correctly with no
 * code change.
 */
export function FacetControl({
  facet,
  selections,
  onChange,
}: {
  facet: Facet;
  selections: FilterSelections;
  onChange: (filter: string, values: string[]) => void;
}) {
  if (controlKind(facet) === 'range') {
    const min = facet.filters.find((f) => f.filter.startsWith('min_'))!;
    const max = facet.filters.find((f) => f.filter.startsWith('max_'))!;

    return (
      <div className="grid-2">
        {[
          { filter: min, label: 'From' },
          { filter: max, label: 'To' },
        ].map(({ filter, label }) => (
          <label key={filter.filter}>
            <span>{label}</span>
            <select
              value={selections[filter.filter]?.[0] ?? ''}
              onChange={(e) => onChange(filter.filter, e.target.value ? [e.target.value] : [])}
            >
              <option value="">Any</option>
              {filter.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="stack">
      {facet.filters.map((filter) => {
        const label = FILTER_LABEL[filter.filter] ?? humanise(filter.filter);
        return (
          <label key={filter.filter}>
            {/* One-filter facets are already titled by their accordion row. */}
            {facet.filters.length > 1 || FILTER_LABEL[filter.filter] ? <span>{label}</span> : null}
            <SearchableSelect
              label={label}
              options={filter.options}
              selected={selections[filter.filter] ?? []}
              multiple={!SINGLE_SELECT.has(filter.filter)}
              searchable={filter.options.length > SEARCHABLE_THRESHOLD}
              placeholder={PLACEHOLDER[filter.filter] ?? 'Any'}
              emptyMessage={EMPTY_MESSAGE[filter.filter]}
              onChange={(values) => onChange(filter.filter, values)}
            />
          </label>
        );
      })}
    </div>
  );
}
