#!/usr/bin/env bash
# Deploy the Predict stack to the shared VPS (isolated from cashback).
# Run from the repo root:  bash deploy.sh
set -euo pipefail

REMOTE="${REMOTE:-kopix-cashback}"
DIR="${DIR:-kopix-predict}"

echo "→ sync source to $REMOTE:~/$DIR"
tar czf - \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=web/dist \
  --exclude='*.log' \
  --exclude=.env \
  . | ssh "$REMOTE" "mkdir -p ~/$DIR && tar xzf - -C ~/$DIR"

echo "→ check .env exists on server"
ssh "$REMOTE" "test -f ~/$DIR/.env" || {
  echo "ERROR: ~/$DIR/.env missing. Create it from .env.prod.example (POSTGRES_PASSWORD, TG_BOT_TOKEN)." >&2
  exit 1
}

echo "→ attach Traefik routers (idempotent)"
ssh "$REMOTE" "bash ~/$DIR/scripts/traefik_attach.sh"

echo "→ build + up"
ssh "$REMOTE" "cd ~/$DIR && docker compose -f docker-compose.prod.yml up -d --build"

echo "→ status"
ssh "$REMOTE" "docker compose -p $DIR ps"

echo "✅ deploy done → https://market.kopix.online"
