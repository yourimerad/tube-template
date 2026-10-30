#!/usr/bin/env bash
# shellcheck disable=SC2034  # sourced library: variables are used by the scripts that source it
# common.sh : sourced by every infra script (never run directly).
#   source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
# - Loads the site config (TUBE_CONFIG, default ./site.config.json) through `node lib/config.mjs shell`:
#   every name, path, prefix and limit below comes from it; nothing site-specific is hard-coded here.
# - TUBE_DRY_RUN=1: scripts print what they would do. Against OVH only GET requests are sent (ovh.sh refuses
#   any other method in dry-run mode, whatever the caller does).
# - The box: target "ovh" -> found through the API by name (<prefix>web-1); target "ssh" -> deploy.ssh.host.
set -o pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$INFRA_DIR")"
TUBE_CONFIG="${TUBE_CONFIG:-$PWD/site.config.json}"
[[ "$TUBE_CONFIG" == /* ]] || TUBE_CONFIG="$PWD/$TUBE_CONFIG"
export TUBE_CONFIG
_cfg_sh="$(node "$REPO_DIR/lib/config.mjs" --config "$TUBE_CONFIG" shell)" || { echo "config: cannot load $TUBE_CONFIG" >&2; exit 1; }
eval "$_cfg_sh"
unset _cfg_sh
TUBE_DRY_RUN="${TUBE_DRY_RUN:-0}"
mkdir -p "$RUNS_DIR"
KNOWN_HOSTS="$RUNS_DIR/known_hosts"
APP_DIR="$REPO_DIR/app"
S3_ENV="$RUNS_DIR/s3.env"

# Docker image pins
RCLONE_IMAGE="rclone/rclone:1.75.2"
K6_IMAGE="grafana/k6:1.8.1"
CERTBOT_IMAGE="certbot/certbot:v5.8.0"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
is_dry() { [[ "$TUBE_DRY_RUN" == 1 ]]; }
sslip_host() { echo "${1//./-}.sslip.io"; }
iso_to_epoch() { date -d "$1" +%s; }
is_ipv4() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
notify() { command -v notify-send >/dev/null && notify-send -u "$1" -a "${TUBE_PREFIX}infra" "$SITE_NAME" "$2" 2>/dev/null || true; }

# ---- ssh
ssh_opts() {   # one option per line (mapfile -t SSHO < <(ssh_opts))
  printf '%s\n' -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -p "${BOX_PORT:-22}" \
    -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN_HOSTS" -o LogLevel=ERROR
}
rsync_rsh() {
  local o="ssh" a
  while read -r a; do o+=" $(printf '%q' "$a")"; done < <(ssh_opts)
  echo "$o"
}

# The box, for either target: sets BOX_IP BOX_USER BOX_PORT BOX_ADDR SITE_HOST SUDO (+ WEB_ID WEB_CREATED on ovh).
# rc 1 if there is no box.
box_resolve() {
  if [[ "$TARGET" == ssh ]]; then
    [[ -n "$SSH_HOST" ]] || { log "deploy.ssh.host is empty in $CFG_FILE"; return 1; }
    # shellcheck disable=SC2153  # SSH_PORT comes from the config (eval above)
    BOX_ADDR="$SSH_HOST" BOX_USER="$SSH_USER" BOX_PORT="$SSH_PORT"
    if is_ipv4 "$SSH_HOST"; then BOX_IP="$SSH_HOST"; else BOX_IP="$(getent ahostsv4 "$SSH_HOST" 2>/dev/null | awk 'NR==1{print $1}')"; fi
    if [[ -n "$DOMAIN" ]]; then SITE_HOST="$DOMAIN"
    elif is_ipv4 "$SSH_HOST"; then SITE_HOST="$(sslip_host "$SSH_HOST")"
    else SITE_HOST="$SSH_HOST"; fi
  else
    # shellcheck source=ovh.sh
    source "$INFRA_DIR/ovh.sh"
    ovh_web || return 1
    BOX_ADDR="$WEB_IP" BOX_IP="$WEB_IP" BOX_USER=ubuntu BOX_PORT=22
    SITE_HOST="${DOMAIN:-$(sslip_host "$WEB_IP")}"
  fi
  if [[ "$BOX_USER" == root ]]; then SUDO=""; else SUDO="sudo -n"; fi
  export BOX_IP BOX_USER BOX_PORT BOX_ADDR SITE_HOST SUDO
}

# curl config for basic auth on stdin (password never on argv): auth_cfg | curl -K - URL
auth_cfg() {
  [[ -r "$BASIC_FILE" ]] || { log "no $BASIC_FILE (./tube deploy creates it)"; return 1; }
  printf 'user = "%s:' "$BASIC_USER"; tr -d '\n' < "$BASIC_FILE"; printf '"\n'
}

# A fresh random secret into a 600 file (never printed). new_secret_file FILE [LENGTH]
new_secret_file() {
  ( umask 077; mkdir -p "$(dirname "$1")"
    # (not `tr < /dev/urandom | head`: tr's SIGPIPE + pipefail would abort the caller under set -e)
    node -e 'process.stdout.write(require("crypto").randomBytes(96).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, Number(process.argv[1])))' "${2:-32}" > "$1" )
  chmod 600 "$1"
}

bucket_name() {   # from config, else runs/s3.env (written by bucket.sh create)
  if [[ -n "$S3_BUCKET_CFG" ]]; then echo "$S3_BUCKET_CFG"; else sed -n 's/^BUCKET=//p' "$S3_ENV" 2>/dev/null; fi
}
