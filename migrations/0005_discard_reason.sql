-- Why a car was ruled out, kept with the decision itself.
--
-- `starred` already has a `notes` column from the initial schema (never used
-- until now), so only `discarded` needs one. Both live on their own table
-- rather than on `listings`: the reason belongs to the decision, and goes when
-- the decision is undone.
ALTER TABLE discarded ADD COLUMN reason TEXT;
