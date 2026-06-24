-- 0002_markets_bets.sql
-- Prediction markets, their outcomes, and bets placed against the house.
-- Odds are stored as decimal odds x1000 (odds_milli): 2500 = 2.50.

CREATE TABLE markets (
    id                  bigserial PRIMARY KEY,
    source              text NOT NULL DEFAULT 'manual',
    source_id           text,
    title               text NOT NULL,
    category            text,
    status              text NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN','CLOSED','RESOLVING','RESOLVED','CANCELLED')),
    close_time          timestamptz,
    resolved_outcome_id bigint,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outcomes (
    id                 bigserial PRIMARY KEY,
    market_id          bigint NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    title              text NOT NULL,
    odds_milli         bigint NOT NULL CHECK (odds_milli > 1000),  -- decimal odds x1000, > 1.0
    max_liability_nano bigint,                                     -- per-outcome cap; NULL = none
    total_stake_nano   bigint NOT NULL DEFAULT 0,
    total_payout_nano  bigint NOT NULL DEFAULT 0,                  -- liability if this outcome wins
    sort_order         integer NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outcomes_market ON outcomes (market_id);

ALTER TABLE markets
    ADD CONSTRAINT markets_resolved_outcome_fk
    FOREIGN KEY (resolved_outcome_id) REFERENCES outcomes(id);

CREATE TABLE bets (
    id               bigserial PRIMARY KEY,
    user_id          bigint NOT NULL,
    market_id        bigint NOT NULL REFERENCES markets(id),
    outcome_id       bigint NOT NULL REFERENCES outcomes(id),
    stake_nano       bigint NOT NULL CHECK (stake_nano > 0),
    odds_milli       bigint NOT NULL,
    payout_nano      bigint NOT NULL CHECK (payout_nano > stake_nano),
    status           text NOT NULL DEFAULT 'PLACED'
                       CHECK (status IN ('PLACED','WON','LOST','VOID')),
    ledger_tx_place  bigint REFERENCES ledger_transactions(id),
    ledger_tx_settle bigint REFERENCES ledger_transactions(id),
    placed_at        timestamptz NOT NULL DEFAULT now(),
    settled_at       timestamptz
);

CREATE INDEX bets_user ON bets (user_id);
CREATE INDEX bets_market_status ON bets (market_id, status);
CREATE INDEX bets_outcome ON bets (outcome_id);
