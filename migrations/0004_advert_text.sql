-- Store the advert's text, and derive the import flag from it on read.
--
-- 0003 stored `import_mentioned`: the *output* of a regex, without its input.
-- That made the flag un-recomputable — changing the pattern left every existing
-- row silently wrong, repairable only by a migration, and again by another one
-- the next time the pattern changed. Storing the input instead makes the flag
-- reactive: a change to the detection takes effect everywhere immediately.
--
-- The text is about 0.9KB per listing, so a few hundred cars cost well under a
-- megabyte against D1's 5GB.
ALTER TABLE listings ADD COLUMN advert_text TEXT;
ALTER TABLE listings DROP COLUMN import_mentioned;

-- When the stored detail was last refreshed. Distinct from detail_fetched_at,
-- which records when it was *first* enriched and is what the UI reports.
-- Listings enriched before this migration have no advert_text, so the staleness
-- rule re-fetches them naturally — no separate backfill.
CREATE INDEX IF NOT EXISTS idx_listings_detail_fetched ON listings (detail_fetched_at);
