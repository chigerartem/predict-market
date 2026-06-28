-- 0014_treasury_allow_negative.sql
-- Operator decision (Артём): let the house float (HOUSE_TREASURY) go negative so a
-- player is NEVER blocked from betting just because the treasury is momentarily
-- short — the operator tops it up. This intentionally trades the ledger's built-in
-- solvency guarantee (0001: "non-external accounts can never go negative … a bet the
-- treasury can't cover is rejected") for unconditional play. The treasury balance
-- then reads the house's net position and may be negative until refunded.
--
-- Net effect: dice/rocket wins no longer fail with "house can't cover"; the house
-- can owe. Reversible by setting allow_negative back to false (only safe when the
-- balance is ≥ 0).

UPDATE accounts SET allow_negative = true
 WHERE type = 'HOUSE_TREASURY' AND owner_user_id IS NULL;
