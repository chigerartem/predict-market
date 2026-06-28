-- 0013_dice.sql
-- "Кости" (dice). An instant single-player game: the player picks a bet on the sum
-- of two six-sided dice, stakes, and the result is settled in the same request —
-- no shared round, unlike Ракета. Money reuses the double-entry ledger (nano-TON):
--   place : USER_BALANCE -> BET_ESCROW            (stake locked, checks the player has it)
--   win   : BET_ESCROW -> USER_BALANCE (stake)    + HOUSE_TREASURY -> USER_BALANCE (profit)
--   lose  : BET_ESCROW -> HOUSE_TREASURY          (house keeps the stake)
-- Both legs run inside one DB transaction, so a roll is atomic and the treasury can
-- never be overdrawn (the non-negative CHECK rejects a payout it can't cover).
--
-- Provably fair (commit + nonce, the crypto-casino standard): each user has a secret
-- server seed whose SHA-256 hash is shown before any roll. The outcome of roll N is
-- HMAC-SHA256(server_seed, "{client_seed}:{nonce}") with nonce incrementing per roll,
-- so the player commits to a hash, then can verify every roll. Rotating the seed
-- reveals the old server_seed (to audit past rolls) and commits a fresh one.

-- One secret seed per user, advanced by nonce each roll.
CREATE TABLE dice_seeds (
    user_id          bigint PRIMARY KEY REFERENCES users(id),
    server_seed      bytea NOT NULL,                 -- secret until rotated
    server_seed_hash text NOT NULL,                  -- SHA-256 commitment, shown before rolls
    client_seed      text NOT NULL,                   -- player-visible (and editable on rotate)
    nonce            bigint NOT NULL DEFAULT 0,        -- rolls drawn so far; next roll uses nonce+1
    created_at       timestamptz NOT NULL DEFAULT now(),
    rotated_at       timestamptz
);

-- One row per roll: the bet, the dice, the outcome, and the ledger links for audit.
CREATE TABLE dice_rolls (
    id               bigserial PRIMARY KEY,
    user_id          bigint NOT NULL REFERENCES users(id),
    nonce            bigint NOT NULL,                 -- the nonce this roll consumed
    bet_kind         text NOT NULL CHECK (bet_kind IN ('low','high','exact')),
    bet_target       smallint,                        -- 2..12 for 'exact'; NULL otherwise
    stake_nano       bigint NOT NULL CHECK (stake_nano > 0),
    die1             smallint NOT NULL CHECK (die1 BETWEEN 1 AND 6),
    die2             smallint NOT NULL CHECK (die2 BETWEEN 1 AND 6),
    sum              smallint NOT NULL CHECK (sum BETWEEN 2 AND 12),
    won              boolean NOT NULL,
    mult_milli       bigint NOT NULL,                 -- ×1000 (2280 = 2.28x)
    payout_nano      bigint NOT NULL DEFAULT 0,       -- stake*mult on win, 0 on loss
    ledger_tx_place  bigint REFERENCES ledger_transactions(id),
    ledger_tx_settle bigint REFERENCES ledger_transactions(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dice_rolls_user ON dice_rolls (user_id, id DESC);
