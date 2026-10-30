#!/usr/bin/env bash
# deploy.sh [--skip-media] [--skip-cert] [--staging] [--rotate-auth] [--dry-run]      (`./tube deploy`)
# Deploys app/ to the box (target ovh: <prefix>web-1 found via the API; target ssh: deploy.ssh.host) and serves
# it at https://<domain or a-b-c-d.sslip.io>:
#   1. app/site.json regenerated from site.config.json; rsync app/ -> <root>/app (no node_modules, .git, .env*)
#   2. <root>/app/.env.site (non-secret): SITE_HOST SITE_SLUG COMPOSE_PROJECT_NAME TUBE_ROOT MEDIA_HOST_DIR
#      PRIVATE MEDIA_BASE AUTH_REALM SITE_SCHEME
#   3. <root>/secrets/.env (600 root): POSTGRES_PASSWORD + HASH_SALT generated ON THE BOX, once
#   4. basic auth: password generated LOCALLY once into $SECRETS_DIR/<deploy.basic_auth.password_secret> (600,
#      never printed); only its {SHA} hash (computed by node, password read from the file) goes to the box
#   5. media: deploy.media_origin=bucket -> a 600 rclone config written over ssh stdin, rclone (docker) pulls
#      <bucket>/media/ -> <root>/media, config deleted (also on failure); =rsync -> rsync out/media/ over ssh
#   6. docker compose up -d --build; wait for /healthz (with auth)
#   7. Let's Encrypt (certbot webroot) if deploy.tls and no cert yet; restart nginx
#   8. verify: / 401 without auth and 200 with auth (private mode), /healthz 200, X-Robots-Tag
# --dry-run: prints every step with the resolved values; connects to nothing (target ovh: read-only API GETs).
# Idempotent: re-running updates the app and media only (secrets/.env, htpasswd, cert are kept).
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
SKIP_MEDIA=no SKIP_CERT=no STAGING=no ROTATE=no
for a in "$@"; do
  case "$a" in
    --skip-media) SKIP_MEDIA=yes ;; --skip-cert) SKIP_CERT=yes ;; --staging) STAGING=yes ;;
    --rotate-auth) ROTATE=yes ;; --dry-run) TUBE_DRY_RUN=1 ;; -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg $a" >&2; exit 2 ;;
  esac
done
[[ "$TLS" == 1 ]] || SKIP_CERT=yes
LOG="$RUNS_DIR/deploy.log"
say() { if is_dry; then printf '%s\n' "$*" >&2; else printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" >&2; fi; }
[[ -f "$APP_DIR/docker-compose.yml" ]] || { say "no compose file in $APP_DIR"; exit 1; }
if ! box_resolve; then
  if [[ "$TARGET" == ovh ]]; then say "$WEB_NAME not found (./tube up first)"; else say "no ssh host"; fi
  exit 1
fi
ip="$BOX_ADDR" host="$SITE_HOST" root="$REMOTE_ROOT" S="$SUDO"
B="$(bucket_name || true)"

if is_dry; then
  say "=== deploy DRY RUN (target $TARGET): nothing is contacted or changed"
  say "box $BOX_USER@$ip:$BOX_PORT  root $root  site https://$host  (sudo: ${S:-none, root})"
  say "1. node lib/config.mjs runtime app/site.json; rsync -az --delete app/ -> $ip:$root/app/ (excludes node_modules .git .env*)"
  say "2. write $root/app/.env.site: SITE_HOST=$host SITE_SLUG=$SITE_SLUG COMPOSE_PROJECT_NAME=$SITE_SLUG TUBE_ROOT=$root MEDIA_HOST_DIR=$root/media PRIVATE=$SITE_PRIVATE MEDIA_BASE=$MEDIA_BASE"
  say "3. on the box: $root/secrets/.env (600 root) gets POSTGRES_PASSWORD + HASH_SALT if absent (openssl rand on the box)"
  say "4. basic auth: $( [[ -s "$BASIC_FILE" ]] && echo "password file $BASIC_FILE exists" || echo "would generate $BASIC_FILE (600, 32 chars)"); {SHA} hash -> $root/secrets/htpasswd (if empty, or --rotate-auth)"
  if [[ "$SKIP_MEDIA" == yes ]]; then say "5. media: skipped"
  elif [[ "$MEDIA_ORIGIN" == bucket ]]; then
    say "5. media: rclone (docker $RCLONE_IMAGE) on the box: ${B:-<no bucket yet: ./tube bucket create>}/media/ -> $root/media (endpoint $S3_ENDPOINT, keys from $S3_ACCESS_FILE / $S3_SECRET_FILE via a temporary 600 config)"
  else
    say "5. media: rsync -az --delete $MEDIA_OUT/ -> $ip:$root/media/ (dotfiles excluded)"
  fi
  say "6. cd $root/app && $S docker compose -p $SITE_SLUG --env-file .env.site up -d --build --remove-orphans; poll http(s)://$host/healthz"
  if [[ "$SKIP_CERT" == yes ]]; then say "7. certificate: skipped (deploy.tls false or --skip-cert)"
  else say "7. if no cert: ACME webroot probe, certbot ($CERTBOT_IMAGE) certonly --webroot -d $host ${LE_EMAIL:+--email $LE_EMAIL}${LE_EMAIL:---register-unsafely-without-email} $( [[ $STAGING == yes ]] && echo --staging); restart nginx"; fi
  say "8. verify: / without auth -> $( [[ $SITE_PRIVATE == 1 ]] && echo 401 || echo 200), with auth -> 200, /healthz -> 200, X-Robots-Tag"
  echo "DEPLOYED url=https://$host (dry run)"
  exit 0
fi

mapfile -t SSHO < <(ssh_opts)
# shellcheck disable=SC2029  # remote commands are built locally on purpose
R() { ssh "${SSHO[@]}" "$BOX_USER@$ip" "$@"; }
R true || { say "cannot ssh $BOX_USER@$ip (target ovh: ufw allows 22 only from the IP seen by ./tube up)"; exit 1; }
R "test -d $root/secrets" || { say "$root not prepared on the box (./tube up first)"; exit 1; }
say "deploy to $ip ($host, root $root)"
T0=$(date +%s)

# ---- 1. app code
node "$REPO_DIR/lib/config.mjs" --config "$TUBE_CONFIG" runtime "$APP_DIR/site.json"
rsync -az --delete --info=stats1 -e "$(rsync_rsh)" \
  --exclude node_modules/ --exclude .git/ --exclude '.env' --exclude '.env.*' --exclude '*.local' \
  --exclude 'docker-compose.override.yml' --exclude 'compose.override.yml' --exclude 'test/' \
  "$APP_DIR/" "$BOX_USER@$ip:$root/app/" 2>&1 | grep -E 'Number of (regular )?files transferred|Total transferred' | sed 's/^/  rsync: /' >&2 || true
say "app synced"

has_cert() { R "$S test -s $root/letsencrypt/live/$host/fullchain.pem"; }
write_env() {   # write_env SCHEME
  printf 'SITE_HOST=%s\nSITE_SLUG=%s\nCOMPOSE_PROJECT_NAME=%s\nTUBE_ROOT=%s\nMEDIA_HOST_DIR=%s\nPRIVATE=%s\nMEDIA_BASE=%s\nAUTH_REALM=%s\nSITE_SCHEME=%s\n' \
    "$host" "$SITE_SLUG" "$SITE_SLUG" "$root" "$root/media" "$SITE_PRIVATE" "$MEDIA_BASE" "$AUTH_REALM" "$1" \
    | R "cat > $root/app/.env.site && chmod 644 $root/app/.env.site"
}
scheme=http; if has_cert; then scheme=https; fi

# ---- 2. non-secret site env
write_env "$scheme"
say "wrote $root/app/.env.site (SITE_HOST=$host)"

# ---- 3. box-generated secrets (once)
R "$S env ROOT=$root bash -s" <<'REMOTE' | sed 's/^/  box: /' >&2
set -eu
f="$ROOT/secrets/.env"
umask 077
touch "$f"
add() {  # add KEY: only when KEY is absent (never rotates an existing secret)
  if ! grep -q "^$1=" "$f"; then printf '%s=%s\n' "$1" "$(openssl rand -hex "$2")" >> "$f"; echo "secrets/.env: added $1"; else echo "secrets/.env: $1 kept"; fi
}
add POSTGRES_PASSWORD 24
add HASH_SALT 32
chown root:root "$f"; chmod 600 "$f"
REMOTE

# ---- 4. basic auth
if [[ ! -s "$BASIC_FILE" ]]; then
  new_secret_file "$BASIC_FILE" 32
  say "generated basic-auth password into $BASIC_FILE (user $BASIC_USER; not printed)"
fi
chmod 600 "$BASIC_FILE"
# docker creates a DIRECTORY at a missing bind-mount source: make sure htpasswd is a file
R "if [ -d $root/secrets/htpasswd ]; then $S rm -rf $root/secrets/htpasswd; echo 'removed a directory at secrets/htpasswd'; fi; $S touch $root/secrets/htpasswd" >&2
if [[ "$ROTATE" == yes ]] || ! R "test -s $root/secrets/htpasswd"; then
  node "$REPO_DIR/lib/htpasswd.mjs" "$BASIC_USER" "$BASIC_FILE" | R "$S sh -c 'cat > $root/secrets/htpasswd && chmod 644 $root/secrets/htpasswd'"
  say "wrote {SHA} hash to $root/secrets/htpasswd"
else
  say "htpasswd kept (--rotate-auth to rewrite)"
fi

# ---- 5. media
cleanup_conf() { R "$S rm -f $root/secrets/rclone.conf" 2>/dev/null || true; }
if [[ "$SKIP_MEDIA" == no ]]; then
  if [[ "$MEDIA_ORIGIN" == bucket ]]; then
    [[ -n "$B" && "$B" == "$TUBE_PREFIX"* ]] || { say "no $TUBE_PREFIX* bucket (./tube bucket create && ./tube bucket sync first)"; exit 1; }
    [[ -s "$S3_ACCESS_FILE" && -s "$S3_SECRET_FILE" ]] || { say "missing $S3_ACCESS_FILE / $S3_SECRET_FILE"; exit 1; }
    trap cleanup_conf EXIT
    { printf '[s3]\ntype = s3\nprovider = %s\nendpoint = %s\nregion = %s\nacl = private\nno_check_bucket = true\naccess_key_id = ' "$S3_PROVIDER" "$S3_ENDPOINT" "$S3_REGION"
      tr -d '\n' < "$S3_ACCESS_FILE"; printf '\nsecret_access_key = '
      tr -d '\n' < "$S3_SECRET_FILE"; printf '\n'
    } | R "$S sh -c 'umask 077; cat > $root/secrets/rclone.conf'"
    say "media: $B/media/ -> $root/media"
    R "$S bash -s" <<REMOTE 2>&1 | tail -5 | sed 's/^/  box: /' >&2
set -u
trap 'rm -f $root/secrets/rclone.conf' EXIT
docker run --rm -v $root/secrets/rclone.conf:/config/rclone/rclone.conf:ro -v $root/media:/data $RCLONE_IMAGE sync "s3:$B/media/" /data --fast-list --transfers 16 --checkers 16 --retries 3 --stats-one-line --stats 30s -v
echo "media dirs: \$(find $root/media -mindepth 1 -maxdepth 1 -type d | wc -l), size \$(du -sh $root/media | cut -f1)"
REMOTE
    cleanup_conf; trap - EXIT
  else
    [[ -s "$MEDIA_OUT/catalog.json" ]] || { say "no $MEDIA_OUT/catalog.json (./tube ingest first)"; exit 1; }
    say "media: rsync $MEDIA_OUT/ -> $root/media/"
    rsync -az --delete --info=stats1 -e "$(rsync_rsh)" --exclude '.*' "$MEDIA_OUT/" "$BOX_USER@$ip:$root/media/" 2>&1 \
      | grep -E 'Number of (regular )?files transferred|Total transferred' | sed 's/^/  rsync: /' >&2 || true
  fi
  R "test -s $root/media/catalog.json" || say "WARNING: $root/media/catalog.json missing: the app will seed nothing"
fi

# ---- 6. compose up
say "docker compose up -d --build"
R "cd $root/app && $S docker compose -p $SITE_SLUG --env-file .env.site up -d --build --remove-orphans" 2>&1 | tail -15 | sed 's/^/  box: /' >&2
code_of() { auth_cfg | curl -K - -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || echo 000; }
ok=no c=000
for _ in $(seq 1 60); do
  c="$(code_of "$scheme://$host/healthz")"
  if [[ "$c" == 200 ]]; then ok=yes; break; fi
  sleep 5
done
[[ "$ok" == yes ]] || { say "healthz not 200 after 5 min (last $c)"; R "cd $root/app && $S docker compose -p $SITE_SLUG ps; $S docker compose -p $SITE_SLUG logs --tail 30" 2>&1 | sed 's/^/  box: /' >&2; exit 1; }
say "healthy: $scheme://$host/healthz -> 200"

# ---- 7. certificate
if [[ "$SKIP_CERT" == no ]] && ! has_cert; then
  # the ACME webroot must answer without auth on plain HTTP
  R "$S mkdir -p $root/certbot-www/.well-known/acme-challenge && echo probe | $S tee $root/certbot-www/.well-known/acme-challenge/site-probe >/dev/null"
  pc="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$host/.well-known/acme-challenge/site-probe" || echo 000)"
  R "$S rm -f $root/certbot-www/.well-known/acme-challenge/site-probe"
  [[ "$pc" == 200 ]] || { say "ACME webroot probe returned $pc (nginx must serve /.well-known/acme-challenge/ without auth on port 80)"; exit 1; }
  st=(); [[ "$STAGING" == yes ]] && st=(--staging)
  if [[ -n "$LE_EMAIL" ]]; then em=(--email "$LE_EMAIL" --no-eff-email); else em=(--register-unsafely-without-email); fi
  say "certbot for $host ${st[*]}"
  R "$S docker run --rm -v $root/letsencrypt:/etc/letsencrypt -v $root/certbot-www:/var/www/certbot $CERTBOT_IMAGE certonly --webroot -w /var/www/certbot -d $host $(printf '%q ' "${em[@]}") --agree-tos --non-interactive --keep-until-expiring ${st[*]}" 2>&1 | tail -6 | sed 's/^/  box: /' >&2
  has_cert || { say "certbot did not produce a certificate (site stays on HTTP)"; exit 1; }
  write_env https
  R "cd $root/app && $S docker compose -p $SITE_SLUG --env-file .env.site up -d && $S docker compose -p $SITE_SLUG --env-file .env.site restart nginx" 2>&1 | tail -3 | sed 's/^/  box: /' >&2
  sleep 3
fi

# ---- 8. verify
if has_cert; then
  k=(); [[ "$STAGING" == yes ]] && k=(-k)
  na="$(curl "${k[@]}" -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/" || echo 000)"
  wa="$(auth_cfg | curl "${k[@]}" -K - -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/" || echo 000)"
  hz="$(curl "${k[@]}" -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/healthz" || echo 000)"
  xr="$(auth_cfg | curl "${k[@]}" -K - -s -D - -o /dev/null --max-time 15 "https://$host/" | tr -d '\r' | sed -n 's/^[Xx]-[Rr]obots-[Tt]ag: //p' | head -1)"
  want=401; [[ "$SITE_PRIVATE" == 1 ]] || want=200
  say "verify: https / no auth=$na (want $want), with auth=$wa (want 200), /healthz=$hz (want 200), X-Robots-Tag='${xr:-none}'"
  [[ "$na" == "$want" && "$wa" == 200 && "$hz" == 200 ]] || { say "VERIFY FAILED"; exit 1; }
  url="https://$host"
else
  say "no certificate: site on http://$host"
  url="http://$host"
fi
say "deployed in $(( $(date +%s) - T0 ))s: $url  (user $BASIC_USER, password in $BASIC_FILE)"
echo "DEPLOYED url=$url user=$BASIC_USER password_file=$BASIC_FILE"
