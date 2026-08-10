import { useState } from 'react';
import { api, rememberSearchId, type Combo, type SavedSearch } from './api';
import { ComboEditor } from './ComboEditor';

const newCombo = (): Combo => ({
  id: Math.random().toString(36).slice(2, 8),
  label: '',
  filters: {},
});

/**
 * Your worked example, offered as a starting point so the first search is one
 * click rather than twenty dropdowns.
 */
const EXAMPLE_COMBOS: Combo[] = [
  {
    id: 'mini',
    label: 'MINI Cooper 1.5 Auto',
    labelIsCustom: true,
    filters: {
      make: ['MINI'],
      model: ['Cooper'],
      min_year_manufactured: ['2015'],
      max_year_manufactured: ['2016'],
      min_engine_size: ['1.4'],
      max_engine_size: ['1.6'],
      max_mileage: ['85000'],
      min_price: ['5500'],
      max_price: ['7000'],
      transmission: ['Automatic'],
      is_writeoff: ['exclude'],
    },
  },
  {
    id: 'mazda',
    label: 'Mazda2 1.5 Skyactiv-G Auto',
    labelIsCustom: true,
    filters: {
      make: ['MAZDA'],
      model: ['Mazda2'],
      min_year_manufactured: ['2015'],
      min_engine_size: ['1.4'],
      max_engine_size: ['1.6'],
      max_mileage: ['80000'],
      min_price: ['6000'],
      max_price: ['8000'],
      transmission: ['Automatic'],
      is_writeoff: ['exclude'],
    },
  },
];

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim() || 'Untitled search',
        postcode: postcode.trim(),
        radius: radius === 'national' ? ('national' as const) : Number(radius),
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

      <div className="spread" style={{ margin: '18px 0 8px' }}>
        <strong>Combinations</strong>
        {!existing && (
          <button className="link" onClick={() => setCombos(EXAMPLE_COMBOS)}>
            Use MINI + Mazda2 example
          </button>
        )}
      </div>

      {combos.map((combo, index) => (
        <ComboEditor
          key={combo.id}
          combo={combo}
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
        <button
          className="primary"
          onClick={save}
          disabled={saving || !postcode.trim() || !combos.every((c) => c.filters.make?.length)}
        >
          {saving ? 'Saving…' : 'Save search'}
        </button>
      </div>
      {!combos.every((c) => c.filters.make?.length) && (
        <div className="tiny muted">Every combination needs a make before it can be saved.</div>
      )}
    </>
  );
}
