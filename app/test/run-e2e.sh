#!/usr/bin/env bash
# Run every test/e2e*.mjs (e2e.mjs, e2e-ads.mjs, e2e-simads.mjs, ...) in the pinned Playwright image against a
# running stack; each script skips itself when the site is not in its mode. E2E_ONLY="e2e-ads.mjs ..." limits the set.
#   test/run-e2e.sh <base-url>
#   env: AUTH_USER + AUTH_PASS_FILE (file holding the password; read here, passed to the container by env NAME)
#        SHOTS (host dir for screenshots, required) WORK (scratch dir for node_modules)
#        LOCALE LABEL_TEXT EXPECT_CATS EXPECT_STICKY EXPECT_PREROLL VIDEO_PATH (see e2e.mjs)
#        ADS_MODE AUDIENCE AGE_GATE CONSENT ADS_SCENARIO (see e2e-ads.mjs)
#        REPO_DIR (mounted read-only at /repo: e2e-ads.mjs runs lib/config.mjs validation cases there)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PW=1.64.1
BASE=${1:?usage: test/run-e2e.sh <base-url>}
SHOTS=${SHOTS:?set SHOTS to a directory for screenshots}
WORK=${WORK:-${TMPDIR:-/tmp}/site-e2e}
mkdir -p "$SHOTS" "$WORK"
if [ ! -d "$WORK/node_modules/playwright-core" ]; then
  (cd "$WORK" && { [ -f package.json ] || echo '{"name":"site-e2e","private":true}' > package.json; } && npm i --no-audit --no-fund "playwright-core@$PW" >/dev/null)
fi
tests="${E2E_ONLY:-$(cd "$HERE" && ls e2e*.mjs)}"
for t in $tests; do cp "$HERE/$t" "$WORK/$t"; done
AUTH_PASS=""
[ -n "${AUTH_PASS_FILE:-}" ] && AUTH_PASS=$(tr -d '\n' < "$AUTH_PASS_FILE")
export AUTH_PASS
repo=()
[ -n "${REPO_DIR:-}" ] && repo=(-v "$REPO_DIR:/repo:ro" -e REPO_DIR=/repo)
rc=0
for t in $tests; do
  echo "-- $t"
  docker run --rm --network host --ipc host --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -e BASE="$BASE" -e AUTH_USER -e AUTH_PASS -e SHOTS=/shots \
    -e VIDEO_PATH -e LOCALE -e LABEL_TEXT -e EXPECT_CATS -e EXPECT_STICKY -e EXPECT_PREROLL \
    -e ADS_MODE -e AUDIENCE -e AGE_GATE -e CONSENT -e ADS_SCENARIO "${repo[@]}" \
    -v "$WORK:/work" -v "$(cd "$SHOTS" && pwd):/shots" -w /work \
    "mcr.microsoft.com/playwright:v$PW-noble" node "$t" || rc=1
done
exit "$rc"
