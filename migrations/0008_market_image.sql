-- 0008_market_image.sql
-- Optional per-market image (Polymarket event image/icon), shown on market cards.
-- Often team/country-specific for sports markets; NULL for manual markets.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS image_url text;
