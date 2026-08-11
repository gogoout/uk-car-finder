import { useEffect, useRef, useState } from 'react';
import { api, type FilterSelections } from './api';
import { FacetAccordion } from './FacetAccordion';
import type { FacetData } from '../../src/autotrader/facets';

/**
 * Filters applied to every combination in the search.
 *
 * Make, model and variant are excluded: a global make would defeat the point of
 * having several combinations. Everything else AutoTrader offers can be set
 * here once instead of repeated per combination.
 *
 * These are defaults, not constraints — a combination that sets the same filter
 * overrides it. Said plainly in the UI, because "global" could equally imply the
 * opposite.
 */
const CASCADE_GROUP = 'make_and_model';

export function GlobalFilters({
  filters,
  postcode,
  radius,
  onChange,
}: {
  filters: FilterSelections;
  postcode: string;
  radius: number | 'national';
  onChange: (filters: FilterSelections) => void;
}) {
  const [facets, setFacets] = useState<FacetData | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    api
      .getFacets(filters, postcode, radius)
      .then((data) => {
        if (id !== requestId.current) return;
        setFacets(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Could not load filter options');
      });
  }, [filters, postcode, radius, open]);

  const setFilter = (filter: string, values: string[]) => {
    const next = { ...filters };
    if (values.length > 0) next[filter] = values;
    else delete next[filter];
    onChange(next);
  };

  const count = Object.keys(filters).length;

  return (
    <div className="card combo-card">
      <div className="combo-head">
        <button
          type="button"
          className="combo-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true" className="facet-caret">
            {open ? '▾' : '▸'}
          </span>
          <span className="combo-name">Applies to all combinations</span>
          {count > 0 && (
            <span className="tiny muted combo-count">
              {count} filter{count === 1 ? '' : 's'}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="stack combo-body">
          <p className="tiny muted" style={{ margin: 0 }}>
            Set once instead of repeating per combination. A combination that
            sets the same filter itself overrides what you choose here — so you
            can share a mileage cap while keeping different price ranges.
          </p>

          {error && <div className="banner">{error}</div>}
          {!facets && !error && <div className="tiny muted">Loading filters…</div>}

          {facets && (
            <FacetAccordion
              data={facets}
              selections={filters}
              onChange={setFilter}
              // Make/model/variant stay per-combination by definition.
              hideGroups={[CASCADE_GROUP]}
            />
          )}
        </div>
      )}
    </div>
  );
}
