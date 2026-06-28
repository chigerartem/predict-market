-- 0011_withdrawals.sql
-- TON withdrawals. A user requests a payout to a TON address; the balance is
-- debited atomically at request time (USER_BALANCE -> EXTERNAL_TON + FEE_REVENUE),
-- creating a 'pending' row. A background sender signs and broadcasts the on-chain
-- transfer from the house hot wallet, then marks the row 'sent' (with tx hash) or
-- 'failed'. The user receives amount_nano - fee_nano (the network fee is withheld
-- from the request and booked as house revenue).
--
-- Exactly-once payout: the sender claims a 'pending' row by flipping it to
-- 'sending' (FOR UPDATE SKIP LOCKED) before broadcasting, and never auto-retries a
-- send that errored after broadcast — a 'failed' row is left for manual review
-- rather than risk a double payout (we have no on-chain idempotency key here).

CREATE TABLE withdrawals (
    id            bigserial PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users(id),
    to_address    text NOT NULL,
    amount_nano   bigint NOT NULL CHECK (amount_nano > 0),  -- gross, debited from balance
    fee_nano      bigint NOT NULL CHECK (fee_nano >= 0),    -- withheld network/house fee
    send_nano     bigint NOT NULL CHECK (send_nano > 0),    -- actually sent on-chain (amount - fee)
    status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','failed')),
    tx_hash       text,
    ledger_tx_id  bigint REFERENCES ledger_transactions(id),
    error         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    sent_at       timestamptz
);

-- Partial index over the worker's claim query (oldest pending first).
CREATE INDEX withdrawals_pending_idx ON withdrawals (id) WHERE status = 'pending';
CREATE INDEX withdrawals_user_idx ON withdrawals (user_id, created_at DESC);
