#!/usr/bin/env bash
# Re-vendor hls.js from the npm registry into static/vendor and record its sha256.
# Usage: scripts/vendor-hls.sh [version]   (default: pinned version below)
set -euo pipefail
VER=${1:-1.7.3}
HERE=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && npm pack --silent "hls.js@$VER" >/dev/null && tar xzf "hls.js-$VER.tgz" )
cp "$TMP/package/dist/hls.min.js" "$HERE/static/vendor/hls-$VER.min.js"
cp "$TMP/package/LICENSE" "$HERE/static/vendor/hls-$VER.LICENSE"
( cd "$HERE/static/vendor" && sha256sum "hls-$VER.min.js" > SHA256SUMS )
echo "npm integrity: $(npm view "hls.js@$VER" dist.integrity)"
cat "$HERE/static/vendor/SHA256SUMS"
