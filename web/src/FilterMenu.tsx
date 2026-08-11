import { useEffect, useRef, useState } from 'react';
import { ListFilter } from 'lucide-react';

export interface FilterToggle {
  key: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * The result toggles, behind one button.
 *
 * They were a row of checkboxes that pushed the toolbar to three lines on a
 * phone. They are also mostly off most of the time, so a count on the button is
 * enough to show at a glance whether anything is filtering the list.
 */
export function FilterMenu({ toggles }: { toggles: FilterToggle[] }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);

    // Dismissing by tapping elsewhere is what people expect of a menu; without
    // it the only way out on a phone is to hit the button again.
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = toggles.filter((t) => t.checked).length;

  return (
    <div className="filter-menu" ref={container}>
      <button
        type="button"
        className={`icon${active > 0 ? ' has-active' : ''}`}
        aria-label={active > 0 ? `Filters (${active} active)` : 'Filters'}
        title="Filters"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ListFilter size={18} aria-hidden="true" />
        {active > 0 && <span className="filter-menu-count">{active}</span>}
      </button>

      {open && (
        <div className="filter-menu-panel" role="group" aria-label="Result filters">
          {toggles.map((toggle) => (
            <label key={toggle.key} className="checkbox filter-menu-item">
              <input
                type="checkbox"
                checked={toggle.checked}
                onChange={(e) => toggle.onChange(e.target.checked)}
              />
              <span style={{ margin: 0 }}>{toggle.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
