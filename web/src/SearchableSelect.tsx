import { useMemo, useRef, useState } from 'react';
import type { FacetOption } from '../../src/autotrader/facets';

/**
 * Option picker with a type-to-filter box, for lists a native `<select>` makes
 * painful on a phone — 155 makes being the motivating case.
 *
 * Handles both single-select (make, model) and multi-select (fuel type, colour),
 * and shows AutoTrader's live result count per option.
 */
export function SearchableSelect({
  options,
  selected,
  onChange,
  multiple,
  placeholder,
  emptyMessage,
  searchable,
  label,
}: {
  options: FacetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple: boolean;
  placeholder: string;
  /** Shown when AutoTrader returns no options, e.g. a model before a make. */
  emptyMessage?: string;
  searchable: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const selectedLabels = selected
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .join(', ');

  if (options.length === 0) {
    return (
      <div className="facet-empty tiny muted">{emptyMessage ?? `No ${label.toLowerCase()} available`}</div>
    );
  }

  const toggle = (value: string) => {
    if (!multiple) {
      onChange(selected[0] === value ? [] : [value]);
      setOpen(false);
      setQuery('');
      return;
    }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="ss">
      <button
        type="button"
        className="ss-trigger"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen((v) => !v);
          // Focusing the search box on open is what makes 155 options bearable.
          if (!open) requestAnimationFrame(() => searchRef.current?.focus());
        }}
      >
        <span className={selected.length ? '' : 'muted'}>{selectedLabels || placeholder}</span>
        <span aria-hidden="true" className="ss-caret">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="ss-panel">
          {searchable && (
            <input
              ref={searchRef}
              className="ss-search"
              value={query}
              placeholder={`Search ${label.toLowerCase()}…`}
              aria-label={`Search ${label}`}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          <div className="ss-options" role="listbox" aria-multiselectable={multiple}>
            {visible.length === 0 && <div className="tiny muted ss-none">No matches</div>}
            {visible.map((option) => {
              const isSelected = selected.includes(option.value);
              return (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  className={`ss-option${isSelected ? ' is-selected' : ''}`}
                  onClick={() => toggle(option.value)}
                >
                  <span className="ss-check" aria-hidden="true">
                    {isSelected ? '✓' : ''}
                  </span>
                  <span className="ss-label">{option.label}</span>
                  {option.count !== null && (
                    <span className="ss-count tiny muted">{option.count.toLocaleString('en-GB')}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="ss-actions">
            {selected.length > 0 && (
              <button type="button" className="link" onClick={() => onChange([])}>
                Clear
              </button>
            )}
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
