# Деплой Predict Mini App

Деплоится на тот же VPS, что и cashback, **изолированно**: свой compose-проект
(`kopix-predict`), свой Postgres, отдельные Traefik-роутеры. Живой cashback не затрагивается.

## Инфраструктура

- **VPS:** `178.105.220.11`, SSH-алиас `kopix-cashback` (user `deploy`).
- **Каталог:** `/home/deploy/kopix-predict`.
- **Сеть:** общая `kopix-cashback_kopix` (external) — в ней живёт Traefik.
- **Traefik:** один на сервере (`kopix-cashback-traefik-1`), file-provider с
  `--providers.file.watch=true`, конфиг `/home/deploy/kopix-cashback/traefik/dynamic.yml`.
- **TLS:** Let's Encrypt, резолвер `le` (tlschallenge) — выдаётся автоматически.

## Домены

| Компонент | Домен | Контейнер |
|---|---|---|
| Mini App (фронт) | `market.kopix.online` | `predict-web:80` |
| API | `api.market.kopix.online` | `predict-api:8000` |

DNS A-записи обоих поддоменов → `178.105.220.11` (**уже настроены**).

## Предусловия

1. DNS настроен (готово).
2. `/home/deploy/kopix-predict/.env` создан из [`.env.prod.example`](../.env.prod.example):
   `POSTGRES_PASSWORD` (случайный) и `TG_BOT_TOKEN` (от @BotFather).
3. Бот в @BotFather создан, его Mini App URL = `https://market.kopix.online`.

## Шаги

```bash
# 1. Залить исходники на сервер (билд образов — на сервере).
tar czf - --exclude=.git --exclude=node_modules --exclude=web/dist --exclude='*.log' --exclude=.env . \
  | ssh kopix-cashback 'mkdir -p ~/kopix-predict && tar xzf - -C ~/kopix-predict'

# 2. Создать .env на сервере (один раз).
ssh kopix-cashback 'cd ~/kopix-predict && test -f .env || { \
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env; \
  echo "TG_BOT_TOKEN=<token>" >> .env; }'

# 3. Подключить роутеры к Traefik (идемпотентно; конфиг cashback бэкапится).
#    Вставляет блоки predict-web/predict-api в http.routers и http.services.
ssh kopix-cashback 'bash ~/kopix-predict/scripts/traefik_attach.sh'

# 4. Собрать и поднять наш стек.
ssh kopix-cashback 'cd ~/kopix-predict && docker compose -f docker-compose.prod.yml up -d --build'

# 5. Проверка.
ssh kopix-cashback 'docker compose -p kopix-predict ps'
curl -fsS https://api.market.kopix.online/health
```

## Откат

```bash
# Снять наш стек (cashback не трогается).
ssh kopix-cashback 'cd ~/kopix-predict && docker compose -f docker-compose.prod.yml down'
# Восстановить Traefik-конфиг из бэкапа.
ssh kopix-cashback 'cp /home/deploy/kopix-cashback/traefik/dynamic.yml.bak-predict-* /home/deploy/kopix-cashback/traefik/dynamic.yml'
```
