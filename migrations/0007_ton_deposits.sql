-- TON deposits. Users send TON (via TON Connect) to a single house deposit
-- address; an otherwise-anonymous inbound transfer is attributed to a user by a
-- per-user memo carried in the transfer comment. A background watcher reads
-- confirmed inbound transfers and credits them 1:1 (native TON, no conversion).
-- Idempotency: exactly one credit per on-chain transaction hash.

ALTER TABLE users ADD COLUMN ton_deposit_memo text;
CREATE UNIQUE INDEX users_ton_deposit_memo_uq
    ON users (ton_deposit_memo) WHERE ton_deposit_memo IS NOT NULL;

CREATE TABLE ton_deposits (
    id            bigserial PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users(id),
    tx_hash       text NOT NULL UNIQUE,          -- idempotency: one credit per inbound tx
    amount_nano   bigint NOT NULL CHECK (amount_nano > 0),
    ledger_tx_id  bigint REFERENCES ledger_transactions(id),
    created_at    timestamptz NOT NULL DEFAULT now()
);
