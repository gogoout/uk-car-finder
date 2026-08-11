import { useCallback, useEffect, useState } from 'react';
import { api, forgetSearchId, loadMySearchIds, type SavedSearch } from './api';
import { SearchEditor } from './SearchEditor';
import { SearchView } from './SearchView';
import { relativeTime } from './format';

const SITE = 'UK Car Finder';

/** Keeps the tab and history entries distinguishable between views. */
function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
}

type Route =
  | { view: 'home' }
  | { view: 'search'; id: string }
  | { view: 'edit'; id: string | null };

function parseRoute(pathname: string): Route {
  const match = pathname.match(/^\/s\/([a-z0-9]+)/i);
  if (match?.[1]) return { view: 'search', id: match[1] };
  if (pathname === '/new') return { view: 'edit', id: null };
  return { view: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  const navigate = useCallback((path: string, next: Route) => {
    history.pushState({}, '', path);
    setRoute(next);
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  if (route.view === 'search') {
    return (
      <SearchView
        id={route.id}
        onHome={() => navigate('/', { view: 'home' })}
        onEdit={() => navigate(`/s/${route.id}`, { view: 'edit', id: route.id })}
      />
    );
  }

  if (route.view === 'edit') {
    return <EditRoute id={route.id} navigate={navigate} />;
  }

  return <Home navigate={navigate} />;
}

function EditRoute({
  id,
  navigate,
}: {
  id: string | null;
  navigate: (path: string, route: Route) => void;
}) {
  const [existing, setExisting] = useState<SavedSearch | null>(null);
  const [loading, setLoading] = useState(id !== null);

  useEffect(() => {
    if (!id) return;
    void api
      .listSearches()
      .then((all) => setExisting(all.find((s) => s.id === id) ?? null))
      .finally(() => setLoading(false));
  }, [id]);

  useDocumentTitle(existing ? `Edit ${existing.name}` : 'New search');

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <SearchEditor
      existing={existing}
      onSaved={(saved) => navigate(`/s/${saved.id}`, { view: 'search', id: saved.id })}
      onCancel={() =>
        id ? navigate(`/s/${id}`, { view: 'search', id }) : navigate('/', { view: 'home' })
      }
    />
  );
}

function Home({ navigate }: { navigate: (path: string, route: Route) => void }) {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setSearches(await api.listSearches());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useDocumentTitle(null);

  if (!searches) return <div className="empty">Loading…</div>;

  // Default to this device's searches; the toggle reveals anything created
  // elsewhere (or shared with you) that this browser hasn't seen before.
  const mine = new Set(loadMySearchIds());
  const visible = showAll ? searches : searches.filter((s) => mine.has(s.id));

  const remove = async (id: string) => {
    if (!confirm('Delete this search and its history?')) return;
    await api.deleteSearch(id);
    forgetSearchId(id);
    await load();
  };

  return (
    <>
      <header className="top">
        <h1>UK Car Finder</h1>
        <button className="primary" onClick={() => navigate('/new', { view: 'edit', id: null })}>
          New search
        </button>
      </header>

      {visible.length === 0 ? (
        <div className="empty">
          <p>No saved searches on this device yet.</p>
          <p className="small">
            Create one, or toggle below if you saved it on another device.
          </p>
        </div>
      ) : (
        visible.map((search) => (
          <div key={search.id} className="card">
            <div className="spread">
              <button
                className="link"
                style={{ fontSize: 17, fontWeight: 600 }}
                onClick={() => navigate(`/s/${search.id}`, { view: 'search', id: search.id })}
              >
                {search.name}
              </button>
              <button className="link danger" onClick={() => remove(search.id)}>
                Delete
              </button>
            </div>
            <div className="small muted">
              {search.combos.length} combination{search.combos.length === 1 ? '' : 's'} ·{' '}
              {search.postcode} · last run {relativeTime(search.lastRunAt)}
            </div>
            <div className="badges" style={{ marginTop: 8 }}>
              {search.combos.map((combo) => (
                <span key={combo.id} className="badge combo">
                  {combo.label || combo.filters.make?.join(', ') || 'Untitled'}
                </span>
              ))}
            </div>
          </div>
        ))
      )}

      {searches.length > visible.length && (
        <button className="link" onClick={() => setShowAll(true)}>
          Show {searches.length - visible.length} search(es) saved on other devices
        </button>
      )}
      {showAll && (
        <button className="link" onClick={() => setShowAll(false)}>
          Show only this device's searches
        </button>
      )}
    </>
  );
}
