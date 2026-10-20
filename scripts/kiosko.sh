#!/usr/bin/env sh
# Abre una pantalla en modo kiosko: ./scripts/kiosko.sh <pantalla> [posicion_x]
SCREEN="${1:-1}"
POSX="${2:-0}"
SERVER="${SERVER:-http://localhost:3000}"
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome)"
exec "$BROWSER" --kiosk "$SERVER/tv/$SCREEN" --user-data-dir="$HOME/.chicolven-kiosko/tv$SCREEN" \
  --window-position="$POSX,0" --no-first-run --disable-extensions --disable-translate \
  --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble
