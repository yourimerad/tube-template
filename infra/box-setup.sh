#!/usr/bin/env bash
# box-setup.sh : prepares an Ubuntu 22.04/24.04 box for the site. Runs as root, idempotent.
# Used two ways, with the same steps:
#   - OVH target: embedded in the cloud-init user data by infra/up.sh (runs at first boot, and again on a box
#     restored from a park snapshot, since park runs `cloud-init clean`)
#   - SSH target: piped over ssh by infra/up.sh (`./tube up` on target ssh): ssh host 'sudo bash -s' < box-setup.sh
# Settings (environment):
#   ROLE=web|loadgen        loadgen: docker + firewall only
#   ROOT=/srv/<slug>        box root (app/, media/, secrets/, letsencrypt/, certbot-www/)
#   ADMIN_USER=ubuntu       owns ROOT/app and ROOT/media, joins the docker group
#   SSH_PORT=22  SSH_ALLOW_FROM=any|<ip/cidr>   ufw rule for SSH
#   RESET_UFW=0|1           1 on a fresh cloud box only (wipes existing rules)
#   HARDEN=0|1              sshd drop-in: key only, no root login, no passwords
#   MARKER=/run/site-box/setup.ok
set -euo pipefail
ROLE="${ROLE:-web}"
ROOT="${ROOT:?ROOT is required (e.g. /srv/mysite)}"
ADMIN_USER="${ADMIN_USER:-ubuntu}"
SSH_PORT="${SSH_PORT:-22}"
SSH_ALLOW_FROM="${SSH_ALLOW_FROM:-any}"
RESET_UFW="${RESET_UFW:-0}"
HARDEN="${HARDEN:-0}"
MARKER="${MARKER:-/run/site-box/setup.ok}"
case "$ROOT" in /srv/?*) ;; *) echo "ROOT must be under /srv/" >&2; exit 2 ;; esac
[[ "$ROLE" =~ ^(web|loadgen)$ && "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo "bad ROLE/SSH_PORT" >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo "box-setup.sh must run as root" >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
case "${VERSION_ID:-}" in 22.04|24.04) ;; *) echo "WARNING: tested on Ubuntu 22.04/24.04, this is ${PRETTY_NAME:-unknown}" >&2 ;; esac
step() { echo "== $*"; }
mkdir -p "$(dirname "$MARKER")"
rm -f "$MARKER"

step "packages"
export DEBIAN_FRONTEND=noninteractive
pkgs=(ufw curl jq rsync ca-certificates)
[[ "$ROLE" == web ]] && pkgs+=(fail2ban unattended-upgrades)
if command -v docker >/dev/null 2>&1; then
  echo "docker already installed ($(docker --version)): kept as is"
  docker compose version >/dev/null 2>&1 || pkgs+=(docker-compose-v2)
else
  pkgs+=(docker.io docker-compose-v2 docker-buildx)
fi
apt-get update -q
apt-get install -y -q --no-install-recommends "${pkgs[@]}"

step "system settings"
mkdir -p /etc/systemd/journald.conf.d /etc/docker /etc/sysctl.d
cat > /etc/systemd/journald.conf.d/00-site.conf <<'EOF'
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=100M
MaxRetentionSec=7day
EOF
if [[ ! -s /etc/docker/daemon.json ]]; then
  echo '{"log-driver": "json-file", "log-opts": {"max-size": "20m", "max-file": "3"}, "live-restore": true}' > /etc/docker/daemon.json
else
  echo "/etc/docker/daemon.json exists: kept"
fi
if [[ "$ROLE" == web ]]; then
  cat > /etc/sysctl.d/90-site.conf <<'EOF'
vm.swappiness = 10
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 10240 65000
EOF
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  cat > /etc/apt/apt.conf.d/52site-unattended <<'EOF'
// security updates only (Ubuntu default origins); never reboot; never restart docker under load
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Package-Blacklist { "docker.io"; "containerd"; "runc"; "docker-compose-v2"; "docker-buildx"; };
EOF
  mkdir -p /etc/fail2ban/jail.d
  printf '[sshd]\nenabled = true\nport = %s\nmaxretry = 5\nbantime = 1h\n' "$SSH_PORT" > /etc/fail2ban/jail.d/site.local
  # 2 GB swap file when the box has none and little RAM
  if ! swapon --show=NAME --noheadings | grep -q . && (( $(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo) < 6000 )); then
    [[ -f /swapfile ]] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
    swapon /swapfile 2>/dev/null || true
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
else
  cat > /etc/sysctl.d/90-site.conf <<'EOF'
net.ipv4.ip_local_port_range = 10240 65000
net.ipv4.tcp_tw_reuse = 1
fs.file-max = 1000000
EOF
  systemctl stop unattended-upgrades apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
fi
sysctl --system >/dev/null
systemctl restart systemd-journald

if [[ "$HARDEN" == 1 ]]; then
  step "sshd hardening"
  cat > /etc/ssh/sshd_config.d/00-site.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AuthenticationMethods publickey
X11Forwarding no
EOF
  sshd -t && { systemctl reload ssh 2>/dev/null || systemctl restart ssh 2>/dev/null || true; }
fi

step "docker"
systemctl enable --now docker
id "$ADMIN_USER" >/dev/null 2>&1 && usermod -aG docker "$ADMIN_USER"

if [[ "$ROLE" == web ]]; then
  step "layout $ROOT"
  mkdir -p "$ROOT/app" "$ROOT/media" "$ROOT/secrets" "$ROOT/letsencrypt" "$ROOT/certbot-www"
  id "$ADMIN_USER" >/dev/null 2>&1 && chown "$ADMIN_USER:" "$ROOT/app" "$ROOT/media"
  chmod 0711 "$ROOT/secrets"
  chmod 0755 "$ROOT" "$ROOT/media" "$ROOT/letsencrypt" "$ROOT/certbot-www"
  # htpasswd must be a FILE before compose ever runs: docker creates a DIRECTORY at a missing bind-mount source
  [[ -d "$ROOT/secrets/htpasswd" ]] && rm -rf "$ROOT/secrets/htpasswd"
  touch "$ROOT/secrets/htpasswd"; chmod 644 "$ROOT/secrets/htpasswd"
fi

step "firewall"
# NOTE: ports published by docker bypass ufw: the compose file publishes only nginx 80/443.
if [[ "$RESET_UFW" == 1 ]]; then ufw --force reset >/dev/null; fi
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [[ "$SSH_ALLOW_FROM" == any ]]; then ufw allow "$SSH_PORT/tcp" >/dev/null
else ufw allow from "$SSH_ALLOW_FROM" to any port "$SSH_PORT" proto tcp >/dev/null; fi
if [[ "$ROLE" == web ]]; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

if [[ "$ROLE" == web ]]; then
  systemctl enable --now fail2ban 2>/dev/null || true
  systemctl enable --now unattended-upgrades 2>/dev/null || true
fi
date +%s > "$MARKER"
echo "box-setup: done ($ROLE, $ROOT)"
