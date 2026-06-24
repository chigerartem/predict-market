-- 0001_init_ledger.sql
-- Double-entry ledger. All money is integer nano-TON (1 TON = 1_000_000_000 nano).
-- Invariants enforced by the database, not just application code:
--   * every transaction's entries sum to zero (deferred constraint trigger);
--   * non-"external" accounts can never go negative (CHECK) — this is what makes
--     the house structurally solvent: a bet the treasury can't cover is rejected.

CREATE TABLE accounts (
    id             bigserial PRIMARY KEY,
    type           text NOT NULL CHECK (type IN (
                       'USER_BALANCE', 'BET_ESCROW', 'LIABILITY_RESERVE',
                       'HOUSE_TREASURY', 'FEE_REVENUE', 'GIFT_INVENTORY',
                       'EXTERNAL_TON', 'EXTERNAL_GIFT')),
    owner_user_id  bigint,                          -- NULL for system accounts
    currency       text NOT NULL DEFAULT 'TON',
    allow_negative boolean NOT NULL DEFAULT false,  -- only EXTERNAL_* mirror the outside world
    balance_nano   bigint NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (allow_negative OR balance_nano >= 0)
);

-- One singleton account per type for the house/system.
CREATE UNIQUE INDEX accounts_system_singleton
    ON accounts (type) WHERE owner_user_id IS NULL;
-- One account per (user, type).
CREATE UNIQUE INDEX accounts_user_acct_unique
    ON accounts (owner_user_id, type) WHERE owner_user_id IS NOT NULL;

INSERT INTO accounts (type, allow_negative) VALUES
    ('HOUSE_TREASURY',    false),
    ('FEE_REVENUE',       false),
    ('BET_ESCROW',        false),
    ('LIABILITY_RESERVE', false),
    ('GIFT_INVENTORY',    false),
    ('EXTERNAL_TON',      true),
    ('EXTERNAL_GIFT',     true);

CREATE TABLE ledger_transactions (
    id              bigserial PRIMARY KEY,
    kind            text NOT NULL,
    reference       text,
    idempotency_key text UNIQUE,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
    id          bigserial PRIMARY KEY,
    tx_id       bigint NOT NULL REFERENCES ledger_transactions(id),
    account_id  bigint NOT NULL REFERENCES accounts(id),
    amount_nano bigint NOT NULL CHECK (amount_nano <> 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_tx ON ledger_entries (tx_id);
CREATE INDEX ledger_entries_account ON ledger_entries (account_id);

-- Backstop: a transaction's entries must net to zero. Deferred so it is checked
-- once at commit, after all entries are inserted.
CREATE FUNCTION assert_tx_balanced() RETURNS trigger AS $$
DECLARE
    s bigint;
BEGIN
    SELECT COALESCE(SUM(amount_nano), 0) INTO s
    FROM ledger_entries WHERE tx_id = NEW.tx_id;
    IF s <> 0 THEN
        RAISE EXCEPTION 'ledger transaction % is unbalanced: sum=%', NEW.tx_id, s;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_assert_tx_balanced
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_tx_balanced();

CREATE TABLE audit_log (
    id         bigserial PRIMARY KEY,
    actor      text NOT NULL,
    action     text NOT NULL,
    entity     text,
    details    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
