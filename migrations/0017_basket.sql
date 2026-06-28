-- 0017_basket.sql
-- "Баскетбол" — мгновенная одиночная игра. Игрок ставит любую сумму и бросает мяч:
-- попал (выигрыш = ставка × множитель) или мимо (ставка теряется). Как «Кости», без
-- общего раунда — исход считается в том же запросе. Деньги через двойную запись (нано-TON):
--   place : USER_BALANCE -> BET_ESCROW            (ставка списана и заперта)
--   win   : BET_ESCROW -> USER_BALANCE (ставка)   + HOUSE_TREASURY -> USER_BALANCE (профит)
--   miss  : BET_ESCROW -> HOUSE_TREASURY          (дом забирает ставку)
-- Обе ноги — в одной транзакции, бросок атомарен; казна не уходит в минус сверх
-- разрешённого (0014).
--
-- Provably fair (commit + nonce, как в «Костях»): у юзера секретный server seed, его
-- SHA-256 хэш показан до броска. Исход броска N = HMAC-SHA256(server_seed,
-- "{client_seed}:{nonce}") → roll в [0,10000); попадание = roll < HIT_PROB_BP.
-- Ротация раскрывает старый seed для проверки.

-- Один секретный seed на юзера, двигается nonce'ом каждый бросок.
CREATE TABLE basket_seeds (
    user_id          bigint PRIMARY KEY REFERENCES users(id),
    server_seed      bytea NOT NULL,                  -- секрет до ротации
    server_seed_hash text NOT NULL,                   -- SHA-256 commitment, показан до бросков
    client_seed      text NOT NULL,                    -- виден игроку (редактируется при ротации)
    nonce            bigint NOT NULL DEFAULT 0,         -- бросков сделано; следующий берёт nonce+1
    created_at       timestamptz NOT NULL DEFAULT now(),
    rotated_at       timestamptz
);

-- Один ряд на бросок: ставка, выпавший roll, исход, выплата и ссылки на проводки.
CREATE TABLE basket_throws (
    id               bigserial PRIMARY KEY,
    user_id          bigint NOT NULL REFERENCES users(id),
    nonce            bigint NOT NULL,                  -- nonce, который съел этот бросок
    stake_nano       bigint NOT NULL CHECK (stake_nano > 0),
    roll             smallint NOT NULL,                -- 0..9999, для аудита честности
    hit              boolean NOT NULL,
    mult_milli       bigint NOT NULL,                  -- ×1000 (1880 = 1.88×)
    payout_nano      bigint NOT NULL DEFAULT 0,        -- stake*mult на попадании, 0 на промахе
    ledger_tx_place  bigint REFERENCES ledger_transactions(id),
    ledger_tx_settle bigint REFERENCES ledger_transactions(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX basket_throws_user ON basket_throws (user_id, id DESC);
