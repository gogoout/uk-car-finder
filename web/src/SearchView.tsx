import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, rememberSearchId, type ResultsResponse, type RunRow } from './api';
import { ResultCard } from './ResultCard';
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

  const load = useCallback(async () => {
    try {
      setError(null);
      const [results, runHistory] = await Promise.all([
        api.getResults(id, excludeWriteOffs),
        api.getRuns(id),
      ]);
      setData(results);
      setRuns(runHistory);
      // Opening a shared /s/:id link adds it to this device's list.
      rememberSearchId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [id, excludeWriteOffs]);

  useEffect(() => {
    void load();
  }, [load]);

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

      <div className="toolbar stack">
        <div className="row">
          <button className="primary" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
          <button onClick={onEdit}>Edit filters</button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(`${location.origin}/s/${id}`);
            }}
          >
            Copy share link
          </button>
        </div>

        <div className="row">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ flex: 1 }}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <label className="checkbox">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            <span style={{ margin: 0 }}>New ({newCount})</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={onlyStarred}
              onChange={(e) => setOnlyStarred(e.target.checked)}
            />
            <span style={{ margin: 0 }}>Shortlist</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={excludeWriteOffs}
              onChange={(e) => setExcludeWriteOffs(e.target.checked)}
            />
            <span style={{ margin: 0 }}>Hide write-offs</span>
          </label>
        </div>
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
            />
          ))}
        </div>
      )}
    </>
  );
}
