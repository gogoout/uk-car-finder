-- When an advert stopped existing on AutoTrader.
--
-- Sold and withdrawn cars keep returning a page, so this can only be learned by
-- looking. Stored as the timestamp of the observation rather than a flag, and
-- cleared the moment the advert is seen again — a relisted car is not gone.
ALTER TABLE listings ADD COLUMN gone_at TEXT;
