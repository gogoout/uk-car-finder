/**
 * D1 access layer. Everything that touches SQL lives here so the jobs and API
 * routes stay readable and testable.
 */

import {
  effectiveCombo,
  type Combo,
  type ListingDetail,
  type ResultListing,
  type SavedSearch,
  type SearchListing,
} from '../types';
import { migrateCombos } from './migrateCombo';
import { storedListingMatches } from '../autotrader/match';

const now = () => new Date().toISOString();

/**
 * Combo labels are aggregated with GROUP_CONCAT. The default separator is a
 * comma, which a label like "MINI Cooper, Clubman" would split on and corrupt.
 * A unit separator cannot occur in a label typed by a human.
 */
const LABEL_SEPARATOR = '\x1f';
/** Separates combo id from label within one aggregated entry. */
const FIELD_SEPARATOR = '\x1e';

/* ------------------------------------------------------------------ searches */

interface SearchRow {
  id: string;
  name: string;
  global_filters_json: string | null;
  postcode: string;
  radius: string;
  combos_json: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
}

function toSavedSearch(row: SearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    postcode: row.postcode,
    radius: row.radius === 'national' ? 'national' : Number(row.radius),
    // Rows written before global filters existed have no column value.
    globalFilters: row.global_filters_json ? JSON.parse(row.global_filters_json) : {},
    // Combos saved before filters became an open bag are converted on read;
    // the column is a JSON blob, so there is no SQL migration to run.
    combos: migrateCombos(JSON.parse(row.combos_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
  };
}

export async function listSearches(db: D1Database): Promise<SavedSearch[]> {
  const { results } = await db
    .prepare('SELECT * FROM searches ORDER BY updated_at DESC')
    .all<SearchRow>();
  return results.map(toSavedSearch);
}

export async function getSearch(db: D1Database, id: string): Promise<SavedSearch | null> {
  const row = await db.prepare('SELECT * FROM searches WHERE id = ?').bind(id).first<SearchRow>();
  return row ? toSavedSearch(row) : null;
}

export async function upsertSearch(
  db: D1Database,
  search: Omit<SavedSearch, 'createdAt' | 'updatedAt' | 'lastRunAt'>,
): Promise<SavedSearch> {
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO searches
         (id, name, postcode, radius, combos_json, global_filters_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         postcode = excluded.postcode,
         radius = excluded.radius,
         combos_json = excluded.combos_json,
         global_filters_json = excluded.global_filters_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      search.id,
      search.name,
      search.postcode,
      String(search.radius),
      JSON.stringify(search.combos),
      JSON.stringify(search.globalFilters ?? {}),
      timestamp,
      timestamp,
    )
    .run();

  const saved = await getSearch(db, search.id);
  if (!saved) throw new Error(`Search ${search.id} vanished immediately after upsert`);
  return saved;
}

export async function deleteSearch(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM search_listings WHERE search_id = ?').bind(id),
    db.prepare('DELETE FROM runs WHERE search_id = ?').bind(id),
    db.prepare('DELETE FROM searches WHERE id = ?').bind(id),
  ]);
}

/* ------------------------------------------------------------------- listings */

/**
 * Records a listing seen in search results. Detail-page columns are left alone
 * so a re-run never wipes enrichment we have already paid for.
 *
 * Returns true if this is a listing we have never seen before.
 */
export async function upsertSearchListing(
  db: D1Database,
  listing: SearchListing,
  seenAt = now(),
): Promise<boolean> {
  const existing = await db
    .prepare('SELECT advert_id FROM listings WHERE advert_id = ?')
    .bind(listing.advertId)
    .first<{ advert_id: string }>();

  await db
    .prepare(
      `INSERT INTO listings (
         advert_id, title, sub_title, attention_grabber, detail_path,
         price, mileage, year, plate_reg, price_indicator, seller_type,
         image_count, image_url, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(advert_id) DO UPDATE SET
         title = excluded.title,
         sub_title = excluded.sub_title,
         attention_grabber = excluded.attention_grabber,
         price = excluded.price,
         mileage = excluded.mileage,
         image_count = excluded.image_count,
         -- Keeps the cover photo current, and gives brand-new listings one
         -- immediately instead of waiting for the detail queue.
         image_url = COALESCE(excluded.image_url, listings.image_url),
         -- Search badges are the freshest price-indicator source we have.
         price_indicator = COALESCE(excluded.price_indicator, listings.price_indicator),
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      listing.advertId,
      listing.title,
      listing.subTitle,
      listing.attentionGrabber,
      listing.detailPath,
      listing.price,
      listing.mileage,
      listing.year,
      listing.plateReg,
      listing.priceIndicator,
      listing.sellerType,
      listing.imageCount,
      listing.imageUrl,
      seenAt,
      seenAt,
    )
    .run();

  return !existing;
}

/**
 * Appends to the price history only when the price has actually moved.
 * Returns true if a drop was recorded.
 */
export async function recordPrice(
  db: D1Database,
  advertId: string,
  price: number | null,
  observedAt = now(),
): Promise<boolean> {
  if (price === null) return false;

  const last = await db
    .prepare('SELECT price FROM listing_prices WHERE advert_id = ? ORDER BY observed_at DESC LIMIT 1')
    .bind(advertId)
    .first<{ price: number }>();

  if (last?.price === price) return false;

  await db
    .prepare(
      `INSERT INTO listing_prices (advert_id, price, observed_at) VALUES (?, ?, ?)
       ON CONFLICT(advert_id, observed_at) DO NOTHING`,
    )
    .bind(advertId, price, observedAt)
    .run();

  return last !== null && price < last.price;
}

export async function applyDetail(
  db: D1Database,
  detail: ListingDetail,
  fetchedAt = now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE listings SET
         make = ?, model = ?, engine_litres = ?, transmission = ?, fuel = ?,
         body_type = ?, doors = ?, service_history = ?, last_service_date = ?,
         write_off = ?, stolen = ?, scrapped = ?, imported = ?, mot_status = ?,
         seller_name = ?, location = ?, import_mentioned = ?,
         image_url = COALESCE(?, image_url),
         year = COALESCE(?, year),
         mileage = COALESCE(?, mileage),
         plate_reg = COALESCE(?, plate_reg),
         price_indicator = COALESCE(?, price_indicator),
         -- Never overwrite a plate the user typed in with a null we scraped.
         vrm = COALESCE(vrm, ?),
         detail_fetched_at = ?
       WHERE advert_id = ?`,
    )
    .bind(
      detail.make,
      detail.model,
      detail.engineLitres,
      detail.transmission,
      detail.fuel,
      detail.bodyType,
      detail.doors,
      detail.serviceHistory,
      detail.lastServiceDate,
      detail.writeOff,
      detail.stolen,
      detail.scrapped,
      detail.imported,
      detail.motStatus,
      detail.sellerName,
      detail.location,
      detail.importMentioned ? 1 : 0,
      detail.imageUrl,
      detail.year,
      detail.mileage,
      detail.plateReg,
      detail.priceIndicator === 'NOANALYSIS' ? null : detail.priceIndicator,
      detail.vrm,
      fetchedAt,
      detail.advertId,
    )
    .run();
}

/* ------------------------------------------------------------ search_listings */

export async function linkListingToCombo(
  db: D1Database,
  searchId: string,
  advertId: string,
  combo: Pick<Combo, 'id' | 'label'>,
  runId: number,
  seenAt = now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO search_listings
         (search_id, advert_id, combo_id, combo_label, first_seen_at, last_seen_at, first_seen_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(search_id, advert_id, combo_id) DO UPDATE SET
         combo_label = excluded.combo_label,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(searchId, advertId, combo.id, combo.label, seenAt, seenAt, runId)
    .run();
}

export interface ListingLink {
  search_id: string;
  combo_id: string;
}

export async function listLinksForAdvert(
  db: D1Database,
  advertId: string,
): Promise<ListingLink[]> {
  const { results } = await db
    .prepare('SELECT search_id, combo_id FROM search_listings WHERE advert_id = ?')
    .bind(advertId)
    .all<ListingLink>();
  return results;
}

export async function unlinkListingFromCombo(
  db: D1Database,
  searchId: string,
  advertId: string,
  comboId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM search_listings WHERE search_id = ? AND advert_id = ? AND combo_id = ?')
    .bind(searchId, advertId, comboId)
    .run();
}

/* ----------------------------------------------------------------- fetch queue */

export async function enqueueDetail(db: D1Database, advertId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO fetch_queue (advert_id, queued_at) VALUES (?, ?)
       ON CONFLICT(advert_id) DO NOTHING`,
    )
    .bind(advertId, now())
    .run();
}

export interface QueueItem {
  advert_id: string;
  attempts: number;
}

/** Oldest first, skipping anything that has already failed repeatedly. */
export async function takeQueueBatch(
  db: D1Database,
  limit: number,
  maxAttempts = 3,
): Promise<QueueItem[]> {
  const { results } = await db
    .prepare(
      `SELECT advert_id, attempts FROM fetch_queue
       WHERE attempts < ? ORDER BY queued_at ASC LIMIT ?`,
    )
    .bind(maxAttempts, limit)
    .all<QueueItem>();
  return results;
}

export async function dequeueDetail(db: D1Database, advertId: string): Promise<void> {
  await db.prepare('DELETE FROM fetch_queue WHERE advert_id = ?').bind(advertId).run();
}

export async function recordQueueFailure(
  db: D1Database,
  advertId: string,
  error: string,
): Promise<void> {
  await db
    .prepare('UPDATE fetch_queue SET attempts = attempts + 1, last_error = ? WHERE advert_id = ?')
    .bind(error.slice(0, 500), advertId)
    .run();
}

export async function queueDepth(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM fetch_queue WHERE attempts < 3')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------------ runs */

export async function startRun(db: D1Database, searchId: string): Promise<number> {
  const row = await db
    .prepare('INSERT INTO runs (search_id, started_at) VALUES (?, ?) RETURNING id')
    .bind(searchId, now())
    .first<{ id: number }>();
  if (!row) throw new Error('Failed to create run row');
  return row.id;
}

export interface RunTotals {
  pagesFetched: number;
  listingsSeen: number;
  newCount: number;
  priceDropCount: number;
  rejectedCount?: number;
  error?: string | null;
}

export async function finishRun(db: D1Database, runId: number, totals: RunTotals): Promise<void> {
  const finishedAt = now();
  await db.batch([
    db
      .prepare(
        `UPDATE runs SET finished_at = ?, pages_fetched = ?, listings_seen = ?,
           new_count = ?, price_drop_count = ?, rejected_count = ?, error = ?
         WHERE id = ?`,
      )
      .bind(
        finishedAt,
        totals.pagesFetched,
        totals.listingsSeen,
        totals.newCount,
        totals.priceDropCount,
        totals.rejectedCount ?? 0,
        totals.error ?? null,
        runId,
      ),
    db
      .prepare(
        'UPDATE searches SET last_run_at = ? WHERE id = (SELECT search_id FROM runs WHERE id = ?)',
      )
      .bind(finishedAt, runId),
  ]);
}

export interface RunRow {
  id: number;
  search_id: string;
  started_at: string;
  finished_at: string | null;
  pages_fetched: number;
  listings_seen: number;
  new_count: number;
  price_drop_count: number;
  rejected_count: number;
  error: string | null;
}

export async function listRuns(db: D1Database, searchId: string, limit = 25): Promise<RunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM runs WHERE search_id = ? ORDER BY id DESC LIMIT ?')
    .bind(searchId, limit)
    .all<RunRow>();
  return results;
}

async function latestFinishedRunId(db: D1Database, searchId: string): Promise<number | null> {
  const row = await db
    .prepare(
      'SELECT id FROM runs WHERE search_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1',
    )
    .bind(searchId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/* --------------------------------------------------------------------- results */

interface ResultRow {
  advert_id: string;
  title: string;
  sub_title: string | null;
  attention_grabber: string | null;
  detail_path: string;
  price: number | null;
  mileage: number | null;
  year: number | null;
  plate_reg: string | null;
  price_indicator: string | null;
  seller_type: string | null;
  image_count: number | null;
  make: string | null;
  model: string | null;
  engine_litres: number | null;
  transmission: string | null;
  fuel: string | null;
  body_type: string | null;
  doors: number | null;
  service_history: string | null;
  last_service_date: string | null;
  write_off: string | null;
  stolen: string | null;
  scrapped: string | null;
  imported: string | null;
  mot_status: string | null;
  seller_name: string | null;
  location: string | null;
  image_url: string | null;
  vrm: string | null;
  first_seen_at: string;
  last_seen_at: string;
  detail_fetched_at: string | null;
  combo_labels: string;
  first_seen_run_id: number | null;
  high_price: number | null;
  starred: number;
  discarded: number;
  import_mentioned: number | null;
}

export interface ResultsOptions {
  /** Hide anything not positively cleared by AutoTrader's write-off check. */
  excludeWriteOffs?: boolean;
  /** Show the cars you have discarded instead of hiding them. */
  includeDiscarded?: boolean;
}

export async function getResults(
  db: D1Database,
  searchId: string,
  opts: ResultsOptions = {},
): Promise<ResultListing[]> {
  const latestRunId = await latestFinishedRunId(db, searchId);

  const { results } = await db
    .prepare(
      `SELECT l.*,
              -- id and label together, so each credit can be matched back to
              -- the combo that claims it. SQLite rejects
              -- GROUP_CONCAT(DISTINCT x, sep), so dedupe in JS instead — a
              -- listing matches only a handful of combos.
              GROUP_CONCAT(sl.combo_id || '${FIELD_SEPARATOR}' || sl.combo_label,
                           '${LABEL_SEPARATOR}') AS combo_labels,
              MIN(sl.first_seen_run_id) AS first_seen_run_id,
              (SELECT MAX(price) FROM listing_prices p WHERE p.advert_id = l.advert_id) AS high_price,
              (SELECT COUNT(*) FROM starred s WHERE s.advert_id = l.advert_id) AS starred,
              (SELECT COUNT(*) FROM discarded d WHERE d.advert_id = l.advert_id) AS discarded
       FROM listings l
       JOIN search_listings sl ON sl.advert_id = l.advert_id
       WHERE sl.search_id = ?
       GROUP BY l.advert_id
       ORDER BY l.last_seen_at DESC`,
    )
    .bind(searchId)
    .all<ResultRow>();

  const mapped = results.map((row): ResultListing => {
    // "Down from" uses the highest price we ever observed, so a car that has
    // been cut twice shows the full reduction rather than only the last step.
    const priceDrop =
      row.price !== null && row.high_price !== null && row.high_price > row.price
        ? row.high_price - row.price
        : null;

    return {
      advertId: row.advert_id,
      title: row.title,
      subTitle: row.sub_title,
      detailUrl: `https://www.autotrader.co.uk${row.detail_path}`,
      price: row.price,
      mileage: row.mileage,
      year: row.year,
      plateReg: row.plate_reg,
      make: row.make,
      model: row.model,
      engineLitres: row.engine_litres,
      transmission: (row.transmission as ResultListing['transmission']) ?? null,
      fuel: row.fuel,
      bodyType: row.body_type,
      doors: row.doors,
      priceIndicator: (row.price_indicator as ResultListing['priceIndicator']) ?? null,
      serviceHistory: (row.service_history as ResultListing['serviceHistory']) ?? null,
      lastServiceDate: row.last_service_date,
      writeOff: (row.write_off as ResultListing['writeOff']) ?? null,
      stolen: (row.stolen as ResultListing['stolen']) ?? null,
      scrapped: (row.scrapped as ResultListing['scrapped']) ?? null,
      imported: (row.imported as ResultListing['imported']) ?? null,
      motStatus: row.mot_status,
      sellerName: row.seller_name,
      sellerType: row.seller_type,
      location: row.location,
      imageUrl: row.image_url,
      // Filled in below, once each credit has been re-checked against the
      // combo as it stands now.
      matchedCombos: [],
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      detailFetchedAt: row.detail_fetched_at,
      isNew: latestRunId !== null && row.first_seen_run_id === latestRunId,
      priceDrop,
      previousPrice: priceDrop !== null ? row.high_price : null,
      starred: row.starred > 0,
      discarded: row.discarded > 0,
      importMentioned: row.import_mentioned === 1,
      vrm: row.vrm,
    };
  });

  // Re-check every credit against the combo's current filters. A link is
  // written when a listing matches and is never revisited, so narrowing a combo
  // would otherwise leave the newly-excluded cars on screen — AutoTrader just
  // stops returning them, and nothing removes the existing link.
  // Globals must be layered on here too: without it, tightening a global would
  // not retro-filter listings already stored — the same gap that once left
  // over-priced cars on screen after narrowing a combination.
  const search = await getSearch(db, searchId);
  const combosById = new Map(
    (search?.combos ?? []).map((c) => [c.id, effectiveCombo(c, search?.globalFilters)]),
  );

  const verified: ResultListing[] = [];
  for (const [index, listing] of mapped.entries()) {
    const credits = (results[index]?.combo_labels ?? '')
      .split(LABEL_SEPARATOR)
      .filter(Boolean)
      .map((entry) => entry.split(FIELD_SEPARATOR)[0]!);

    const stillMatching = [...new Set(credits)]
      // A combo deleted from the search stops crediting anything.
      .map((id) => combosById.get(id))
      .filter((combo): combo is Combo => combo !== undefined)
      .filter((combo) => storedListingMatches(listing, combo).matches);

    if (stillMatching.length === 0) continue;
    // Discarded cars stay in the database — price history and delta tracking
    // carry on — they are simply not shown unless asked for.
    if (listing.discarded && !opts.includeDiscarded) continue;
    // Use the combo's current label rather than the one stored at link time.
    verified.push({ ...listing, matchedCombos: stillMatching.map((c) => c.label) });
  }

  // Only PASSED counts as cleared: an advert with no vehicleCheck block reports
  // UNKNOWN, and hiding those is the point of ticking the box.
  return opts.excludeWriteOffs ? verified.filter((l) => l.writeOff === 'PASSED') : verified;
}

/* -------------------------------------------------------------------- starring */

export async function setStarred(
  db: D1Database,
  advertId: string,
  starred: boolean,
): Promise<void> {
  if (starred) {
    await db
      .prepare(
        'INSERT INTO starred (advert_id, starred_at) VALUES (?, ?) ON CONFLICT(advert_id) DO NOTHING',
      )
      .bind(advertId, now())
      .run();
  } else {
    await db.prepare('DELETE FROM starred WHERE advert_id = ?').bind(advertId).run();
  }
}

/**
 * Rule a car out. Stored separately from `listings` so the listing and its
 * price history survive, and the decision can be undone.
 */
export async function setDiscarded(
  db: D1Database,
  advertId: string,
  discarded: boolean,
): Promise<void> {
  if (discarded) {
    await db
      .prepare(
        'INSERT INTO discarded (advert_id, discarded_at) VALUES (?, ?) ON CONFLICT(advert_id) DO NOTHING',
      )
      .bind(advertId, now())
      .run();
  } else {
    await db.prepare('DELETE FROM discarded WHERE advert_id = ?').bind(advertId).run();
  }
}

/** How many of a search's results are currently hidden as discarded. */
export async function countDiscarded(db: D1Database, searchId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT sl.advert_id) AS n
       FROM search_listings sl
       JOIN discarded d ON d.advert_id = sl.advert_id
       WHERE sl.search_id = ?`,
    )
    .bind(searchId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setVrm(db: D1Database, advertId: string, vrm: string | null): Promise<void> {
  const normalised = vrm ? vrm.toUpperCase().replace(/\s+/g, '') : null;
  await db.batch([
    db.prepare('UPDATE listings SET vrm = ? WHERE advert_id = ?').bind(normalised, advertId),
    db
      .prepare(
        `INSERT INTO starred (advert_id, vrm, starred_at) VALUES (?, ?, ?)
         ON CONFLICT(advert_id) DO UPDATE SET vrm = excluded.vrm`,
      )
      .bind(advertId, normalised, now()),
  ]);
}
