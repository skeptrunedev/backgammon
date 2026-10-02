#!/usr/bin/env bash
# Builds the Backgammon PWA (the repo root) for the native app and drops it into
# the bundle-server module, where the iOS pod and the Android library ship it as
# app resources (www/). Run before every native build; `npm run build:ios` /
# `npm run build:android` do it for you.
#
# The bundle is a build artifact: git-ignored, but uploaded to EAS through the
# repo-root .easignore.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$(cd "$MOBILE_DIR/.." && pwd)"
DEST="$MOBILE_DIR/modules/bundle-server/web/www"

cd "$WEB_DIR"
if [ ! -d node_modules ]; then
  npm ci
fi
npm run fetch-engine   # gnubg WASM (GPL-3.0), downloaded rather than committed
npm run build:native   # vite build --mode native -> dist-native/

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R dist-native "$DEST"

for f in index.html engine/gnubg.js engine/gnubg.wasm engine/gnubg.data; do
  if [ ! -s "$DEST/$f" ]; then
    echo "build-web: $DEST/$f is missing or empty" >&2
    exit 1
  fi
done
if [ -e "$DEST/sw.js" ]; then
  echo "build-web: native bundle must not contain a service worker" >&2
  exit 1
fi

echo "build-web: bundled $(git -C "$WEB_DIR" rev-parse --short HEAD)$(git -C "$WEB_DIR" diff --quiet HEAD -- . ':!mobile' || echo '+dirty') -> ${DEST#"$WEB_DIR"/} ($(du -sh "$DEST" | cut -f1))"
