#!/usr/bin/env bash
# bucket.sh : the PRIVATE media bucket on any S3-compatible storage (OVH, Scaleway, Cloudflare R2, MinIO, AWS...).
# Endpoint / region / provider / bucket from site.config.json deploy.storage; keys from the two files named
# there (in $SECRETS_DIR). The keys reach the rclone container as env vars passed by NAME (`docker run -e NAME`),
# never on argv.
#   bucket.sh create [--dry-run]   S3 CreateBucket (rclone mkdir). Name: deploy.storage.bucket, else the one in
#                                  runs/s3.env, else a new <prefix>media-<6 hex> (persisted BEFORE the call, so a
#                                  re-run reuses it). Refuses any name not starting with the prefix. Idempotent.
#   bucket.sh sync [localdir] [--dry-run]
#                                  upload <localdir> (default <out_dir>/media) to <bucket>/media/ with
#                                  Cache-Control "public, max-age=31536000, immutable" + explicit Content-Types;
#                                  dotfiles (.ingest.json) never uploaded; remote files gone locally are deleted;
#                                  then media/catalog.json with max-age=60
#   bucket.sh du                   object count + size (rclone size)
#   bucket.sh ls [path]            list objects
#   bucket.sh check                read-only ListBuckets with the stored keys
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
IMMUTABLE="public, max-age=31536000, immutable"
SHORT="public, max-age=60"
say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$RUNS_DIR/bucket.log" >&2; }

# run rclone in docker; extra docker args before "--", rclone args after. Remote name: s3:
rclone_docker() {
  local dargs=()
  while [[ $# -gt 0 && "$1" != -- ]]; do dargs+=("$1"); shift; done
  shift
  [[ -s "$S3_ACCESS_FILE" && -s "$S3_SECRET_FILE" ]] || { echo "missing S3 keys: $S3_ACCESS_FILE / $S3_SECRET_FILE" >&2; return 1; }
  (
    RCLONE_CONFIG_S3_ACCESS_KEY_ID="$(tr -d '\n' < "$S3_ACCESS_FILE")"
    RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$(tr -d '\n' < "$S3_SECRET_FILE")"
    export RCLONE_CONFIG_S3_ACCESS_KEY_ID RCLONE_CONFIG_S3_SECRET_ACCESS_KEY
    export RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER="$S3_PROVIDER" \
           RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_S3_REGION="$S3_REGION" \
           RCLONE_CONFIG_S3_ACL=private RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true
    docker run --rm --user "$(id -u):$(id -g)" \
      -e RCLONE_CONFIG_S3_TYPE -e RCLONE_CONFIG_S3_PROVIDER -e RCLONE_CONFIG_S3_ENDPOINT \
      -e RCLONE_CONFIG_S3_REGION -e RCLONE_CONFIG_S3_ACL -e RCLONE_CONFIG_S3_NO_CHECK_BUCKET \
      -e RCLONE_CONFIG_S3_ACCESS_KEY_ID -e RCLONE_CONFIG_S3_SECRET_ACCESS_KEY \
      -e RCLONE_CONFIG=/tmp/rclone-none.conf \
      "${dargs[@]}" "$RCLONE_IMAGE" "$@"
  )
}

need_bucket() {
  B="$(bucket_name || true)"
  [[ -n "$B" && "$B" == "$TUBE_PREFIX"* ]] || { echo "no $TUBE_PREFIX* bucket (./tube bucket create, or set deploy.storage.bucket)" >&2; exit 1; }
}

cmd_create() {
  local dry=no; [[ "${1:-}" == --dry-run ]] && dry=yes
  local name; name="$(bucket_name || true)"
  [[ -n "$name" ]] || name="${TUBE_PREFIX}media-$(head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  if [[ "$name" != "$TUBE_PREFIX"* || ! "$name" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]]; then
    echo "REFUSED: bucket '$name' must start with the prefix '$TUBE_PREFIX' and be a valid S3 name" >&2; exit 1
  fi
  echo "endpoint $S3_ENDPOINT (region $S3_REGION, provider $S3_PROVIDER), bucket $name"
  if [[ "$dry" == yes ]]; then
    echo "DRY-RUN would persist BUCKET=$name in runs/s3.env, then S3 CreateBucket (rclone mkdir s3:$name), private (no ACL/policy)"
    return 0
  fi
  [[ -n "$S3_BUCKET_CFG" ]] || printf 'BUCKET=%s\nS3_ENDPOINT=%s\nS3_REGION=%s\n' "$name" "$S3_ENDPOINT" "$S3_REGION" > "$S3_ENV"
  if rclone_docker -- lsf "s3:$name" --max-depth 1 >/dev/null 2>&1; then
    say "bucket $name already exists: nothing to do"; return 0
  fi
  rclone_docker -- mkdir "s3:$name" || { say "CreateBucket failed for $name (re-run reuses the name)"; exit 1; }
  rclone_docker -- lsf "s3:$name" --max-depth 1 >/dev/null || { say "bucket $name not visible after create"; exit 1; }
  say "bucket $name created (private)"
}

cmd_du() { need_bucket; echo "$B:"; rclone_docker -- size "s3:$B/media/" 2>&1 | grep -v 'Config file' | sed 's/^/  /'; }
cmd_check() {
  echo "S3 ListBuckets at $S3_ENDPOINT (read-only):"
  rclone_docker -- lsd s3: 2>&1 | grep -v 'Config file .* not found' | sed 's/^/  /'
}
cmd_ls() { need_bucket; rclone_docker -- lsl "s3:$B/${1:-}" --max-depth "${DEPTH:-3}"; }

cmd_sync() {
  local args=() dry=()
  for a in "$@"; do if [[ "$a" == --dry-run ]]; then dry=(--dry-run); else args+=("$a"); fi; done
  local src="${args[0]:-$MEDIA_OUT}"
  [[ -d "$src" ]] || { echo "no $src (./tube ingest first)" >&2; exit 1; }
  src="$(cd "$src" && pwd)"
  need_bucket
  local dst="s3:$B/media/"
  local common=(--fast-list --transfers 16 --checkers 16 --retries 3 --stats-one-line --stats 30s -v "${dry[@]}")
  local mnt=(-v "$src:/data:ro")
  say "sync $src -> $B/media/ ${dry[*]}"
  # one pass per type so each object gets an explicit Content-Type (rclone's mime table lacks .m3u8/.m4s)
  local spec ext ctype
  for spec in 'm3u8=application/vnd.apple.mpegurl' 'm4s=video/iso.segment' 'mp4=video/mp4' \
              'webp=image/webp' 'jpg=image/jpeg' 'json=application/json' 'vtt=text/vtt'; do
    ext="${spec%%=*}"; ctype="${spec#*=}"
    rclone_docker "${mnt[@]}" -- copy /data "$dst" --filter "- /catalog.json" --filter "- .*" --filter "+ *.$ext" --filter "- *" \
      --header-upload "Cache-Control: $IMMUTABLE" --header-upload "Content-Type: $ctype" "${common[@]}"
  done
  # anything else + delete remote files gone locally (catalog.json is handled below, keep it)
  rclone_docker "${mnt[@]}" -- sync /data "$dst" --filter "- /catalog.json" --filter "- .*" \
    --header-upload "Cache-Control: $IMMUTABLE" --delete-after "${common[@]}"
  if [[ -f "$src/catalog.json" ]]; then
    rclone_docker -v "$src/catalog.json:/catalog.json:ro" -- copyto /catalog.json "${dst}catalog.json" \
      --header-upload "Cache-Control: $SHORT" --header-upload "Content-Type: application/json" \
      --no-check-dest "${common[@]}"
  else
    say "WARNING: no catalog.json in $src: the app seeds from <root>/media/catalog.json"
  fi
  say "sync done"
  [[ ${#dry[@]} -eq 0 ]] && cmd_du
  return 0
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  sync)   shift; cmd_sync "$@" ;;
  ls)     shift; cmd_ls "$@" ;;
  du)     cmd_du ;;
  check)  cmd_check ;;
  *) sed -n '2,19p' "$0" >&2; exit 2 ;;
esac
