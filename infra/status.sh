#!/usr/bin/env bash
# status.sh                                                                            (`./tube status`)
# target ovh: <prefix>* instances (age vs cap, IP / host), park snapshots, the site's /healthz and / with basic
#             auth, docker compose state + load on the box, bucket size, watchdog timer, one cost line.
# target ssh: the site's /healthz and /, docker compose state + load on the server, bucket size.
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
echo "== $SITE_NAME (target $TARGET, prefix $TUBE_PREFIX)"
if [[ "$TARGET" == ovh ]]; then
  # shellcheck source=ovh.sh
  source "$INFRA_DIR/ovh.sh"
  echo "== $TUBE_PREFIX* instances (API, project ${OVH_PROJECT:0:6}...)"
  inst="$(prefix_instances)"
  now=$(date +%s)
  [[ "$(jq length <<<"$inst")" == 0 ]] && echo "  none"
  while IFS=$'\t' read -r name status ip created region; do
    [[ -n "$name" ]] || continue
    cap="$(cap_for "$name")"; c=$(iso_to_epoch "$created"); age=$(( (now - c) / 60 ))
    echo "  $name  $status  $region  ${ip:--}  age ${age} min / cap ${cap} min (park/teardown in $(( cap - LEAD_MIN - age )) min, hard delete in $(( cap - age )) min)"
  done < <(jq -r '.[] | [.name, .status, (.ip // ""), .created, (.region // "")] | @tsv' <<<"$inst")
  echo "== park snapshots"; park_snapshots | jq -r '.[] | "  \(.name)  \(.status)  \(.region)  \(.size*100|round/100) GiB"'
fi
if box_resolve 2>/dev/null; then
  echo "== site $SITE_HOST"
  for path in /healthz /; do
    for scheme in https http; do
      code="$(auth_cfg 2>/dev/null | curl -K - -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 10 "$scheme://$SITE_HOST$path" || true)"
      [[ "${code%% *}" =~ ^(000)?$ ]] && continue
      echo "  $scheme $path (auth) -> $code"; break
    done
  done
  mapfile -t SSHO < <(ssh_opts)
  # shellcheck disable=SC2029  # expanded locally on purpose
  ssh "${SSHO[@]}" "$BOX_USER@$BOX_ADDR" "cd $REMOTE_ROOT/app 2>/dev/null && $SUDO docker compose -p $SITE_SLUG ps --format '{{.Service}} {{.State}} {{.Status}}' 2>/dev/null; echo \"load \$(cut -d' ' -f1-3 /proc/loadavg), mem \$(free -m | awk '/Mem:/{print \$3\"/\"\$2\" MB\"}'), disk \$(df -h --output=used,size / | tail -1)\"" 2>/dev/null \
    | sed 's/^/  box: /' || echo "  (ssh failed)"
else
  echo "== no box (./tube up)"
fi
if [[ "$MEDIA_ORIGIN" == bucket ]]; then
  echo "== bucket"; if [[ -n "$(bucket_name || true)" ]]; then "$INFRA_DIR/bucket.sh" du 2>&1 | sed 's/^/  /'; else echo "  none (./tube bucket create)"; fi
fi
if [[ "$TARGET" == ovh ]]; then
  echo "== watchdog"; "$INFRA_DIR/watchdog.sh" status | sed 's/^/  /'
  echo "== $("$INFRA_DIR/cost.sh" --summary)"
fi
