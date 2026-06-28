-- 0010_market_details.sql
-- Richer per-market detail mirrored from Polymarket, shown on the bet screen:
-- description (resolution criteria), context_description (human-readable preview),
-- and game_start_time (exact match kickoff). All NULL for manual markets.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS context_description text;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS game_start_time timestamptz;
