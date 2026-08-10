import { useState } from 'react';
import { FacetControl } from './FacetControl';
import { buildGroups, groupFilterNames, summariseGroup } from '../../src/facetUi';
import type { FacetData } from '../../src/autotrader/facets';
import type { FilterSelections } from '../../src/types';

/**
 * AutoTrader's 27 filter groups, collapsed, in their order — their structure
 * and their titles, so the editor stays recognisable and fits a phone screen.
 * Each row shows its current selection so the whole combo reads at a glance
 * without opening anything.
 */
export function FacetAccordion({
  data,
  selections,
  onChange,
}: {
  data: FacetData;
  selections: FilterSelections;
  onChange: (filter: string, values: string[]) => void;
}) {
  // Make and model is the one group worth opening by default — it's where
  // every search starts.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['make_and_model']));

  const groups = buildGroups(data);

  const toggle = (name: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="facets">
      {groups.map((group) => {
        const isOpen = openGroups.has(group.name);
        const summary = summariseGroup(group, selections);
        const filterNames = groupFilterNames(group);
        const hasSelection = filterNames.some((n) => (selections[n]?.length ?? 0) > 0);

        return (
          <section key={group.name} className={`facet-group${hasSelection ? ' has-selection' : ''}`}>
            <button
              type="button"
              className="facet-head"
              aria-expanded={isOpen}
              onClick={() => toggle(group.name)}
            >
              <span aria-hidden="true" className="facet-caret">
                {isOpen ? '▾' : '▸'}
              </span>
              <span className="facet-title">{group.title}</span>
              <span className="facet-summary tiny muted">{summary}</span>
            </button>

            {isOpen && (
              <div className="facet-body stack">
                {group.facets.map((facet) => (
                  <FacetControl
                    key={facet.facet}
                    facet={facet}
                    selections={selections}
                    onChange={onChange}
                  />
                ))}
                {hasSelection && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => filterNames.forEach((n) => onChange(n, []))}
                  >
                    Clear {group.title.toLowerCase()}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
