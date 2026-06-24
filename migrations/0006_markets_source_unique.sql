-- 0006_markets_source_unique.sql
-- Idempotent upsert key for externally-sourced markets (e.g. Polymarket): one row
-- per (source, source_id). Manual markets have NULL source_id and stay unconstrained.

CREATE UNIQUE INDEX markets_source_ext ON markets (source, source_id)
    WHERE source_id IS NOT NULL;
