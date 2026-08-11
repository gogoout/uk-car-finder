import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, rememberSearchId, type ResultsResponse, type RunRow } from './api';
import { ResultCard } from './ResultCard';
import { ListingModal } from './ListingModal';
import { CopyButton } from './CopyButton';
import { FilterMenu } from './FilterMenu';
import { relativeTime, sortResults, type SortKey } from './format';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'price-asc', label: 'Cheapest' },
  { key: 'price-desc', label: 'Dearest' },
  { key: 'mileage-asc', label: 'Lowest mileage' },
  { key: 'year-desc', label: 'Newest year' },
  { key: 'price-rating', label: 'Best price rating' },
];

export function SearchView({ id, onEdit, onHome }: { id: string; onEdit: () => void; onHome: () => void }) {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>('newest');
  const [excludeWriteOffs, setExcludeWriteOffs] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [openAdvertId, setOpenAdvertId] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [results, runHistory] = await Promise.all([
        api.getResults(id, excludeWriteOffs, showDiscarded),
        api.getRuns(id),
      ]);
      setData(results);
      setRuns(runHistory);
      // Opening a shared /s/:id link adds it to this device's list.
      rememberSearchId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [id, excludeWriteOffs, showDiscarded]);

  useEffect(() => {
    void load();
  }, [load]);

  // Named tab, so several saved searches are distinguishable when pinned.
  useEffect(() => {
    if (data?.search.name) document.title = `${data.search.name} · UK Car Finder`;
    return () => {
      document.title = 'UK Car Finder';
    };
  }, [data?.search.name]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refresh(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const toggleStar = async (advertId: string, starred: boolean) => {
    await api.setStarred(advertId, starred);
    await load();
  };

  const discard = async (advertId: string, discarded: boolean) => {
    await api.setDiscarded(advertId, discarded);
    await load();
  };

  const saveVrm = async (advertId: string, vrm: string) => {
    await api.setVrm(advertId, vrm);
    await load();
  };

  const visible = useMemo(() => {
    if (!data) return [];
    let listings = data.results;
    if (onlyNew) listings = listings.filter((l) => l.isNew);
    if (onlyStarred) listings = listings.filter((l) => l.starred);
    return sortResults(listings, sort);
  }, [data, sort, onlyNew, onlyStarred]);

  const newCount = data?.results.filter((l) => l.isNew).length ?? 0;
  const dropCount = data?.results.filter((l) => l.priceDrop !== null).length ?? 0;

  if (error) {
    return (
      <>
        <div className="banner">{error}</div>
        <button onClick={onHome}>Back to searches</button>
      </>
    );
  }

  if (!data) return <div className="empty">Loading…</div>;

  return (
    <>
      <header className="top">
        <div>
          <h1>{data.search.name}</h1>
          <div className="small muted">
            {data.search.postcode} ·{' '}
            {data.search.radius === 'national' ? 'National' : `${data.search.radius} miles`} · last
            run {relativeTime(data.search.lastRunAt)}
          </div>
        </div>
        <button className="link" onClick={onHome}>
          All searches
        </button>
      </header>

      {/* One line: actions as icons, sort inline, and the toggles behind a
          menu — the checkbox row and a full-width sort pushed this to three. */}
      <div className="toolbar toolbar-row">
        <button
          className="primary icon"
          onClick={refresh}
          disabled={refreshing}
          aria-label={refreshing ? 'Refreshing' : 'Refresh now'}
          title="Refresh now"
        >
          <span className={refreshing ? 'spin' : ''} aria-hidden="true">
            ⟳
          </span>
        </button>

        <button className="icon" onClick={onEdit} aria-label="Edit filters" title="Edit filters">
          <span aria-hidden="true">⚙</span>
        </button>

        <CopyButton
          value={`${location.origin}/s/${id}`}
          label="🔗"
          copiedLabel="✓"
          failedLabel="⚠"
          className="icon"
          ariaLabel="Copy share link"
          title="Copy share link"
        />

        <select
          className="toolbar-sort"
          aria-label="Sort results"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        <FilterMenu
          toggles={[
            { key: 'new', label: `New (${newCount})`, checked: onlyNew, onChange: setOnlyNew },
            { key: 'starred', label: 'Shortlist', checked: onlyStarred, onChange: setOnlyStarred },
            {
              key: 'writeoffs',
              label: 'Hide write-offs',
              checked: excludeWriteOffs,
              onChange: setExcludeWriteOffs,
            },
            ...(data.discardedCount > 0 || showDiscarded
              ? [
                  {
                    key: 'discarded',
                    label: `Discarded (${data.discardedCount})`,
                    checked: showDiscarded,
                    onChange: setShowDiscarded,
                  },
                ]
              : []),
          ]}
        />
      </div>

      <div className="small muted" style={{ marginBottom: 10 }}>
        {visible.length} of {data.results.length} shown · {dropCount} price drops
        {data.pendingDetails > 0 && ` · ${data.pendingDetails} awaiting details`}
        {' · '}
        <button className="link" onClick={() => setShowRuns((v) => !v)}>
          {showRuns ? 'hide' : 'show'} run history
        </button>
      </div>

      {excludeWriteOffs && (
        <div className="banner info">
          Only cars AutoTrader positively cleared are shown. Adverts with no history check at all
          are hidden too — absent data isn't the same as clean.
        </div>
      )}

      {showRuns && (
        <div className="card scroll-x">
          <table className="runs">
            <thead>
              <tr>
                <th>When</th>
                <th>Pages</th>
                <th>Seen</th>
                <th>New</th>
                <th>Drops</th>
                <th title="Promoted adverts AutoTrader returned that ignored your filters">Rejected</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{relativeTime(run.started_at)}</td>
                  <td>{run.pages_fetched}</td>
                  <td>{run.listings_seen}</td>
                  <td>{run.new_count}</td>
                  <td>{run.price_drop_count}</td>
                  <td className="muted">{run.rejected_count}</td>
                  <td className="muted">{run.error ?? '—'}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No runs yet — hit Refresh now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="empty">
          Nothing matches yet. Try Refresh now, or widen the filters.
        </div>
      ) : (
        <div className="results">
          {visible.map((listing) => (
            <ResultCard
              key={listing.advertId}
              listing={listing}
              onToggleStar={toggleStar}
              onSetVrm={saveVrm}
              onOpen={setOpenAdvertId}
              onDiscard={discard}
            />
          ))}
        </div>
      )}

      {openAdvertId && (
        <ListingModal advertId={openAdvertId} onClose={() => setOpenAdvertId(null)} />
      )}
    </>
  );
}
