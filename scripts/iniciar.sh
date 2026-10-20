#!/usr/bin/env sh
# Inicia el servidor de Chicolven Vitrina (Linux / macOS). Reinicia si se detiene.
cd "$(dirname "$0")/.." || exit 1
[ -f apps/server/dist/server.mjs ] || npm run build || exit 1
while true; do
  node apps/server/dist/server.mjs
  echo "El servidor se detuvo. Reiniciando en 5 segundos..."
  sleep 5
done
