#!/usr/bin/env bash
# teardown.sh [--dry-run] [name-or-id ...]                                             (`./tube teardown`)
#   target ovh: delete <prefix>* instances (all of them, or only the ones named), NO snapshot. Never touches
#   <prefix>park-* snapshots, the bucket, or anything not prefixed with deploy.prefix (ids in
#   deploy.ovh.protected_ids are always refused).
#   target ssh: `docker compose down` of this site on the server (volumes and files kept).
#   Retries until the API confirms they are gone (20 min max). Idempotent. Log: runs/teardown.log.
#   --dry-run: real GETs, prints the DELETEs it would make.
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
ONLY=()
for a in "$@"; do
  case "$a" in
    --dry-run) TUBE_DRY_RUN=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) ONLY+=("$a") ;;
  esac
done
if [[ "$TARGET" == ssh ]]; then
  box_resolve
  cmd="cd $REMOTE_ROOT/app && $SUDO docker compose -p $SITE_SLUG --env-file .env.site down"
  if is_dry; then echo "DRY-RUN would ssh $BOX_USER@$BOX_ADDR: $cmd  (volumes, media, secrets kept)"; exit 0; fi
  mapfile -t SSHO < <(ssh_opts)
  # shellcheck disable=SC2029  # expanded locally on purpose
  ssh "${SSHO[@]}" "$BOX_USER@$BOX_ADDR" "$cmd" 2>&1 | sed 's/^/  box: /'
  exit 0
fi
# shellcheck source=ovh.sh
source "$INFRA_DIR/ovh.sh"
if is_dry; then say() { printf '%s\n' "$*"; }; say "=== teardown.sh DRY RUN: GETs are real, nothing is deleted"
else
  exec > >(tee -a "$RUNS_DIR/teardown.log") 2>&1
  say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fi
only_json="$(printf '%s\n' "${ONLY[@]}" | jq -R 'select(length>0)' | jq -sc .)"
select_targets() { jq -c --argjson o "$only_json" '[.[] | select(($o | length) == 0 or (.name as $n | $o | index($n)) or (.id as $i | $o | index($i)))]'; }

say "teardown start (by ${TUBE_CALLER:-manual}, targets: ${ONLY[*]:-all $TUBE_PREFIX* instances})"
deadline=$(( $(date +%s) + 20 * 60 )) round=0
while :; do
  round=$((round + 1))
  if ! inst="$(prefix_instances)"; then
    say "instance list failed (round $round)"; sleep 15
    (( $(date +%s) < deadline )) && continue
    notify critical "cannot list instances. CHECK OVH NOW."; exit 1
  fi
  tg="$(select_targets <<<"$inst")"
  n=$(jq length <<<"$tg")
  (( round == 1 )) && say "GET $P/instance -> targets: $(jq -c '[.[] | {name, id, status}]' <<<"$tg")"
  if (( n == 0 )); then say "verified via API: 0 matching $TUBE_PREFIX* instances"; break; fi
  while read -r id name status; do
    say "DELETE instance $name ($id, $status)"
    delete_instance "$id" "$name" || say "delete $name refused/failed (will re-check)"
  done < <(jq -r '.[] | "\(.id) \(.name) \(.status)"' <<<"$tg")
  is_dry && exit 0
  if (( $(date +%s) >= deadline )); then
    say "GAVE UP after 20 min, instances remain"; notify critical "$TUBE_PREFIX* instances still exist after 20 min. CHECK OVH NOW."; exit 1
  fi
  sleep 15
done
is_dry || notify normal "no matching $TUBE_PREFIX* instance left (verified via API)"
say "teardown done"
