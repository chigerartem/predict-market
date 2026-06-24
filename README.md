# Telegram Prediction Market

Рынок прогнозов в Telegram (в духе Polymarket), где вход и выход — **Telegram Gifts**, Stars и TON, без криптокошельков и DeFi для пользователя. Внутренний баланс — в TON.

- **Концепция:** [`docs/idea.md`](docs/idea.md)
- **Архитектура и план MVP:** [`docs/architecture.md`](docs/architecture.md)

## Стек

| Слой | Технология |
|---|---|
| Backend | Go (модульный монолит) |
| БД | PostgreSQL |
| Кэш / локи / очередь | Redis + River (Postgres-backed jobs) |
| Frontend | Telegram Mini App — React + TypeScript (Vite) |
| Бот | Go, подключён к Telegram Business-аккаунту (подарки) |
| Блокчейн | TON (tonutils-go) |

## Локальная разработка

```bash
# 1. Поднять Postgres (хост-порт 55432; 5432/5433 заняты Docker-прокси и нативным PG18).
docker compose up -d --wait

export DATABASE_URL='postgres://predict:predict@localhost:55432/predict?sslmode=disable'

# 2. Тесты. Интеграционные тесты делят одну БД — пакеты гоняем последовательно (-p 1).
go test -p 1 ./...

# 3. HTTP API. DEV_USER_ID подставляет тестового юзера без Telegram (только локально).
DEV_USER_ID=1 PORT=8000 go run ./cmd/api

# 4. Mini App (фронт).
VITE_API_BASE=http://localhost:8000 npm --prefix web run dev
```

## Статус

- ✅ **Фаза 0 — денежный леджер**: двойная запись, целые наносы, инварианты на уровне БД (zero-sum + неотрицательность), идемпотентность.
- ✅ **Фаза 1 — рынки + ставочный цикл**: рынки/исходы, ставки (escrow + liability-reserve), ручной сеттлмент и возврат, лимиты ответственности на исход; тесты зелёные.
- ✅ **Mini App + HTTP API**: фронт `web/` (React/Vite/Tailwind, нативный Telegram WebApp) + Go API `cmd/api` (tma-авторизация). Цель деплоя — `market.kopix.online` (Traefik, тот же VPS, что cashback).
- ⏭️ **Фаза 2 — интеграция Polymarket** (следующее).

Полный план — в [`docs/architecture.md`](docs/architecture.md).
