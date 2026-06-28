-- 0012_rocket.sql
-- "Ракета" (crash game). One shared round runs for everyone in real time:
-- a BETTING window, then the multiplier climbs (FLYING) until it CRASHes at a
-- predetermined point. Players bet during BETTING and cash out mid-flight; anyone
-- still in when it crashes loses their stake.
--
-- Provably fair (commit–reveal): each round gets a secret 32-byte server seed. We
-- publish its SHA-256 hash before bets close (server_seed_hash, the commitment) and
-- reveal the seed (server_seed) after the crash, so a player can recompute the crash
-- point and confirm we didn't change it. crash_multiplier_milli is derived
-- deterministically from (seed, round id) and kept secret in this row until reveal.
--
-- Money reuses the double-entry ledger (integer nano-TON):
--   place   : USER_BALANCE -> BET_ESCROW            (stake locked)
--   cashout : BET_ESCROW -> USER_BALANCE (stake)    + HOUSE_TREASURY -> USER_BALANCE (profit)
--   bust    : BET_ESCROW -> HOUSE_TREASURY          (house keeps the stake)
-- The house edge is baked into the crash distribution, so we do NOT reserve full
-- liability up front (unlike fixed-odds bets); the treasury must stay funded to
-- cover cashout profits.

CREATE TABLE rocket_rounds (
    id                     bigserial PRIMARY KEY,
    server_seed_hash       text NOT NULL,                 -- SHA-256 commitment, published before bets close
    server_seed            bytea,                          -- revealed only after the crash
    crash_multiplier_milli bigint,                         -- ×1000 (2500 = 2.50x); secret until revealed
    status                 text NOT NULL DEFAULT 'BETTING'
                             CHECK (status IN ('BETTING','FLYING','CRASHED')),
    created_at             timestamptz NOT NULL DEFAULT now(),
    started_at             timestamptz,                    -- FLYING began
    crashed_at             timestamptz
);

CREATE INDEX rocket_rounds_created ON rocket_rounds (id DESC);

CREATE TABLE rocket_bets (
    id                       bigserial PRIMARY KEY,
    round_id                 bigint NOT NULL REFERENCES rocket_rounds(id),
    user_id                  bigint NOT NULL REFERENCES users(id),
    stake_nano               bigint NOT NULL CHECK (stake_nano > 0),
    cashout_multiplier_milli bigint,                       -- set when WON
    payout_nano              bigint NOT NULL DEFAULT 0,    -- 0 until settled; stake*mult on win
    status                   text NOT NULL DEFAULT 'PLACED'
                               CHECK (status IN ('PLACED','WON','LOST')),
    ledger_tx_place          bigint REFERENCES ledger_transactions(id),
    ledger_tx_settle         bigint REFERENCES ledger_transactions(id),
    placed_at                timestamptz NOT NULL DEFAULT now(),
    settled_at               timestamptz,
    -- One bet per user per round (keeps liability and UX simple).
    UNIQUE (round_id, user_id)
);

CREATE INDEX rocket_bets_round_status ON rocket_bets (round_id, status);
CREATE INDEX rocket_bets_user ON rocket_bets (user_id, placed_at DESC);
