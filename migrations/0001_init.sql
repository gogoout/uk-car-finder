-- Saved searches. `combos_json` holds the array of Combo objects; they are
-- always read and written as a unit, so a separate table would buy nothing.
CREATE TABLE IF NOT EXISTS searches (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  postcode     TEXT NOT NULL,
  radius       TEXT NOT NULL,
  combos_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  last_run_at  TEXT
);

-- Every listing we have ever seen, across all searches. Columns after
-- `detail_path` are filled in later by the detail-queue drain, so they are
-- null until `detail_fetched_at` is set.
CREATE TABLE IF NOT EXISTS listings (
  advert_id          TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  sub_title          TEXT,
  attention_grabber  TEXT,
  detail_path        TEXT NOT NULL,
  price              INTEGER,
  mileage            INTEGER,
  year               INTEGER,
  plate_reg          TEXT,
  price_indicator    TEXT,
  seller_type        TEXT,
  image_count        INTEGER,
  make               TEXT,
  model              TEXT,
  engine_litres      REAL,
  transmission       TEXT,
  fuel               TEXT,
  body_type          TEXT,
  doors              INTEGER,
  service_history    TEXT,
  last_service_date  TEXT,
  write_off          TEXT,
  stolen             TEXT,
  scrapped           TEXT,
  imported           TEXT,
  mot_status         TEXT,
  seller_name        TEXT,
  location           TEXT,
  image_url          TEXT,
  vrm                TEXT,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  detail_fetched_at  TEXT
);

-- Append-only price observations, written only when the price actually
-- changes. Powers the price-drop delta.
CREATE TABLE IF NOT EXISTS listing_prices (
  advert_id   TEXT NOT NULL,
  price       INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (advert_id, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_listing_prices_advert ON listing_prices (advert_id);

-- Which listings matched which combo of which search. A car can match more
-- than one combo, hence the composite key.
CREATE TABLE IF NOT EXISTS search_listings (
  search_id         TEXT NOT NULL,
  advert_id         TEXT NOT NULL,
  combo_id          TEXT NOT NULL,
  combo_label       TEXT NOT NULL,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  -- The run that first surfaced this listing. "New" means this equals the
  -- search's most recent run, which survives restarts and backfills.
  first_seen_run_id INTEGER,
  PRIMARY KEY (search_id, advert_id, combo_id)
);
CREATE INDEX IF NOT EXISTS idx_search_listings_search ON search_listings (search_id);

-- Scrape history, surfaced in the UI.
CREATE TABLE IF NOT EXISTS runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id        TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  pages_fetched    INTEGER NOT NULL DEFAULT 0,
  listings_seen    INTEGER NOT NULL DEFAULT 0,
  new_count        INTEGER NOT NULL DEFAULT 0,
  price_drop_count INTEGER NOT NULL DEFAULT 0,
  -- Listings AutoTrader returned that failed our own filter check (their
  -- promoted adverts ignore the price/year/mileage bounds we send).
  rejected_count   INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_search ON runs (search_id, id DESC);

-- Detail pages waiting to be fetched. The Workers free plan caps subrequests
-- at 50 per invocation, so detail fetches are drained in small batches.
CREATE TABLE IF NOT EXISTS fetch_queue (
  advert_id  TEXT PRIMARY KEY,
  queued_at  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS starred (
  advert_id  TEXT PRIMARY KEY,
  vrm        TEXT,
  notes      TEXT,
  starred_at TEXT NOT NULL
);

-- Cached DVSA MOT History responses, keyed by plate.
CREATE TABLE IF NOT EXISTS mot_history (
  vrm        TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  json       TEXT NOT NULL
);
