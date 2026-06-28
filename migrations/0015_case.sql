-- 0015_case.sql
-- "Кейсы" (case opening, в стиле CS:GO). Мгновенная одиночная игра: игрок платит
-- фиксированную цену за спин, лента предметов прокручивается и останавливается на
-- выпавшем призе — сумме TON по множителю к цене (0×..200×) с редкостью (цвет).
-- Как и «Кости», общего раунда нет: исход считается в том же запросе. Деньги — через
-- двойную запись (нано-TON):
--   place : USER_BALANCE -> BET_ESCROW              (цена спина списана и заперта)
--   settle: BET_ESCROW -> USER_BALANCE (payout)     + HOUSE_TREASURY добирает разницу
--           (payout=0 → вся цена уходит дому; payout>цены → казна доплачивает профит)
-- Обе ноги — в одной транзакции, спин атомарен. На крупном выигрыше казна может уйти
-- в минус (см. 0014_treasury_allow_negative) — решение оператора, дом доливает флоат.
--
-- Provably fair (commit + nonce, как в «Костях»): у юзера секретный server seed, его
-- SHA-256 хэш показан до спина. Исход спина N = HMAC-SHA256(server_seed,
-- "{client_seed}:{nonce}") → uint64 → взвешенный выбор приза по таблице весов (в коде,
-- internal/casegame/fair.go). Ротация раскрывает старый seed для проверки.

-- Один секретный seed на юзера, двигается nonce'ом каждый спин. (Структурно идентично
-- dice_seeds, но отдельный поток nonce для своей игры.)
CREATE TABLE case_seeds (
    user_id          bigint PRIMARY KEY REFERENCES users(id),
    server_seed      bytea NOT NULL,                  -- секрет до ротации
    server_seed_hash text NOT NULL,                   -- SHA-256 commitment, показан до спинов
    client_seed      text NOT NULL,                    -- виден игроку (и редактируется при ротации)
    nonce            bigint NOT NULL DEFAULT 0,         -- спинов сделано; следующий берёт nonce+1
    created_at       timestamptz NOT NULL DEFAULT now(),
    rotated_at       timestamptz
);

-- Один ряд на спин: цена, выпавший приз (индекс/редкость/множитель), выплата и ссылки
-- на проводки для аудита.
CREATE TABLE case_spins (
    id               bigserial PRIMARY KEY,
    user_id          bigint NOT NULL REFERENCES users(id),
    nonce            bigint NOT NULL,                  -- nonce, который съел этот спин
    price_nano       bigint NOT NULL CHECK (price_nano > 0),
    prize_index      smallint NOT NULL,                -- индекс в таблице призов (для аудита)
    rarity           text NOT NULL,                    -- grey/blue/purple/pink/red/gold
    mult_milli       bigint NOT NULL,                  -- ×1000 (500 = 0.5×, 200000 = 200×)
    payout_nano      bigint NOT NULL DEFAULT 0,        -- price*mult/1000 (0 на «мимо»)
    ledger_tx_place  bigint REFERENCES ledger_transactions(id),
    ledger_tx_settle bigint REFERENCES ledger_transactions(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_spins_user ON case_spins (user_id, id DESC);
