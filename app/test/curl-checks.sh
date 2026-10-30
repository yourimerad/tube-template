#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2086,SC1083  # the checks are eval'd strings, expanded at run time on purpose
# Header / caching / auth checks against a running stack.
#   test/curl-checks.sh [base-url]
#   env AUTH_CFG=<curl config file with `user = "name:password"`> when the site is private (never -u on argv)
#   env PRIVATE=1|0 (default 1 when AUTH_CFG is set)
set -u   # no pipefail: `grep -q` closes the pipe early, which would turn a match into a SIGPIPE failure
B=${1:-http://127.0.0.1:18190}; A=(); [ -n "${AUTH_CFG:-}" ] && A=(-K "$AUTH_CFG")
PRIV=${PRIVATE:-$([ -n "${AUTH_CFG:-}" ] && echo 1 || echo 0)}
fail=0
chk() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }
H() { curl -s "${A[@]}" -o /dev/null -D - "$@" | tr -d '\r'; }
HOME_HTML=$(curl -s "${A[@]}" "$B/")
VID=$(grep -o 'href="/v/[a-z0-9]*/' <<<"$HOME_HTML" | head -1 | cut -d/ -f3)
# media path of that video (<id> or <id>/<v> with versioned paths), from its poster URL
MP=$(grep -o "/media/${VID}[/a-z0-9]*/poster" <<<"$HOME_HTML" | head -1 | sed 's#^/media/##; s#/poster$##')
MP=${MP:-$VID}
RUNG=$(curl -s "${A[@]}" "$B/media/$MP/hls/master.m3u8" | grep -m1 -v '^#' | cut -d/ -f1)
echo "video $VID, media path $MP, first rung $RUNG"
chk "a video is listed on /" '[ -n "$VID" ]'
if [ "$PRIV" = 1 ]; then
  chk "401 without auth" '[ "$(curl -s -o /dev/null -w %{http_code} $B/)" = 401 ]'
  chk "X-Robots-Tag noindex (private)" 'H $B/ | grep -qi "^x-robots-tag: noindex, nofollow"'
  chk "robots.txt Disallow: / (private)" 'curl -s "${A[@]}" $B/robots.txt | grep -q "^Disallow: /$"'
fi
H $B/ >/dev/null
chk "/ micro-cached (X-Cache HIT, s-maxage=30)" 'H $B/ | grep -qi "^x-cache: HIT" && H $B/ | grep -qi "s-maxage=30"'
chk "/ cache ignores cookies" 'H -H "Cookie: tv=AAAAAAAAAAAAAAAAAAAAAA" $B/ | grep -qi "^x-cache: HIT"'
chk "/static immutable + gzip" 'H -H "Accept-Encoding: gzip" $B/static/js/site.js | grep -qi "immutable" && H -H "Accept-Encoding: gzip" $B/static/js/site.js | grep -qi "content-encoding: gzip"'
chk "/theme.css served, immutable" 'H "$B$(grep -o "/theme.css?v=[a-f0-9]*" <<<"$HOME_HTML" | head -1)" | grep -qi "cache-control: public, max-age=31536000, immutable"'
chk "/media m3u8 MIME + immutable + CORS" 'H $B/media/$MP/hls/master.m3u8 | grep -qi "content-type: application/vnd.apple.mpegurl" && H $B/media/$MP/hls/master.m3u8 | grep -qi "immutable" && H $B/media/$MP/hls/master.m3u8 | grep -qi "access-control-allow-origin: \*"'
chk "/media m4s byte range 206" 'H -H "Range: bytes=0-99" $B/media/$MP/hls/$RUNG/$(curl -s "${A[@]}" $B/media/$MP/hls/$RUNG/index.m3u8 | grep -m1 m4s) | grep -qiE "^HTTP/[0-9.]+ 206"'
chk "/media preview.mp4 video/mp4" 'H $B/media/$MP/preview.mp4 | grep -qi "content-type: video/mp4"'
chk "/media/catalog.json hidden" 'H $B/media/catalog.json | grep -qE "^HTTP/[0-9.]+ 404"'
chk "/api no-store JSON" 'H $B/api/videos/$VID/state | grep -qi "cache-control: no-store" && H $B/api/videos/$VID/state | grep -qi "application/json"'
chk "/healthz" 'curl -s $B/healthz | grep -q true'
codes=""; for i in 1 2 3 4; do codes+="$(curl -s "${A[@]}" -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -H "Origin: $B" -d "{\"author\":\"rl\",\"body\":\"rate $i\"}" $B/api/videos/$VID/comments) "; done
chk "comment rate limit 3/min per IP ($codes)" '[[ "$codes" == *429* ]]'
exit $fail
