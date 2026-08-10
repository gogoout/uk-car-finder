import { useEffect, useRef, useState } from 'react';
import { api, type Combo } from './api';
import { FacetAccordion } from './FacetAccordion';
import { applyCascade } from '../../src/facetUi';
import { FILTER } from '../../src/types';
import type { FacetData } from '../../src/autotrader/facets';

/**
 * One search combination, e.g. "MINI Cooper 1.5 Auto, 2015-16, under 85k,
 * £5.5-7k".
 *
 * Every control is driven by AutoTrader's facet API rather than hardcoded, so
 * the option lists are always theirs and always current. Changing a filter
 * refetches, which is what makes Make → Model → Variant cascade and keeps the
 * result counts honest.
 */
export function ComboEditor({
  combo,
  postcode,
  radius,
  onChange,
  onRemove,
  canRemove,
}: {
  combo: Combo;
  postcode: string;
  radius: number | 'national';
  onChange: (combo: Combo) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [facets, setFacets] = useState<FacetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Guards against an earlier, slower response overwriting a newer one.
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    api
      .getFacets(combo.filters, postcode, radius)
      .then((data) => {
        if (id !== requestId.current) return;
        setFacets(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Could not load filter options');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [combo.filters, postcode, radius]);

  const setFilter = (filter: string, values: string[]) => {
    const next = { ...combo.filters };
    if (values.length > 0) next[filter] = values;
    else delete next[filter];

    // Choosing a make invalidates the model, a model the variant.
    const cascaded = applyCascade(next, filter);

    onChange({
      ...combo,
      filters: cascaded,
      label: combo.labelIsCustom ? combo.label : deriveLabel(cascaded),
    });
  };

  return (
    <div className="card stack">
      <div className="spread">
        <strong className="small">{combo.label || 'New combination'}</strong>
        <span className="row">
          {facets?.resultCount !== null && facets?.resultCount !== undefined && (
            <span className="badge">{facets.resultCount.toLocaleString('en-GB')} on AutoTrader</span>
          )}
          {canRemove && (
            <button type="button" className="link" onClick={onRemove}>
              Remove
            </button>
          )}
        </span>
      </div>

      <label>
        <span>Label (shown on matching cars)</span>
        <input
          value={combo.label}
          placeholder="MINI Cooper 1.5 Auto"
          onChange={(e) =>
            onChange({ ...combo, label: e.target.value, labelIsCustom: e.target.value !== '' })
          }
        />
      </label>

      {error && (
        <div className="banner">
          {error} — filter options are unavailable, but a saved combination still runs.
        </div>
      )}

      {!facets && loading && <div className="tiny muted">Loading filters…</div>}

      {facets && (
        <>
          {loading && <div className="tiny muted">Updating options…</div>}
          <FacetAccordion data={facets} selections={combo.filters} onChange={setFilter} />
        </>
      )}
    </div>
  );
}

/** "MINI Cooper Classic" from the make/model/variant selections. */
export function deriveLabel(filters: Record<string, string[]>): string {
  return (
    [FILTER.make, FILTER.model, FILTER.variant]
      .flatMap((name) => filters[name] ?? [])
      .join(' ') || ''
  );
}
