#!/usr/bin/env bash
# Run test/e2e.mjs in the pinned Playwright image against a running stack.
#   test/run-e2e.sh <base-url>
#   env: AUTH_USER + AUTH_PASS_FILE (file holding the password; read here, passed to the container by env NAME)
#        SHOTS (host dir for screenshots, required) WORK (scratch dir for node_modules)
#        LOCALE LABEL_TEXT EXPECT_CATS EXPECT_STICKY EXPECT_PREROLL VIDEO_PATH (see e2e.mjs)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PW=1.64.1
BASE=${1:?usage: test/run-e2e.sh <base-url>}
SHOTS=${SHOTS:?set SHOTS to a directory for screenshots}
WORK=${WORK:-${TMPDIR:-/tmp}/site-e2e}
mkdir -p "$SHOTS" "$WORK"
if [ ! -d "$WORK/node_modules/playwright-core" ]; then
  (cd "$WORK" && npm init -y >/dev/null && npm i --no-audit --no-fund "playwright-core@$PW" >/dev/null)
fi
cp "$HERE/e2e.mjs" "$WORK/e2e.mjs"
AUTH_PASS=""
[ -n "${AUTH_PASS_FILE:-}" ] && AUTH_PASS=$(tr -d '\n' < "$AUTH_PASS_FILE")
export AUTH_PASS
docker run --rm --network host --ipc host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="$BASE" -e AUTH_USER -e AUTH_PASS -e SHOTS=/shots \
  -e VIDEO_PATH -e LOCALE -e LABEL_TEXT -e EXPECT_CATS -e EXPECT_STICKY -e EXPECT_PREROLL \
  -v "$WORK:/work" -v "$(cd "$SHOTS" && pwd):/shots" -w /work \
  "mcr.microsoft.com/playwright:v$PW-noble" node e2e.mjs
