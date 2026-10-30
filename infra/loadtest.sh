#!/usr/bin/env bash
# loadtest.sh [--vus 50,150,300] [--ramp 1m] [--hold 3m] [--mode playback|throughput] [--segments 15]
#             [--rung 480] [--comment-post] [--insecure] [--video-path TPL] [--view-path TPL] [--vote-path TPL]
#             [--comments-path TPL] [--local] [--url URL]                                  (`./tube loadtest`)
# Run infra/k6/tube.js (grafana/k6 pinned, in docker) on <prefix>loadgen (create it first: ./tube up --loadgen)
# against the site with basic auth.
# --local: run k6 in docker on THIS machine instead (any target; your uplink becomes the limit), against --url
#          (default https://<site host>) or the local dev site (--url http://127.0.0.1:<dev port>). The password reaches the loadgen over ssh stdin into a
# 600 env file in /dev/shm, deleted as soon as the k6 container exists (and again on exit).
# Meanwhile both boxes are sampled every 5 s from /proc (CPU incl. steal, load, RAM, swap, NIC Mbps,
# established TCP) + `docker stats --no-stream` on the web box every 30 s.
# Output: runs/loadtest-<ts>/{k6.log,summary.json,summary.txt,web-stats.csv,web-docker-stats.log,loadgen-stats.csv}
# then a printed summary. --comment-post: also POST a few comments (VUs 1..3, first iteration only); default off.
# NOTE: the site's nginx rate-limits per client IP (pages 30 r/s burst 60, /api 10 r/s burst 30) and the whole
# test comes from ONE IP: 429s are counted separately (rate_limited_429). Playback mode at 300 VUs stays around
# 9 page r/s and 7 api r/s; --mode throughput will hit the limits.
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
VUS=50,150,300 RAMP=1m HOLD=3m MODE=playback SEGMENTS=15 RUNG=480 COMMENT_POST=0 INSECURE=0
VIDEO_PATH="" VIEW_PATH="" VOTE_PATH="" COMMENTS_PATH="" LOCAL=no URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vus) VUS="$2"; shift 2 ;; --ramp) RAMP="$2"; shift 2 ;; --hold) HOLD="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;; --segments) SEGMENTS="$2"; shift 2 ;; --rung) RUNG="$2"; shift 2 ;;
    --comment-post) COMMENT_POST=1; shift ;; --insecure) INSECURE=1; shift ;;
    --local) LOCAL=yes; shift ;; --url) URL="$2"; shift 2 ;;
    --video-path) VIDEO_PATH="$2"; shift 2 ;; --view-path) VIEW_PATH="$2"; shift 2 ;;
    --vote-path) VOTE_PATH="$2"; shift 2 ;; --comments-path) COMMENTS_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
[[ "$MODE" =~ ^(playback|throughput)$ ]] || { echo "--mode playback|throughput" >&2; exit 2; }
[[ "$VUS" =~ ^[0-9]+(,[0-9]+)*$ && "$RAMP" =~ ^[0-9]+[sm]$ && "$HOLD" =~ ^[0-9]+[sm]$ ]] || { echo "bad --vus/--ramp/--hold" >&2; exit 2; }
[[ "$TARGET" == ovh ]] || LOCAL=yes
TS="$(date +%Y%m%d-%H%M%S)"; OUT="$RUNS_DIR/loadtest-$TS"
envs=(-e "VUS=$VUS" -e "RAMP=$RAMP" -e "HOLD=$HOLD" -e "MODE=$MODE" -e "SEGMENTS=$SEGMENTS" -e "RUNG=$RUNG"
      -e "COMMENT_POST=$COMMENT_POST" -e "INSECURE=$INSECURE" -e "CATALOG_FILE=/lt/catalog.json" -e "MEDIA_BASE=$MEDIA_BASE")
[[ -n "$VIDEO_PATH" ]] && envs+=(-e "VIDEO_PATH=$VIDEO_PATH")
[[ -n "$VIEW_PATH" ]] && envs+=(-e "VIEW_PATH=$VIEW_PATH")
[[ -n "$VOTE_PATH" ]] && envs+=(-e "VOTE_PATH=$VOTE_PATH")
[[ -n "$COMMENTS_PATH" ]] && envs+=(-e "COMMENTS_PATH=$COMMENTS_PATH")

if [[ "$LOCAL" == yes ]]; then
  if [[ -z "$URL" ]]; then box_resolve || { echo "no box: pass --url" >&2; exit 1; }; URL="https://$SITE_HOST"; fi
  [[ -s "$MEDIA_OUT/catalog.json" ]] || { echo "no $MEDIA_OUT/catalog.json (./tube ingest)" >&2; exit 1; }
  # basic auth: the deploy password, or the local dev one for a 127.0.0.1 URL
  pwf="$BASIC_FILE"; [[ "$URL" == http://127.0.0.1:* || "$URL" == http://localhost:* ]] && pwf="$DEV_DIR/password"
  mkdir -p "$OUT/lt"; cp "$INFRA_DIR/k6/tube.js" "$MEDIA_OUT/catalog.json" "$OUT/lt/"
  ( umask 077; { printf 'BASIC_USER=%s\nBASIC_PASS=' "$BASIC_USER"; tr -d '\n' < "$pwf" 2>/dev/null; printf '\n'; } > "$OUT/k6.env" )
  echo "loadtest --local $TS: $URL, VUs $VUS (ramp $RAMP, hold $HOLD), mode $MODE -> $OUT"
  rc=0
  docker run --rm --network host --user "$(id -u):$(id -g)" --env-file "$OUT/k6.env" -e "BASE_URL=$URL" "${envs[@]}" \
    -v "$OUT/lt:/lt" -w /lt "$K6_IMAGE" run --quiet --no-color /lt/tube.js > "$OUT/k6.log" 2>&1 || rc=$?
  rm -f "$OUT/k6.env"
  echo "k6 exit $rc (99 = a threshold crossed)"
  if [[ -s "$OUT/lt/summary.txt" ]]; then sed 's/^/  /' "$OUT/lt/summary.txt"; else tail -30 "$OUT/k6.log"; fi
  echo "results: $OUT"
  exit 0
fi

# shellcheck source=ovh.sh
source "$INFRA_DIR/ovh.sh"
box_resolve || { echo "$WEB_NAME not found" >&2; exit 1; }
lg="$(instance_by_name "$LOADGEN_NAME")"; LG_IP="$(jq -r '.ip // empty' <<<"${lg:-{\}}")"
[[ -n "$LG_IP" ]] || { echo "$LOADGEN_NAME not found (./tube up --loadgen)" >&2; exit 1; }
if [[ -f "$RUNS_DIR/loadgen.env" ]]; then
  rec="$(sed -n 's/^IP=//p' "$RUNS_DIR/loadgen.env")"
  if [[ -n "$rec" ]] && jq -e --arg i "$rec" '.ips | index($i)' <<<"$lg" >/dev/null; then LG_IP="$rec"; fi
fi
auth_cfg >/dev/null || exit 1
mkdir -p "$OUT"
mapfile -t SSHO < <(ssh_opts)
# shellcheck disable=SC2029  # remote commands are built locally on purpose
LG() { ssh "${SSHO[@]}" "ubuntu@$LG_IP" "$@"; }
# shellcheck disable=SC2029
WEB() { ssh "${SSHO[@]}" "ubuntu@$BOX_ADDR" "$@"; }
to_s() { local d="$1"; if [[ "$d" == *m ]]; then echo $(( ${d%m} * 60 )); else echo "${d%s}"; fi; }
nst=$(tr ',' '\n' <<<"$VUS" | wc -l)
DUR=$(( nst * ( $(to_s "$RAMP") + $(to_s "$HOLD") ) + 30 ))
echo "loadtest $TS: https://$SITE_HOST from $LOADGEN_NAME $LG_IP, VUs $VUS (ramp $RAMP, hold $HOLD), mode $MODE, ~$(( DUR / 60 )) min -> $OUT"

# ---- the loadgen: script, image, secret env file
LG 'mkdir -p ~/lt && rm -f ~/lt/summary.json ~/lt/summary.txt; docker rm -f site-k6 >/dev/null 2>&1; true'
LG 'cat > ~/lt/tube.js' < "$INFRA_DIR/k6/tube.js"
# catalog: the site does not serve /media/catalog.json (404 by design): take the box's copy
if ! WEB "cat $REMOTE_ROOT/media/catalog.json" 2>/dev/null | LG 'cat > ~/lt/catalog.json && test -s ~/lt/catalog.json'; then
  LG 'cat > ~/lt/catalog.json' < "$MEDIA_OUT/catalog.json"
fi
LG "docker pull -q $K6_IMAGE" >/dev/null
rm_env() { LG 'rm -f /dev/shm/site-k6.env' 2>/dev/null || true; }
cleanup() { rm_env; [[ -n "${SP_WEB:-}" ]] && kill "$SP_WEB" 2>/dev/null; [[ -n "${SP_LG:-}" ]] && kill "$SP_LG" 2>/dev/null; true; }
trap cleanup EXIT
{ printf 'BASIC_USER=%s\nBASIC_PASS=' "$BASIC_USER"; tr -d '\n' < "$BASIC_FILE"; printf '\n'; } \
  | LG 'umask 077; cat > /dev/shm/site-k6.env'

# ---- samplers (remote loop, CSV on stdout, docker stats on stderr)
SAMPLER="$(cat <<'EOS'
MAX=$1; DOCKER=$2
iface=$(ip route show default | awk '{print $5; exit}')
cpu() { awk '/^cpu /{t=0; for(i=2;i<=NF;i++) t+=$i; print t, $5+$6, $9}' /proc/stat; }
net() { awk -v i="$iface:" '$1==i{print $2, $10}' /proc/net/dev; }
echo "epoch,cpu_pct,steal_pct,load1,mem_used_mb,mem_total_mb,swap_used_mb,rx_mbps,tx_mbps,tcp_estab"
read -r t0 i0 s0 < <(cpu); read -r r0 x0 < <(net); e0=$(date +%s.%N)
end=$(( $(date +%s) + MAX )); n=0
while [ "$(date +%s)" -lt "$end" ]; do
  sleep 5
  read -r t1 i1 s1 < <(cpu); read -r r1 x1 < <(net); e1=$(date +%s.%N)
  mem=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/SwapTotal/{st=$2}/SwapFree/{sf=$2}END{printf "%d,%d,%d",(t-a)/1024,t/1024,(st-sf)/1024}' /proc/meminfo)
  est=$(ss -Htn state established </dev/null 2>/dev/null | wc -l)
  awk -v ta="$t0" -v tb="$t1" -v ia="$i0" -v ib="$i1" -v sa="$s0" -v sb="$s1" -v ra="$r0" -v rb="$r1" \
      -v xa="$x0" -v xb="$x1" -v ea="$e0" -v eb="$e1" -v l="$(cut -d' ' -f1 /proc/loadavg)" -v m="$mem" -v e="$est" \
      'BEGIN{dt=tb-ta; s=eb-ea; printf "%d,%.1f,%.1f,%s,%s,%.1f,%.1f,%d\n", eb, (dt>0?100*(1-(ib-ia)/dt):0), (dt>0?100*(sb-sa)/dt:0), l, m, (rb-ra)*8/s/1e6, (xb-xa)*8/s/1e6, e}'
  t0=$t1; i0=$i1; s0=$s1; r0=$r1; x0=$x1; e0=$e1; n=$((n+1))
  if [ "$DOCKER" = 1 ] && [ $((n % 6)) -eq 0 ]; then
    sudo -n docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} net={{.NetIO}}' </dev/null 2>/dev/null | sed "s/^/$(date +%s) /" >&2
  fi
done
EOS
)"
MAXS=$(( DUR + 600 ))
# the script travels on ssh stdin (bash -s); nothing inside reads stdin
WEB "bash -s -- $MAXS 1" <<<"$SAMPLER" > "$OUT/web-stats.csv" 2> "$OUT/web-docker-stats.log" & SP_WEB=$!
LG "bash -s -- $MAXS 0" <<<"$SAMPLER" > "$OUT/loadgen-stats.csv" 2>/dev/null & SP_LG=$!

# ---- k6 (detached container: a dropped ssh session does not stop the test)
envs+=(-e "BASE_URL=https://$SITE_HOST")
LG "docker run -d --name site-k6 --network host --user 1000:1000 --ulimit nofile=200000:200000 --env-file /dev/shm/site-k6.env $(printf '%q ' "${envs[@]}") -v \$HOME/lt:/lt -w /lt $K6_IMAGE run --quiet --no-color /lt/tube.js >/dev/null; rc=\$?; rm -f /dev/shm/site-k6.env; exit \$rc"
echo "k6 started (secret env file removed); streaming log"
LG 'docker logs -f site-k6' > "$OUT/k6.log" 2>&1 || true
rc="$(LG 'docker wait site-k6' || echo '?')"
kill "$SP_WEB" "$SP_LG" 2>/dev/null || true; SP_WEB="" SP_LG=""
LG 'cat ~/lt/summary.json' > "$OUT/summary.json" 2>/dev/null || true
LG 'cat ~/lt/summary.txt' > "$OUT/summary.txt" 2>/dev/null || true
LG 'docker rm site-k6 >/dev/null 2>&1; true'
echo "k6 exit $rc (99 = a threshold crossed; the numbers below are what matters)"

# ---- summary
echo "== k6"
if [[ -s "$OUT/summary.txt" ]]; then sed 's/^/  /' "$OUT/summary.txt"; else tail -30 "$OUT/k6.log"; fi
grep -E 'setup:|level=error' "$OUT/k6.log" | head -5 | sed 's/^/  log: /' || true
statline() {  # statline FILE LABEL
  awk -F, -v L="$2" 'NR>1 && $2!="" {n++; c+=$2; if($2>cm)cm=$2; if($3>sm)sm=$3; if($5>mm)mm=$5; t=$6; if($7>sw)sw=$7; tx+=$9; if($9>txm)txm=$9; if($8>rxm)rxm=$8; if($10>em)em=$10}
       END{if(n) printf "  %s: cpu avg %.0f%% max %.0f%% (steal max %.0f%%), mem max %d/%d MB, swap max %d MB, tx avg %.0f max %.0f Mbps, rx max %.0f Mbps, tcp estab max %d (%d samples)\n", L, c/n, cm, sm, mm, t, sw, tx/n, txm, rxm, em, n}' "$1"
}
echo "== boxes (5 s samples)"
statline "$OUT/web-stats.csv" "web ($WEB_FLAVOR)"
statline "$OUT/loadgen-stats.csv" "loadgen ($LOADGEN_FLAVOR)"
[[ -s "$OUT/web-docker-stats.log" ]] && { echo "  last docker stats:"; tail -n 4 "$OUT/web-docker-stats.log" | sed 's/^/    /'; }
echo "results: $OUT"
