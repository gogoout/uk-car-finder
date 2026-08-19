import { useState } from 'react';
import { api, rememberSearchId, type Combo, type SavedSearch } from './api';
import { ComboEditor } from './ComboEditor';
import { GlobalFilters } from './GlobalFilters';
import type { FilterSelections } from './api';
import { comboEnabled } from '../../src/types';

const newCombo = (): Combo => ({
  id: Math.random().toString(36).slice(2, 8),
  label: '',
  filters: {},
});

export function SearchEditor({
  existing,
  onSaved,
  onCancel,
}: {
  existing: SavedSearch | null;
  onSaved: (search: SavedSearch) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [postcode, setPostcode] = useState(existing?.postcode ?? '');
  const [radius, setRadius] = useState<string>(String(existing?.radius ?? 50));
  const [combos, setCombos] = useState<Combo[]>(existing?.combos ?? [newCombo()]);
  const [globalFilters, setGlobalFilters] = useState<FilterSelections>(
    existing?.globalFilters ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AutoTrader rejects a search with no postcode ("a required filter"), and a
  // combination with no make would match the entire site. A parked combination
  // is exempt, matching the server: it never runs, so it can sit half-built.
  const blockers = [
    ...(postcode.trim() ? [] : ['enter a postcode']),
    ...combos
      .map((combo, index) =>
        !comboEnabled(combo) || combo.filters.make?.length
          ? null
          : `choose a make for ${combo.label || `combination ${index + 1}`}`,
      )
      .filter((reason): reason is string => reason !== null),
  ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim() || 'Untitled search',
        postcode: postcode.trim(),
        radius: radius === 'national' ? ('national' as const) : Number(radius),
        globalFilters,
        combos,
      };
      const saved = existing
        ? await api.updateSearch(existing.id, input)
        : await api.createSearch(input);
      rememberSearchId(saved.id);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="top">
        <h1>{existing ? 'Edit search' : 'New search'}</h1>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
      </header>

      {error && <div className="banner">{error}</div>}

      <div className="card stack">
        <label>
          <span>Search name</span>
          <input value={name} placeholder="Small autos" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2">
          <label>
            <span>Postcode * (AutoTrader requires one)</span>
            <input
              value={postcode}
              placeholder="SW1A 1AA"
              autoCapitalize="characters"
              onChange={(e) => setPostcode(e.target.value)}
            />
          </label>
          <label>
            <span>Distance</span>
            <select value={radius} onChange={(e) => setRadius(e.target.value)}>
              {[10, 25, 50, 100, 200].map((r) => (
                <option key={r} value={r}>
                  {r} miles
                </option>
              ))}
              <option value="national">National</option>
            </select>
          </label>
        </div>
      </div>

      <div style={{ margin: '18px 0 8px' }}>
        <strong>Filters</strong>
      </div>

      <GlobalFilters
        filters={globalFilters}
        postcode={postcode}
        radius={radius === 'national' ? 'national' : Number(radius)}
        onChange={setGlobalFilters}
      />

      <div style={{ margin: '18px 0 8px' }}>
        <strong>Combinations</strong>
      </div>

      {combos.map((combo, index) => (
        <ComboEditor
          key={combo.id}
          combo={combo}
          globalFilters={globalFilters}
          postcode={postcode}
          radius={radius === 'national' ? 'national' : Number(radius)}
          canRemove={combos.length > 1}
          onChange={(updated) =>
            setCombos(combos.map((c, i) => (i === index ? updated : c)))
          }
          onRemove={() => setCombos(combos.filter((_, i) => i !== index))}
        />
      ))}

      <div className="row">
        <button onClick={() => setCombos([...combos, newCombo()])}>+ Add combination</button>
        <button className="primary" onClick={save} disabled={saving || blockers.length > 0}>
          {saving ? 'Saving…' : 'Save search'}
        </button>
      </div>

      {/* A greyed-out button with no explanation is a dead end — say exactly
          what is missing, and which combination it is missing from. */}
      {blockers.length > 0 && (
        <div className="tiny muted" role="status">
          Before saving: {blockers.join('; ')}.
        </div>
      )}
    </>
  );
}
