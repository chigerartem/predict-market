-- 0005_star_deposit_rate.sql
-- Audit the TON/USD price each Stars deposit was credited at. Stars are valued in
-- USD at deposit time and converted to TON at the live price, so we record that
-- price (×1000, integer) to reconcile credited TON against the later Fragment
-- cash-out. Nullable: legacy rows (the fixed-peg era) have no recorded rate.

ALTER TABLE star_deposits ADD COLUMN ton_usd_milli bigint;
