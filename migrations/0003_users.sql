-- 0003_users.sql
-- Telegram users. id is the Telegram user id (also used as accounts.owner_user_id).

CREATE TABLE users (
    id         bigint PRIMARY KEY,
    username   text,
    first_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen  timestamptz NOT NULL DEFAULT now()
);
