#!/usr/bin/env bash
# up.sh [--fresh] [--loadgen] [--dry-run]          (`./tube up`)
# target ovh:
#   default   : create <prefix>web-1 (deploy.ovh.web_flavor) from the newest ACTIVE <prefix>park-* snapshot,
#               else the plain image (deploy.ovh.image, Ubuntu 24.04)
#   --fresh   : ignore snapshots
#   --loadgen : create <prefix>loadgen (deploy.ovh.loadgen_flavor, docker only, SSH-only firewall, short cap)
#   Regions: runs/region (last success) or deploy.ovh.region first, then deploy.ovh.fallback_regions: a region
#   without the flavor/image is skipped, an instance that lands in ERROR is deleted (guarded) and the next
#   region is tried. A snapshot only exists in its own region: other regions start from the plain image.
#   Order: watchdog timer active (installed if missing) BEFORE the create; one POST /instance per region, never
#   a blind re-POST (a 500 may still create the box: look it up by name); wait ACTIVE -> SSH -> cloud-init.
# target ssh:
#   bootstrap deploy.ssh.host: pipe infra/box-setup.sh over ssh (sudo -n unless the user is root): packages,
#   docker, ufw (SSH from deploy.ssh.allow_ssh_from + 80/443), journald/sysctl/swap, /srv/<slug> layout.
# --dry-run : ovh: real read-only GETs, prints the POSTs it would make. ssh: prints the steps, connects nowhere.
# Idempotent. Last line (machine-readable): READY name=... ip=... host=... [deadline=<iso>]
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

FRESH=no ROLE=web
for a in "$@"; do
  case "$a" in
    --fresh) FRESH=yes ;;
    --loadgen) ROLE=loadgen ;;
    --dry-run) TUBE_DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg $a" >&2; exit 2 ;;
  esac
done
LOG="$RUNS_DIR/up.log"
say() { if is_dry; then printf '%s\n' "$*" >&2; else printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" >&2; fi; }

setup_env() {   # setup_env ROLE SSH_FROM RESET HARDEN USER -> "K=V K=V ..." (values are validated, no quoting needed)
  printf 'ROLE=%s ROOT=%s ADMIN_USER=%s SSH_PORT=%s SSH_ALLOW_FROM=%s RESET_UFW=%s HARDEN=%s' \
    "$1" "$REMOTE_ROOT" "$5" "${BOX_PORT:-22}" "$2" "$3" "$4"
}

# =========================================================================== target ssh
if [[ "$TARGET" == ssh ]]; then
  [[ "$ROLE" == web ]] || { say "--loadgen needs target ovh (use ./tube loadtest --local on target ssh)"; exit 2; }
  box_resolve
  [[ "$SSH_ALLOW_FROM" == any || "$SSH_ALLOW_FROM" =~ ^[0-9.:a-fA-F/]+$ ]] || { say "bad deploy.ssh.allow_ssh_from"; exit 2; }
  env_s="$(setup_env web "$SSH_ALLOW_FROM" 0 "$SSH_HARDEN" "$BOX_USER")"
  if is_dry; then
    say "=== up DRY RUN (target ssh): nothing is contacted or changed"
    say "1. ssh $BOX_USER@$BOX_ADDR -p $BOX_PORT (key $SSH_KEY, known_hosts $KNOWN_HOSTS): check login${SUDO:+ and passwordless sudo}"
    say "2. pipe infra/box-setup.sh: ${SUDO:+$SUDO }env $env_s bash -s"
    say "   -> apt: ufw curl jq rsync fail2ban unattended-upgrades (+ docker.io docker-compose-v2 docker-buildx if docker is absent)"
    say "   -> journald 200M, docker log rotation (if no daemon.json), sysctl, 2 GB swap if none and RAM < 6 GB"
    say "   -> $REMOTE_ROOT/{app,media,secrets,letsencrypt,certbot-www}, secrets/htpasswd as a FILE"
    say "   -> ufw (existing rules kept): allow $BOX_PORT/tcp from $SSH_ALLOW_FROM, 80/tcp, 443/tcp; enable"
    [[ "$SSH_HARDEN" == 1 ]] && say "   -> sshd drop-in: key only, no root login"
    say "3. verify the marker /run/site-box/setup.ok, docker compose version"
    echo "READY name=$BOX_ADDR ip=${BOX_IP:-?} host=$SITE_HOST (dry run)"
    exit 0
  fi
  mapfile -t SSHO < <(ssh_opts)
  ssh "${SSHO[@]}" "$BOX_USER@$BOX_ADDR" true || { say "cannot ssh $BOX_USER@$BOX_ADDR -p $BOX_PORT with $SSH_KEY"; exit 1; }
  if [[ -n "$SUDO" ]]; then ssh "${SSHO[@]}" "$BOX_USER@$BOX_ADDR" 'sudo -n true' || { say "$BOX_USER needs passwordless sudo (or use root)"; exit 1; }; fi
  say "bootstrap $BOX_USER@$BOX_ADDR ($env_s)"
  # shellcheck disable=SC2029  # env_s is expanded locally on purpose (validated values)
  ssh "${SSHO[@]}" "$BOX_USER@$BOX_ADDR" "$SUDO env $env_s bash -s" < "$INFRA_DIR/box-setup.sh" 2>&1 | tee -a "$LOG" | sed 's/^/  box: /' >&2
  ssh "${SSHO[@]}" "$BOX_USER@$BOX_ADDR" 'test -f /run/site-box/setup.ok && docker --version; (docker compose version 2>/dev/null || sudo -n docker compose version) | head -1' 2>&1 | sed 's/^/  box: /' >&2 \
    || { say "setup marker missing"; exit 12; }
  printf 'NAME=%s\nIP=%s\nHOST=%s\n' "$BOX_ADDR" "${BOX_IP:-}" "$SITE_HOST" > "$RUNS_DIR/web.env"
  say "box ready: $BOX_ADDR (site host $SITE_HOST)"
  echo "READY name=$BOX_ADDR ip=${BOX_IP:-?} host=$SITE_HOST"
  exit 0
fi

# =========================================================================== target ovh
# shellcheck source=ovh.sh
source "$INFRA_DIR/ovh.sh"
if [[ "$ROLE" == web ]]; then NAME="$WEB_NAME" FLAVOR="$WEB_FLAVOR"; else NAME="$LOADGEN_NAME" FLAVOR="$LOADGEN_FLAVOR" FRESH=yes; fi
CAP="$(cap_for "$NAME")"
is_dry && say "=== up DRY RUN ($NAME): GETs are real, nothing is created"

# ---- existing <prefix> resources
inst="$(prefix_instances)"
say "GET $P/instance -> $TUBE_PREFIX* instances: $(jq -c '[.[] | {name, status, ip, region}]' <<<"$inst")"
row="$(jq -c --arg n "$NAME" '[.[] | select(.name==$n)][0] // empty' <<<"$inst")"
if [[ -n "$row" ]]; then
  ip="$(jq -r '.ip // empty' <<<"$row")"; created="$(jq -r .created <<<"$row")"
  say "$NAME already exists ($(jq -r .status <<<"$row")): nothing created"
  is_dry || "$INFRA_DIR/watchdog.sh" ensure >&2
  dl="$(date -u -d "@$(( $(iso_to_epoch "$created") + CAP * 60 ))" +%FT%TZ)"
  echo "READY name=$NAME id=$(jq -r .id <<<"$row") ip=$ip host=${DOMAIN:-$(sslip_host "$ip")} created=$created cap_min=$CAP deadline=$dl"
  exit 0
fi
if (( $(jq length <<<"$inst") >= MAX_INSTANCES )); then say "$MAX_INSTANCES $TUBE_PREFIX* instances already exist: refusing another"; exit 1; fi

# ---- regions to try, snapshot region first
snaps="$(park_snapshots)"
say "GET $P/snapshot -> $PARK_PREFIX*: $(jq -c '[.[] | {name, status, size, region}]' <<<"$snaps")"
snap_row=""
[[ "$FRESH" == no ]] && snap_row="$(jq -c '[.[] | select(.status=="active")] | last // empty' <<<"$snaps")"
regions=()
[[ -n "$snap_row" ]] && regions+=("$(jq -r .region <<<"$snap_row")")
for r in "$OVH_REGION" "$OVH_REGION_CFG" "${OVH_FALLBACK_REGIONS[@]}"; do
  [[ -n "$r" ]] || continue
  [[ " ${regions[*]} " == *" $r "* ]] || regions+=("$r")
done
say "region order: ${regions[*]}"

# ---- ssh key <prefix>key (all regions)
pub="$(cat "$SSH_KEY.pub")"
keys="$(ovh_get "$P/sshkey")"
key_id="$(jq -r --arg n "$KEY_NAME" '[.[] | select(.name==$n)][0].id // empty' <<<"$keys")"
if [[ -n "$key_id" ]]; then
  krow="$(jq -c --arg n "$KEY_NAME" '[.[] | select(.name==$n)][0]' <<<"$keys")"
  [[ "$(jq -r .publicKey <<<"$krow" | awk '{print $2}')" == "$(awk '{print $2}' <<<"$pub")" ]] \
    || { say "$KEY_NAME exists with a DIFFERENT public key than $SSH_KEY.pub: fix it by hand"; exit 1; }
  say "GET $P/sshkey -> $KEY_NAME = $key_id"
else
  # OVH may refuse a second key with an identical public key: then only REFERENCE the existing one
  same="$(jq -r --arg k "$(awk '{print $2}' <<<"$pub")" '[.[] | select((.publicKey | split(" ")[1]) == $k)][0].id // empty' <<<"$keys")"
  if [[ -n "$same" ]]; then
    key_id="$same"; say "GET $P/sshkey -> reusing the existing key with the same public key ($key_id), read-only"
  else
    say "GET $P/sshkey -> no $KEY_NAME yet"
    key_id="$(ovh_post "$P/sshkey" "$(jq -nc --arg n "$KEY_NAME" --arg pub "$pub" '{name:$n, publicKey:$pub}')" | jq -r '.id // empty' 2>/dev/null)" || key_id=""
    [[ -n "$key_id" ]] || { say "could not register $KEY_NAME"; exit 1; }
    is_dry || say "registered ssh key $KEY_NAME ($key_id)"
  fi
fi

# ---- user data: SSH pinned to the current public IPv4
admin_ip="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
is_ipv4 "$admin_ip" || { say "could not detect your public IPv4 (api.ipify.org)"; exit 1; }
BOX_PORT=22
env_s="$(setup_env "$ROLE" "$admin_ip" 1 1 ubuntu)"
userdata="$(sed -e "s|__SETUP_B64__|$(base64 -w0 "$INFRA_DIR/box-setup.sh")|" -e "s|__SETUP_ENV__|$env_s|" "$INFRA_DIR/cloud-init.yaml")"
say "admin IP $admin_ip (ufw: 22 from it only$( [[ $ROLE == web ]] && echo '; 80/443 from anywhere'))"

# ---- watchdog must be live before anything is created
if ! is_dry; then
  "$INFRA_DIR/watchdog.sh" ensure >&2 || { say "watchdog timer not active: refusing to create"; exit 1; }
fi

T_CREATE=$(date +%s)
inst_id="" st="" REGION="" image_name=""
for REGION in "${regions[@]}"; do
  # flavor
  flavors="$(ovh_get "$P/flavor?region=$REGION")" || { say "$REGION: flavor list failed, next region"; continue; }
  frow="$(jq -c --arg n "$FLAVOR" '[.[] | select(.name==$n and .osType=="linux" and .available)][0] // empty' <<<"$flavors")"
  [[ -n "$frow" ]] || { say "$REGION: flavor $FLAVOR not available, next region"; continue; }
  flavor_id="$(jq -r .id <<<"$frow")"; flavor_disk="$(jq -r .disk <<<"$frow")"
  say "GET $P/flavor?region=$REGION -> $FLAVOR = $flavor_id ($(jq -r '"\(.vcpus) vCPU, \(.ram) GB RAM, \(.disk) GB disk, \(.outboundBandwidth) Mbps out"' <<<"$frow"))"
  # image: the snapshot when it lives here and fits, else the plain image
  image_id="" image_name=""
  if [[ -n "$snap_row" && "$(jq -r .region <<<"$snap_row")" == "$REGION" ]] && (( $(jq -r '.minDisk // 0' <<<"$snap_row") <= flavor_disk )); then
    image_id="$(jq -r .id <<<"$snap_row")"; image_name="$(jq -r .name <<<"$snap_row")"
    say "using snapshot $image_name ($image_id) (--fresh to use the plain image)"
  else
    [[ -n "$snap_row" ]] && say "$REGION: the park snapshot lives in $(jq -r .region <<<"$snap_row"): plain image here (comments/votes from the snapshot are NOT restored)"
    image_name="$OVH_IMAGE"
    image_id="$(ovh_get "$P/image?osType=linux&region=$REGION" | jq -r --arg n "$image_name" '[.[] | select(.name==$n and .status=="active")][0].id // empty')"
    [[ -n "$image_id" ]] || { say "$REGION: image '$image_name' not found, next region"; continue; }
    say "GET $P/image?osType=linux&region=$REGION -> '$image_name' = $image_id"
  fi
  body="$(jq -nc --arg name "$NAME" --arg f "$flavor_id" --arg i "$image_id" --arg r "$REGION" \
            --arg k "$key_id" --arg u "$userdata" \
            '{name:$name, flavorId:$f, imageId:$i, region:$r, sshKeyId:$k, userData:$u, monthlyBilling:false}')"
  if is_dry; then
    say "watchdog: $("$INFRA_DIR/watchdog.sh" status 2>&1 | head -1) (a real run installs/starts it first if needed)"
    ovh_post "$P/instance" "$body" >/dev/null
    say "DRY-RUN then: wait ACTIVE (ERROR -> guarded DELETE, next region of: ${regions[*]}), ssh ubuntu@<ip>, cloud-init status --wait, /run/site-box/setup.ok"
    say "DRY-RUN cap $CAP min: watchdog parks/tears down at created+$((CAP - LEAD_MIN)) min, hard delete at created+$CAP min"
    exit 0
  fi

  say "create $NAME in $REGION flavor=$FLAVOR image='$image_name' cap=${CAP}min"
  inst_id=""
  rc=0; created="$(OVH_MAX_TRIES=1 ovh_post "$P/instance" "$body")" || rc=$?
  inst_id="$(jq -r '.id // empty' <<<"$created" 2>/dev/null || true)"
  if [[ -z "$inst_id" ]]; then
    # a 500 may still have created it: look it up by name before anything else
    say "create returned no id (rc $rc: ${created:0:200}); looking it up by name"
    for _ in 1 2 3 4 5 6; do
      sleep 15
      inst_id="$(instance_by_name "$NAME" | jq -r '.id // empty')" || inst_id=""
      [[ -n "$inst_id" ]] && break
    done
  fi
  [[ -n "$inst_id" ]] || { say "$REGION: nothing named $NAME exists after the create, next region"; continue; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -d "@$T_CREATE" --iso-8601=seconds)" "$NAME" "$inst_id" "$FLAVOR" "$image_name" "$CAP" "$REGION" >> "$RUNS_DIR/instances.tsv"
  say "created $NAME id=$inst_id in $REGION"
  # wait ACTIVE (ERROR -> delete, next region)
  T_REGION=$(date +%s) status=""
  while :; do
    st="$(ovh_get "$P/instance/$inst_id")" || { sleep 5; continue; }
    status="$(jq -r .status <<<"$st")"
    if [[ "$status" == ACTIVE ]] && jq -e '[.ipAddresses[]? | select(.version==4 and .type=="public")] | length > 0' <<<"$st" >/dev/null; then break; fi
    [[ "$status" == ERROR ]] && break
    (( $(date +%s) - T_REGION > 1500 )) && { status=TIMEOUT; break; }
    sleep 5
  done
  [[ "$status" == ACTIVE ]] && break
  say "$REGION: instance $status: deleting it (guarded), next region"
  delete_instance "$inst_id" "$NAME" || true
  for _ in $(seq 1 30); do instance_by_name "$NAME" | grep -q . || break; sleep 10; done
  inst_id=""
done
[[ -n "$inst_id" ]] || { say "no region could create $NAME (tried: ${regions[*]})"; exit 10; }
echo "$REGION" > "$RUNS_DIR/region"
mapfile -t IPS < <(jq -r '.ipAddresses[]? | select(.version==4 and .type=="public") | .ip' <<<"$st")
T_ACTIVE=$(date +%s)
created_iso="$(jq -r .created <<<"$st")"
say "ACTIVE in $REGION (create->ACTIVE $(( T_ACTIVE - T_CREATE ))s) ips=${IPS[*]}"
(( ${#IPS[@]} > 1 )) && say "WARNING: ${#IPS[@]} public IPv4s attached (duplicate ports after a 500)"

# ---- wait SSH (whichever IP answers), then cloud-init
for c in "${IPS[@]}"; do ssh-keygen -R "$c" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || true; done
mapfile -t SSHO < <(ssh_opts)
ip=""
while [[ -z "$ip" ]]; do
  for c in "${IPS[@]}"; do
    if ssh "${SSHO[@]}" "ubuntu@$c" true 2>/dev/null; then ip="$c"; break; fi
  done
  [[ -n "$ip" ]] && break
  (( $(date +%s) - T_ACTIVE > 900 )) && { say "no SSH 15 min after ACTIVE (watchdog deletes it at cap)"; exit 11; }
  sleep 5
done
say "SSH up on $ip (+$(( $(date +%s) - T_ACTIVE ))s)"
ssh "${SSHO[@]}" "ubuntu@$ip" 'cloud-init status --wait >/dev/null 2>&1; cloud-init status --long | head -3; test -f /run/site-box/setup.ok && echo setup-marker-ok; docker --version; (docker compose version 2>/dev/null || sudo docker compose version) | head -1' 2>&1 | sed 's/^/  box: /' | tee -a "$LOG" >&2
ssh "${SSHO[@]}" "ubuntu@$ip" 'test -f /run/site-box/setup.ok' || { say "setup marker missing: see /var/log/box-setup.log on the box"; exit 12; }

host="${DOMAIN:-$(sslip_host "$ip")}"
[[ "$ROLE" == loadgen ]] && host="$(sslip_host "$ip")"
cat > "$RUNS_DIR/$ROLE.env" <<EOF
NAME=$NAME
INSTANCE_ID=$inst_id
REGION=$REGION
FLAVOR=$FLAVOR
IMAGE="$image_name"
IP=$ip
HOST=$host
CREATED=$created_iso
CAP_MIN=$CAP
ADMIN_IP=$admin_ip
EOF
dl="$(date -u -d "@$(( $(iso_to_epoch "$created_iso") + CAP * 60 ))" +%FT%TZ)"
say "ready in $(( $(date +%s) - T_CREATE ))s: $NAME $ip  $host  (hard delete at $dl)"
echo "READY name=$NAME id=$inst_id ip=$ip host=$host created=$created_iso cap_min=$CAP deadline=$dl"
