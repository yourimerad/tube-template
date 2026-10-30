#!/usr/bin/env bash
# watchdog.sh install | uninstall | status | ensure | run [--dry-run]                (`./tube watchdog ...`)
# Local spending guard for <prefix>* OVH instances, as a systemd USER timer. Enable linger
# (loginctl enable-linger $USER) so it also runs while you are logged out.
#   install   : write ~/.config/systemd/user/<prefix>watchdog.{service,timer} (every 5 min, Persistent=true)
#               and enable --now the timer. The unit carries TUBE_CONFIG=<this site.config.json> (no secret).
#               With no <prefix>* instance a cycle is a no-op (one GET).
#   uninstall : stop + disable + remove the units (and the wake timer)
#   status    : timer state, next run, last log lines
#   ensure    : install if the timer is not active (up.sh calls it before creating anything)
#   run       : one cycle (what the service executes). For each <prefix>* instance, age from the API `created`:
#                 age >= cap        -> DELETE it no matter what, verify via the API
#                 age >= cap-15 min -> <prefix>web-1: park.sh (snapshot then delete) in a background user unit;
#                                      others: teardown.sh <name> in a background user unit
#               Caps: deploy.ovh.cap_minutes (web), deploy.ovh.loadgen_cap_minutes (loadgen).
#               While an instance exists, a transient WakeSystem timer (<prefix>watchdog-wake) is armed at the
#               next deadline so a suspended PC wakes up for it; it is removed when nothing is left.
#   run --dry-run : same decisions printed with real GETs, no action.
# Token: ovh.sh reads the file named by deploy.ovh.token_secret (the unit carries no secret). Log: runs/watchdog.log.
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ "$TARGET" == ovh ]] || { echo "watchdog: target ovh only (this site uses target $TARGET)" >&2; exit 2; }
here="$INFRA_DIR"
SELF="$here/watchdog.sh"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$WATCHDOG_UNIT"
WAKE="${TUBE_PREFIX}watchdog-wake"
RUNS="$RUNS_DIR"
LOG="$RUNS/watchdog.log"

install_units() {
  [[ -r "$OVH_TOKEN_FILE" ]] || { echo "watchdog needs $OVH_TOKEN_FILE" >&2; exit 1; }
  [[ "$TUBE_CONFIG" =~ ^[A-Za-z0-9_./-]+$ && "$SELF" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo "watchdog: config/repo path must not contain spaces or special characters" >&2; exit 1; }
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$UNIT.service" <<EOF
[Unit]
Description=$SITE_NAME: $TUBE_PREFIX* OVH instances watchdog (park at cap-15 min, delete at cap)
After=network-online.target

[Service]
Type=oneshot
ExecStart=$SELF run
TimeoutStartSec=600
Environment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin
Environment=TUBE_CONFIG=$TUBE_CONFIG
EOF
  cat > "$UNIT_DIR/$UNIT.timer" <<EOF
[Unit]
Description=$TUBE_PREFIX* watchdog every 5 min

[Timer]
OnCalendar=*:0/5
OnStartupSec=60
Persistent=true
AccuracySec=20s
Unit=$UNIT.service

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT.timer" >/dev/null
  echo "installed: $(systemctl --user is-active "$UNIT.timer") $UNIT.timer (every 5 min), linger=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo ?)"
}

uninstall_units() {
  systemctl --user disable --now "$UNIT.timer" 2>/dev/null || true
  systemctl --user stop "$WAKE.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$UNIT.service" "$UNIT_DIR/$UNIT.timer"
  systemctl --user daemon-reload
  echo "uninstalled $UNIT timer/service"
}

status_units() {
  local st; st="$(systemctl --user is-active "$UNIT.timer" 2>/dev/null || true)"
  if [[ "$st" == active ]]; then
    echo "watchdog timer ACTIVE, next $(systemctl --user show "$UNIT.timer" -p NextElapseUSecRealtime --value), last $(systemctl --user show "$UNIT.timer" -p LastTriggerUSec --value)"
  else
    echo "watchdog timer NOT active ($st)"
  fi
  if systemctl --user is-active -q "$WAKE.timer" 2>/dev/null; then
    echo "wake timer at $(systemctl --user show "$WAKE.timer" -p NextElapseUSecRealtime --value)"
  fi
  local u; for u in "${TUBE_PREFIX}park-run" "${TUBE_PREFIX}teardown-run"; do
    systemctl --user is-active -q "$u.service" 2>/dev/null && echo "$u: RUNNING"
  done
  echo "linger=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)"
  [[ -f "$LOG" ]] && { echo "last log:"; tail -n 5 "$LOG" | sed 's/^/  /'; }
  return 0
}

# background action in its own transient user unit (so the 5-min cycle keeps running meanwhile)
bg_unit() {   # bg_unit UNIT CMD...
  local unit="$1"; shift
  if systemctl --user is-active -q "$unit.service" 2>/dev/null; then return 0; fi
  systemctl --user reset-failed "$unit.service" 2>/dev/null || true
  systemd-run --user --unit="$unit" --collect --setenv=TUBE_CALLER=watchdog --setenv=TUBE_CONFIG="$TUBE_CONFIG" \
    --setenv=DISPLAY="${DISPLAY:-:0}" \
    --setenv=DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}" \
    "$@" >/dev/null
}

arm_wake() {   # arm_wake EPOCH | none
  local state="$RUNS/watchdog-wake.at" cur=""
  [[ -f "$state" ]] && cur="$(cat "$state")"
  if [[ "$1" == none ]]; then
    [[ -n "$cur" ]] && { systemctl --user stop "$WAKE.timer" 2>/dev/null || true; rm -f "$state"; }
    return 0
  fi
  [[ "$cur" == "$1" ]] && systemctl --user is-active -q "$WAKE.timer" 2>/dev/null && return 0
  systemctl --user stop "$WAKE.timer" 2>/dev/null || true
  systemctl --user reset-failed "$WAKE.timer" "$WAKE.service" 2>/dev/null || true
  local cal; cal="$(date -d "@$1" '+%Y-%m-%d %H:%M:%S')"
  local base=(systemd-run --user --unit="$WAKE" --on-calendar="$cal" --timer-property=AccuracySec=1s --setenv=TUBE_CONFIG="$TUBE_CONFIG")
  if ! "${base[@]}" --timer-property=WakeSystem=true "$SELF" run >/dev/null 2>&1; then
    "${base[@]}" "$SELF" run >/dev/null 2>&1 || true
  fi
  echo "$1" > "$state"
}

run_cycle() {
  local dry=no; [[ "${1:-}" == --dry-run ]] && dry=yes
  # shellcheck source=ovh.sh
  source "$INFRA_DIR/ovh.sh"
  [[ "$dry" == yes ]] && TUBE_DRY_RUN=1
  exec 9>"$RUNS/watchdog.lock"
  flock -n 9 || { echo "another watchdog cycle is running" >&2; return 0; }
  say() { if [[ "$dry" == yes ]]; then echo "$*"; else printf '[%s] %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; fi; }
  local inst now next=0
  if ! inst="$(prefix_instances)"; then say "ERROR: instance list failed (next cycle retries)"; return 1; fi
  now=$(date +%s)
  local n; n=$(jq length <<<"$inst")
  if (( n == 0 )); then
    [[ "$dry" == yes ]] && say "no $TUBE_PREFIX* instances: nothing to do"
    [[ "$dry" == yes ]] || arm_wake none
    return 0
  fi
  while read -r id name status created; do
    [[ -n "$id" ]] || continue
    local cap c park_at kill_at age
    cap="$(cap_for "$name")"; c="$(iso_to_epoch "$created")"
    kill_at=$(( c + cap * 60 )); park_at=$(( kill_at - LEAD_MIN * 60 )); age=$(( (now - c) / 60 ))
    if (( now >= kill_at )); then
      say "$name ($id, $status) age ${age} min >= cap $cap: DELETE"
      if delete_instance "$id" "$name"; then
        [[ "$dry" == yes ]] && continue
        sleep 20
        if ovh_get "$P/instance/$id" >/dev/null 2>&1; then
          say "$name still listed after delete (status $(ovh_get "$P/instance/$id" | jq -r .status)); next cycle re-checks"
          notify critical "$name still exists after hard delete at cap. CHECK OVH."
        else
          say "$name deleted (verified: GET instance -> 404)"; notify normal "$name deleted at cap ($cap min)"
        fi
      else
        say "delete of $name refused/failed"; notify critical "could not delete $name. CHECK OVH."
      fi
      continue
    fi
    if (( now >= park_at )); then
      if [[ "$name" == "$WEB_NAME" ]]; then
        say "$name age ${age} min >= cap-$LEAD_MIN: park.sh (snapshot + delete)"
        [[ "$dry" == yes ]] || bg_unit "${TUBE_PREFIX}park-run" "$here/park.sh" --auto "$id"
      else
        say "$name age ${age} min >= cap-$LEAD_MIN: teardown.sh $name"
        [[ "$dry" == yes ]] || bg_unit "${TUBE_PREFIX}teardown-run" "$here/teardown.sh" "$name"
      fi
      if (( next == 0 || kill_at < next )); then next=$kill_at; fi
    else
      [[ "$dry" == yes ]] && say "$name ($status) age ${age} min: ok (park/teardown at $(date -d "@$park_at" '+%F %T'), delete at $(date -d "@$kill_at" '+%F %T'))"
      if (( next == 0 || park_at < next )); then next=$park_at; fi
    fi
  done < <(jq -r '.[] | "\(.id) \(.name) \(.status) \(.created)"' <<<"$inst")
  if [[ "$dry" == yes ]]; then say "would arm wake timer at $(date -d "@$next" '+%F %T')"; else arm_wake "$next"; fi
}

case "${1:-status}" in
  install)   install_units ;;
  uninstall) uninstall_units ;;
  status)    status_units ;;
  ensure)    if systemctl --user is-active -q "$UNIT.timer" 2>/dev/null; then echo "watchdog timer active"; else install_units; fi
             systemctl --user is-active -q "$UNIT.timer" ;;
  run)       shift; run_cycle "$@" ;;
  *) sed -n '2,19p' "$0" >&2; exit 2 ;;
esac
