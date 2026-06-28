-- 0009_market_volume.sql
-- Polymarket 24h trading volume, used to order the feed by popularity within a
-- category (most-traded first). NULL for manual markets — they sort last.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS volume_24h double precision;
