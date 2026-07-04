#!/usr/bin/env bash
# Downloads the GNU Backgammon WebAssembly build (GPL-3.0) from the gnubg-web
# project's hosted demo. These artifacts are intentionally not committed to
# this repository: gnubg is GPL-licensed while this repository is MIT.
# Source for the build: https://github.com/hwatheod/gnubg-web
set -euo pipefail

BASE_URL="${GNUBG_WEB_BASE_URL:-http://xenon.stanford.edu/~hwatheod/gnubg_web}"
DEST="$(dirname "$0")/../public/engine"
mkdir -p "$DEST"

for f in gnubg.js gnubg.wasm gnubg.data; do
  if [ -s "$DEST/$f" ]; then
    echo "$f already present, skipping"
  else
    echo "Fetching $f ..."
    curl -fsSL -o "$DEST/$f" "$BASE_URL/$f"
  fi
done

cat > "$DEST/LICENSE-NOTICE.txt" <<'EOF'
The files gnubg.js, gnubg.wasm and gnubg.data in this directory are a
WebAssembly build of GNU Backgammon (https://www.gnu.org/software/gnubg/),
compiled by the gnubg-web project (https://github.com/hwatheod/gnubg-web).
They are licensed under the GNU General Public License v3.0 and are NOT
covered by this repository's MIT license. Complete corresponding source is
available at the gnubg-web repository above.
EOF

echo "Engine ready in $DEST"
