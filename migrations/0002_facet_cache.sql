-- Cached responses from AutoTrader's facet API, which backs the filter editor's
-- dropdowns. Keyed by the filter context, because the option lists cascade:
-- `model` options depend on the chosen make, `aggregated_trim` on the model.
--
-- Without this, every keystroke in the editor would hit AutoTrader.
CREATE TABLE IF NOT EXISTS facet_cache (
  cache_key  TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facet_cache_fetched ON facet_cache (fetched_at);
