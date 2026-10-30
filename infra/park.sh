#!/usr/bin/env bash
# park.sh [--dry-run] [--auto] [instance-name-or-id]   (default <prefix>web-1)          (`./tube park`)
# Park the web box: idle cost = one snapshot + the bucket.
#   1. on the box: `docker compose stop` (Postgres shuts down cleanly), cloud-init clean (the next boot
#      re-runs cloud-init: fresh host keys, ufw SSH rule for the then-current admin IP), apt clean, fstrim.
#      If SSH fails (e.g. admin IP changed) the snapshot is taken anyway (crash-consistent; Postgres replays WAL).
#   2. one POST .../instance/{id}/snapshot "<prefix>park-<YYYYMMDD-HHMM>" (a 500 may still start it: poll by name,
#      re-POST once only if it never appears), wait until ACTIVE, verify via GET
#   3. DELETE the instance, verify it is gone (GET -> 404 / absent from the list)
#   4. only then delete older <prefix>park-* snapshots (keep the newest ACTIVE one)
# --auto (watchdog): one attempt per instance id (marker runs/park-<id>.attempted); the watchdog still
#   hard-deletes at the cap whatever happens here.
# --dry-run: real GETs, prints the POST/DELETEs it would make.
# Idempotent: no <prefix>web-1 -> nothing to do (still prunes old snapshots if a newer one is ACTIVE).
# Log: runs/park.log, images: runs/images.tsv. Never touches anything not prefixed with deploy.prefix.
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ "$TARGET" == ovh ]] || { echo "$(basename "$0"): target ovh only (this site uses target $TARGET)" >&2; exit 2; }
# shellcheck source=ovh.sh
source "$INFRA_DIR/ovh.sh"
AUTO=no WHICH="$WEB_NAME"
for a in "$@"; do
  case "$a" in
    --dry-run) TUBE_DRY_RUN=1 ;;
    --auto) AUTO=yes ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) WHICH="$a" ;;
  esac
done
if is_dry; then say() { printf '%s\n' "$*"; }; say "=== park.sh DRY RUN: GETs are real, nothing is changed"
else
  exec > >(tee -a "$RUNS_DIR/park.log") 2>&1
  say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
  exec 8>"$RUNS_DIR/park.lock"; flock -n 8 || { say "another park.sh is running"; exit 0; }
fi

prune_old() {   # keep only $1 (an ACTIVE snapshot id)
  local keep="$1" sid sname
  while read -r sid sname; do
    [[ -z "$sid" || "$sid" == "$keep" ]] && continue
    say "delete older snapshot $sname ($sid)"
    delete_snapshot "$sid" "$sname" || say "delete $sname failed (left in place)"
  done < <(park_snapshots | jq -r '.[] | "\(.id) \(.name)"')
}

inst="$(prefix_instances)"
say "GET $P/instance -> $TUBE_PREFIX* instances: $(jq -c '[.[] | {name, id, status, ip}]' <<<"$inst")"
row="$(jq -c --arg t "$WHICH" '[.[] | select(.id==$t or .name==$t)][0] // empty' <<<"$inst")"
snaps="$(park_snapshots)"
say "GET $P/snapshot -> $PARK_PREFIX*: $(jq -c '[.[] | {name, status, size}]' <<<"$snaps")"
if [[ -z "$row" ]]; then
  say "no $TUBE_PREFIX* instance matching '$WHICH': nothing to park"
  newest="$(jq -r '[.[] | select(.status=="active")] | last | .id // empty' <<<"$snaps")"
  if [[ -n "$newest" && "$(jq length <<<"$snaps")" -gt 1 ]]; then prune_old "$newest"; fi
  exit 0
fi
id="$(jq -r .id <<<"$row")"; name="$(jq -r .name <<<"$row")"; ip="$(jq -r '.ip // empty' <<<"$row")"
guard_instance "$id" "$name" || exit 1
[[ "$name" == "$WEB_NAME" ]] || say "note: parking $name (not the web box)"
if [[ "$AUTO" == yes ]] && ! is_dry; then
  [[ -f "$RUNS_DIR/park-$id.attempted" ]] && { say "auto park already attempted for $id: leaving it to the hard delete"; exit 0; }
  date +%s > "$RUNS_DIR/park-$id.attempted"
fi
T0=$(date +%s)
snap="${PARK_PREFIX}$(date +%Y%m%d-%H%M)"
say "park $name ($id) ip=$ip -> $snap"

# ---- 1. quiesce the box
if [[ -f "$RUNS_DIR/web.env" && "$name" == "$WEB_NAME" ]]; then
  rec="$(sed -n 's/^IP=//p' "$RUNS_DIR/web.env")"
  if [[ -n "$rec" ]] && jq -e --arg i "$rec" '.ips | index($i)' <<<"$row" >/dev/null; then ip="$rec"; fi
fi
mapfile -t SSHO < <(ssh_opts)
# shellcheck disable=SC2016  # the single-quoted part runs on the box
REMOTE="set -u
cd $REMOTE_ROOT/app 2>/dev/null && { sudo docker compose -p $SITE_SLUG stop -t 60 2>&1 | tail -3; sudo docker compose -p $SITE_SLUG ps -a --format '{{.Name}} {{.State}}' 2>/dev/null; }
sudo rm -f $REMOTE_ROOT/secrets/rclone.conf"'
sudo apt-get clean
sudo cloud-init clean --logs --machine-id 2>/dev/null || sudo cloud-init clean --logs
sudo rm -f ~ubuntu/.bash_history /root/.bash_history
sudo journalctl --rotate >/dev/null 2>&1; sudo journalctl --vacuum-size=20M >/dev/null 2>&1
sync; sudo fstrim -av 2>/dev/null | tail -1
echo "quiesced: $(df -h --output=used / | tail -1 | tr -d " ") used on /"'
# shellcheck disable=SC2029  # $REMOTE is built locally on purpose
if is_dry; then
  say "DRY-RUN would ssh ubuntu@$ip: docker compose stop -t 60 (pg clean shutdown), cloud-init clean, apt clean, fstrim"
elif [[ -n "$ip" ]] && ssh "${SSHO[@]}" "ubuntu@$ip" "$REMOTE" 2>&1 | sed 's/^/  box: /'; then
  say "box quiesced in $(( $(date +%s) - T0 ))s"
else
  say "WARNING: could not quiesce over SSH: snapshot will be crash-consistent"
fi

# ---- 2. snapshot (reuse one of the same name, e.g. a re-run in the same minute)
body="$(jq -nc --arg n "$snap" '{snapshotName:$n}')"
if is_dry; then
  ovh_post "$P/instance/$id/snapshot" "$body" >/dev/null
  say "DRY-RUN then poll GET $P/snapshot until $snap is active (re-POST once if absent after 180 s)"
  say "DRY-RUN would DELETE $P/instance/$id ($name), verify gone, then delete older $PARK_PREFIX*:"
  jq -r '.[] | "  DRY-RUN would DELETE '"$P"'/snapshot/\(.id) (\(.name))"' <<<"$snaps"
  exit 0
fi
T1=$(date +%s)
if [[ -z "$(jq -r --arg n "$snap" '.[] | select(.name==$n) | .id' <<<"$snaps")" ]]; then
  OVH_MAX_TRIES=1 ovh_post "$P/instance/$id/snapshot" "$body" >/dev/null || say "snapshot POST returned an error; polling by name anyway"
fi
say "snapshot $snap requested"
snap_id="" s="" reposted=no
while :; do
  s="$(park_snapshots | jq -c --arg n "$snap" '[.[] | select(.name==$n)][0] // empty')" || s=""
  if [[ -n "$s" ]]; then
    snap_id="$(jq -r .id <<<"$s")"; status="$(jq -r .status <<<"$s")"
    [[ "$status" == active ]] && break
    [[ "$status" =~ ^(error|killed|deleted)$ ]] && { say "snapshot $status: instance NOT deleted (watchdog deletes it at cap)"; notify critical "snapshot $snap $status"; exit 1; }
  fi
  if [[ -z "$s" && "$reposted" == no ]] && (( $(date +%s) - T1 > 180 )); then
    say "snapshot never appeared: re-POST once"; reposted=yes
    OVH_MAX_TRIES=1 ovh_post "$P/instance/$id/snapshot" "$body" >/dev/null || true
  fi
  (( $(date +%s) - T1 > 2700 )) && { say "snapshot not active after 45 min: instance NOT deleted"; notify critical "park: snapshot stuck"; exit 1; }
  sleep 15
done
v="$(ovh_get "$P/snapshot/$snap_id")"
[[ "$(jq -r .status <<<"$v")" == active && "$(jq -r .name <<<"$v")" == "$snap" ]] || { say "snapshot verify failed"; exit 1; }
size="$(jq -r .size <<<"$v")"
say "snapshot $snap ($snap_id) ACTIVE in $(( $(date +%s) - T1 ))s, ${size} GB (verified)"
printf '%s\t%s\t%s\t%s\t%s\n' "$(date --iso-8601=seconds)" "$snap" "$snap_id" "$size" "$name" >> "$RUNS_DIR/images.tsv"

# ---- 3. delete the instance and verify
delete_instance "$id" "$name" || { say "instance delete refused/failed"; exit 1; }
gone=no
for _ in $(seq 1 60); do
  if ! prefix_instances | jq -e --arg i "$id" 'any(.[]; .id==$i)' >/dev/null; then gone=yes; break; fi
  sleep 10
done
[[ "$gone" == yes ]] || { say "instance $name still listed 10 min after delete: run teardown.sh"; notify critical "park: $name still exists"; exit 1; }
say "instance $name deleted (verified via API)"
rm -f "$RUNS_DIR/web.env"

# ---- 4. keep only the new snapshot
prune_old "$snap_id"
say "parked: $snap (${size} GB) kept, $name gone. total $(( $(date +%s) - T0 ))s"
notify normal "parked $snap (${size} GB); $name deleted"
