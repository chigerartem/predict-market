#!/usr/bin/env bash
# Idempotently attach Predict routers/services to the SHARED Traefik dynamic
# config (used by cashback). Backs up the file first; Traefik (watch=true)
# hot-reloads. Safe to run repeatedly.
set -euo pipefail

DYN="/home/deploy/kopix-cashback/traefik/dynamic.yml"

if [ ! -f "$DYN" ]; then
  echo "ERROR: $DYN not found" >&2
  exit 1
fi

if grep -q "predict-web" "$DYN"; then
  echo "predict routers already present — nothing to do"
  exit 0
fi

cp "$DYN" "${DYN}.bak-predict-$(date +%Y%m%d-%H%M%S)"

awk '
/^  routers:[[:space:]]*$/ && !r {
  print
  print "    predict-web:"
  print "      rule: \"Host(`market.kopix.online`)\""
  print "      entryPoints: [websecure]"
  print "      tls: { certResolver: le }"
  print "      service: predict-web"
  print "    predict-api:"
  print "      rule: \"Host(`api.market.kopix.online`)\""
  print "      entryPoints: [websecure]"
  print "      tls: { certResolver: le }"
  print "      service: predict-api"
  r=1; next
}
/^  services:[[:space:]]*$/ && !s {
  print
  print "    predict-web:"
  print "      loadBalancer:"
  print "        servers:"
  print "          - url: \"http://predict-web:80\""
  print "    predict-api:"
  print "      loadBalancer:"
  print "        servers:"
  print "          - url: \"http://predict-api:8000\""
  s=1; next
}
{ print }
' "$DYN" > "${DYN}.new"

# Sanity: keep cashback routes and gain ours, or abort.
if ! grep -q "cashback.kopix.online" "${DYN}.new" || ! grep -q "predict-web" "${DYN}.new"; then
  echo "ERROR: merged config looks wrong — aborting, original untouched" >&2
  rm -f "${DYN}.new"
  exit 1
fi

# Write in place (preserve inode) so Traefik's single-file bind mount sees it.
cat "${DYN}.new" > "$DYN"
rm -f "${DYN}.new"
echo "attached predict routers (backup kept); traefik will hot-reload"
