-- Filters that apply to every combination in a search. Combinations still win
-- where they set the same filter themselves, so these act as defaults rather
-- than constraints. Stored as a JSON bag for the same reason combos_json is:
-- the keys are AutoTrader's filter names, not ours.
ALTER TABLE searches ADD COLUMN global_filters_json TEXT NOT NULL DEFAULT '{}';

-- Whether the advert's own text mentions the car being an import. Only used
-- when AutoTrader publishes no vehicle check, which is the minority case — the
-- IMPORTED check in `imported` remains the authoritative signal.
ALTER TABLE listings ADD COLUMN import_mentioned INTEGER NOT NULL DEFAULT 0;

-- Cars you have ruled out. Keyed on advert_id alone, like `starred`, so
-- discarding a car hides it from every search that finds it. Deliberately a
-- separate table rather than a flag on `listings`, so the listing row (and its
-- price history) survives untouched and the decision is reversible.
CREATE TABLE IF NOT EXISTS discarded (
  advert_id    TEXT PRIMARY KEY,
  discarded_at TEXT NOT NULL
);
