import type { Combo } from './api';

/**
 * One row of the search builder: a single spec combination, e.g.
 * "MINI Cooper, 1.4-1.6L, Auto, 2015+, under 85k, £5.5k-£7k".
 */
export function ComboEditor({
  combo,
  onChange,
  onRemove,
  canRemove,
}: {
  combo: Combo;
  onChange: (combo: Combo) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  // Empty inputs must clear the field, not become 0 — a maxPrice of 0 would
  // silently match nothing.
  const set = <K extends keyof Combo>(key: K) => (value: Combo[K]) =>
    onChange({ ...combo, [key]: value });

  const num = (key: keyof Combo) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    onChange({ ...combo, [key]: raw === '' ? undefined : Number(raw) });
  };

  const text = (key: keyof Combo) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    onChange({ ...combo, [key]: raw === '' ? undefined : raw });
  };

  return (
    <div className="card stack">
      <div className="spread">
        <strong className="small">{combo.label || 'New combination'}</strong>
        {canRemove && (
          <button type="button" className="link" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <label>
        <span>Label (shown on matching cars)</span>
        <input
          value={combo.label}
          placeholder="MINI Cooper 1.5 Auto"
          onChange={(e) => set('label')(e.target.value)}
        />
      </label>

      <div className="grid-2">
        <label>
          <span>Make *</span>
          <input value={combo.make ?? ''} placeholder="MINI" onChange={text('make')} />
        </label>
        <label>
          <span>Model</span>
          <input value={combo.model ?? ''} placeholder="Cooper" onChange={text('model')} />
        </label>
      </div>

      <div className="grid-2">
        <label>
          <span>Year from</span>
          <input type="number" inputMode="numeric" value={combo.minYear ?? ''} placeholder="2015" onChange={num('minYear')} />
        </label>
        <label>
          <span>Year to</span>
          <input type="number" inputMode="numeric" value={combo.maxYear ?? ''} placeholder="2016" onChange={num('maxYear')} />
        </label>
      </div>

      <div className="grid-2">
        <label>
          <span>Engine from (litres)</span>
          <input type="number" step="0.1" inputMode="decimal" value={combo.minEngineLitres ?? ''} placeholder="1.4" onChange={num('minEngineLitres')} />
        </label>
        <label>
          <span>Engine to (litres)</span>
          <input type="number" step="0.1" inputMode="decimal" value={combo.maxEngineLitres ?? ''} placeholder="1.6" onChange={num('maxEngineLitres')} />
        </label>
      </div>

      <div className="grid-2">
        <label>
          <span>Price from (£)</span>
          <input type="number" inputMode="numeric" value={combo.minPrice ?? ''} placeholder="5500" onChange={num('minPrice')} />
        </label>
        <label>
          <span>Price to (£)</span>
          <input type="number" inputMode="numeric" value={combo.maxPrice ?? ''} placeholder="7000" onChange={num('maxPrice')} />
        </label>
      </div>

      <div className="grid-2">
        <label>
          <span>Max mileage</span>
          <input type="number" inputMode="numeric" value={combo.maxMileage ?? ''} placeholder="85000" onChange={num('maxMileage')} />
        </label>
        <label>
          <span>Transmission</span>
          <select
            value={combo.transmission ?? ''}
            onChange={(e) =>
              onChange({
                ...combo,
                transmission: e.target.value === '' ? undefined : (e.target.value as Combo['transmission']),
              })
            }
          >
            <option value="">Any</option>
            <option value="Automatic">Automatic</option>
            <option value="Manual">Manual</option>
          </select>
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={Boolean(combo.excludeWriteOffs)}
          onChange={(e) => set('excludeWriteOffs')(e.target.checked)}
        />
        <span style={{ margin: 0 }}>Exclude write-offs (Cat S/N)</span>
      </label>
    </div>
  );
}
