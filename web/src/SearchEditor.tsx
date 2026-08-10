import { useState } from 'react';
import { api, rememberSearchId, type Combo, type SavedSearch } from './api';
import { ComboEditor } from './ComboEditor';

const newCombo = (): Combo => ({
  id: Math.random().toString(36).slice(2, 8),
  label: '',
  make: '',
});

/**
 * Your worked example, offered as a starting point so the first search is one
 * click rather than twenty fields.
 */
const EXAMPLE_COMBOS: Combo[] = [
  {
    id: 'mini',
    label: 'MINI Cooper 1.5 Auto',
    make: 'MINI',
    model: 'Cooper',
    minYear: 2015,
    maxYear: 2016,
    minEngineLitres: 1.4,
    maxEngineLitres: 1.6,
    maxMileage: 85000,
    minPrice: 5500,
    maxPrice: 7000,
    transmission: 'Automatic',
    excludeWriteOffs: true,
  },
  {
    id: 'mazda',
    label: 'Mazda2 1.5 Skyactiv-G Auto',
    make: 'MAZDA',
    model: 'Mazda2',
    minYear: 2015,
    minEngineLitres: 1.4,
    maxEngineLitres: 1.6,
    maxMileage: 80000,
    minPrice: 6000,
    maxPrice: 8000,
    transmission: 'Automatic',
    excludeWriteOffs: true,
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
          canRemove={combos.length > 1}
          onChange={(updated) =>
            setCombos(combos.map((c, i) => (i === index ? updated : c)))
          }
          onRemove={() => setCombos(combos.filter((_, i) => i !== index))}
        />
      ))}

      <div className="row">
        <button onClick={() => setCombos([...combos, newCombo()])}>+ Add combination</button>
        <button className="primary" onClick={save} disabled={saving || !postcode.trim()}>
          {saving ? 'Saving…' : 'Save search'}
        </button>
      </div>
    </>
  );
}
