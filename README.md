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
# 1. Поднять Postgres. Хост-порт 55432 (5432 занят Docker-прокси, 5433 — нативным PostgreSQL 18).
docker compose up -d --wait

# 2. Прогнать тесты леджера
DATABASE_URL='postgres://predict:predict@localhost:55432/predict?sslmode=disable' go test ./...

# 3. Применить миграции вручную (опционально — тесты применяют сами)
DATABASE_URL='postgres://predict:predict@localhost:55432/predict?sslmode=disable' go run ./cmd/migrate
```

## Статус

- ✅ **Фаза 0 — денежный леджер**: двойная запись, целые наносы, инварианты на уровне БД (zero-sum + неотрицательность), идемпотентность.
- ✅ **Фаза 1 — рынки + ставочный цикл**: рынки/исходы, ставки (escrow + liability-reserve), ручной сеттлмент и возврат, лимиты ответственности на исход; тесты зелёные.
- ⏭️ **Фаза 2 — интеграция Polymarket** (следующее).

Полный план — в [`docs/architecture.md`](docs/architecture.md).
