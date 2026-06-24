-- 0004_star_deposits.sql
-- Stars deposits. Users pay Telegram Stars; we credit the internal TON balance at
-- a fixed peg of 200 Stars = 1 TON (no spread). EXTERNAL_STARS mirrors the stars
-- inflow (in TON-equivalent nano) separately from EXTERNAL_TON, so the (manual,
-- Fragment) cash-out of earned stars can be audited against what we credited.

ALTER TABLE accounts DROP CONSTRAINT accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check CHECK (type IN (
    'USER_BALANCE', 'BET_ESCROW', 'LIABILITY_RESERVE',
    'HOUSE_TREASURY', 'FEE_REVENUE', 'GIFT_INVENTORY',
    'EXTERNAL_TON', 'EXTERNAL_GIFT', 'EXTERNAL_STARS'));

INSERT INTO accounts (type, allow_negative) VALUES ('EXTERNAL_STARS', true);

CREATE TABLE star_deposits (
    id                         bigserial PRIMARY KEY,
    user_id                    bigint NOT NULL REFERENCES users(id),
    telegram_payment_charge_id text NOT NULL UNIQUE,   -- idempotency: one credit per charge
    stars                      bigint NOT NULL CHECK (stars > 0),
    credited_nano              bigint NOT NULL CHECK (credited_nano >= 0),
    ledger_tx_id               bigint REFERENCES ledger_transactions(id),
    created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX star_deposits_user ON star_deposits (user_id);
