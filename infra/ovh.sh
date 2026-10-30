#!/usr/bin/env bash
# shellcheck disable=SC2034  # sourced library: variables are used by the scripts that source it
# ovh.sh : OVH Public Cloud API helpers, sourced after common.sh (never run directly).
# - Bearer token read from the file named by deploy.ovh.token_secret (default ~/.secrets/ovh-api-token), or
#   $OVH_API_TOKEN. Never printed, never on argv: it reaches curl through a config on a pipe (-K <(...)).
# - Retries with backoff on network errors, HTTP 5xx/429 and the transient Server::InternalServerError.
# - TUBE_DRY_RUN=1: ovh_post/ovh_delete print "DRY-RUN would ..." and ovh_call itself REFUSES any method
#   other than GET, so a dry run cannot change anything even through a code path that forgot to check.
# - Safety: only resources whose name starts with deploy.prefix may be deleted; ids listed in
#   deploy.ovh.protected_ids are always refused; the API must agree on the id <-> name pair.
[[ -n "${_OVH_SH_LOADED:-}" ]] && return 0
_OVH_SH_LOADED=1

[[ -n "$OVH_PROJECT" ]] || { echo "deploy.ovh.project_id is empty in $CFG_FILE" >&2; exit 1; }
# Region: env, else runs/region (the last region a create succeeded in), else deploy.ovh.region.
OVH_REGION="${OVH_REGION:-$( { tr -d '[:space:]' < "$RUNS_DIR/region"; } 2>/dev/null || true)}"
OVH_REGION="${OVH_REGION:-$OVH_REGION_CFG}"
LEAD_MIN=15

if [[ -z "${OVH_API_TOKEN:-}" && -r "$OVH_TOKEN_FILE" ]]; then
  OVH_API_TOKEN="$(tr -d '\n' < "$OVH_TOKEN_FILE")"
fi
: "${OVH_API_TOKEN:?no OVH token: put it in the file named by deploy.ovh.token_secret (in $SECRETS_DIR) or export OVH_API_TOKEN}"

cap_for() {   # minutes after the API `created` time
  case "$1" in "$LOADGEN_NAME") echo "$CAP_LOADGEN" ;; *) echo "$CAP_WEB" ;; esac
}

# ovh_call METHOD PATH [JSON_BODY] -> body on stdout. rc 0 ok, 1 transient failure after retries, 2 HTTP 4xx.
ovh_call() {
  local method="$1" path="$2" body="${3:-}"
  if is_dry && [[ "$method" != GET ]]; then
    log "REFUSED: $method $path in dry-run mode (only GET is allowed)"; return 3
  fi
  local attempt=1 max="${OVH_MAX_TRIES:-8}" delay=2 out code tmp
  tmp="$(mktemp)"
  while :; do
    local args=(-sS -o "$tmp" -w '%{http_code}' -X "$method"
                -H 'Accept: application/json' --connect-timeout 10 --max-time 60)
    [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")
    # the <(...) must sit on the curl command itself (in an array assignment its fd closes too early)
    code="$(curl "${args[@]}" -K <(printf 'header = "Authorization: Bearer %s"\n' "$OVH_API_TOKEN") \
              "$OVH_API$path" 2>/dev/null || echo 000)"
    out="$(cat "$tmp")"
    if [[ "$code" =~ ^2 ]] && ! grep -q 'Server::InternalServerError' <<<"$out"; then
      rm -f "$tmp"; printf '%s' "$out"; return 0
    fi
    if [[ "$code" =~ ^(000|5..|429)$ ]] || grep -q 'Server::InternalServerError' <<<"$out"; then
      if (( attempt >= max )); then
        log "ovh $method $path failed after $attempt tries (HTTP $code): ${out:0:300}"
        rm -f "$tmp"; return 1
      fi
      log "ovh $method $path HTTP $code, retry $attempt/$max in ${delay}s"
      sleep "$delay"; attempt=$((attempt + 1)); delay=$(( delay * 2 > 30 ? 30 : delay * 2 ))
      continue
    fi
    log "ovh $method $path HTTP $code: ${out:0:300}"
    rm -f "$tmp"; printf '%s' "$out"; return 2
  done
}

# Printable summary of a request body for dry runs (userData / publicKey shortened).
_dry_body() {
  jq -c 'if type=="object" then
           (if .userData then .userData = "<cloud-init \(.userData|length) bytes>" else . end)
           | (if .publicKey then .publicKey = (.publicKey[0:24] + "...") else . end)
         else . end' <<<"${1:-{\}}" 2>/dev/null || printf '%s' "${1:0:120}"
}

ovh_get() { ovh_call GET "$1"; }
ovh_post() {
  if is_dry; then echo "DRY-RUN would POST $1 $(_dry_body "${2:-}")" >&2; printf '{"id":"dry-run"}'; return 0; fi
  ovh_call POST "$1" "${2:-{\}}"
}
ovh_delete() {
  if is_dry; then echo "DRY-RUN would DELETE $1" >&2; return 0; fi
  ovh_call DELETE "$1"
}

P="/cloud/project/$OVH_PROJECT"

is_protected() { local x; for x in "${PROTECTED_IDS[@]}"; do [[ "$1" == "$x" ]] && return 0; done; return 1; }

# ---- guards: every destructive action goes through these
guard_instance() {   # guard_instance ID NAME
  local id="$1" name="$2"
  if [[ -z "$id" ]] || is_protected "$id"; then log "REFUSED: protected/empty instance id '$id'"; return 1; fi
  if [[ "$name" != "$TUBE_PREFIX"* ]]; then log "REFUSED: instance '$name' ($id) is not $TUBE_PREFIX*"; return 1; fi
  local live; live="$(ovh_get "$P/instance/$id" | jq -r '.name // empty' 2>/dev/null)" || live=""
  if [[ -n "$live" && "$live" != "$name" ]]; then log "REFUSED: id $id is '$live' in the API, not '$name'"; return 1; fi
  return 0
}
guard_snapshot() {   # guard_snapshot ID NAME
  local id="$1" name="$2"
  if [[ -z "$id" ]] || is_protected "$id"; then log "REFUSED: protected/empty snapshot id '$id'"; return 1; fi
  if [[ "$name" != "$PARK_PREFIX"* ]]; then log "REFUSED: snapshot '$name' ($id) is not $PARK_PREFIX*"; return 1; fi
  local live; live="$(ovh_get "$P/snapshot/$id" | jq -r '.name // empty' 2>/dev/null)" || live=""
  if [[ -n "$live" && "$live" != "$name" ]]; then log "REFUSED: snapshot id $id is '$live' in the API"; return 1; fi
  return 0
}
delete_instance() {  # delete_instance ID NAME  (guarded; records deleted.tsv)
  guard_instance "$1" "$2" || return 1
  ovh_delete "$P/instance/$1" >/dev/null || return 1
  is_dry && return 0
  grep -q "^$1" "$RUNS_DIR/deleted.tsv" 2>/dev/null || printf '%s\t%s\t%s\n' "$1" "$2" "$(date +%s)" >> "$RUNS_DIR/deleted.tsv"
}
delete_snapshot() {  # delete_snapshot ID NAME  (guarded)
  guard_snapshot "$1" "$2" || return 1
  ovh_delete "$P/snapshot/$1" >/dev/null
}

# ---- listings (only <prefix>* resources, never a protected id)
# Instances as a JSON array of {id,name,status,region,flavor,created,ip,ips[]}.
prefix_instances() {
  local src
  # test fixture (dry runs only): TUBE_FAKE_INSTANCES=<json file shaped like GET /instance>
  if is_dry && [[ -n "${TUBE_FAKE_INSTANCES:-}" ]]; then src="$(cat "$TUBE_FAKE_INSTANCES")"; else src="$(ovh_get "$P/instance")" || return 1; fi
  jq -c --arg pfx "$TUBE_PREFIX" --argjson prot "$(printf '%s\n' "${PROTECTED_IDS[@]}" | jq -R 'select(length>0)' | jq -sc .)" '
    [ .[] | select((.name | startswith($pfx)) and ((.id as $i | $prot | index($i)) | not))
          | {id, name, status, region, flavor: (.flavorId // .flavor.id // null), created,
             ips: [.ipAddresses[]? | select(.version == 4 and .type == "public") | .ip],
             ip: ([.ipAddresses[]? | select(.version == 4 and .type == "public") | .ip][0])} ]' <<<"$src"
}
instance_by_name() { prefix_instances | jq -c --arg n "$1" '[.[] | select(.name==$n)][0] // empty'; }
# <prefix>park-* snapshots (all regions), oldest first.
park_snapshots() {
  ovh_get "$P/snapshot" | jq -c --arg pfx "$PARK_PREFIX" --argjson prot "$(printf '%s\n' "${PROTECTED_IDS[@]}" | jq -R 'select(length>0)' | jq -sc .)" \
    '[.[] | select((.name | startswith($pfx)) and ((.id as $i | $prot | index($i)) | not))
          | {id, name, status, size, minDisk, region, creationDate}] | sort_by(.creationDate)'
}

# The web box: IP from the API (truth), exported as WEB_ID WEB_IP WEB_CREATED WEB_REGION. rc 1 if absent.
ovh_web() {
  local row; row="$(instance_by_name "$WEB_NAME")" || return 1
  [[ -n "$row" ]] || return 1
  WEB_ID="$(jq -r .id <<<"$row")"; WEB_IP="$(jq -r '.ip // empty' <<<"$row")"
  WEB_CREATED="$(jq -r .created <<<"$row")"; WEB_REGION="$(jq -r .region <<<"$row")"
  [[ -n "$WEB_IP" ]] || return 1
  # a box may have 2 public IPv4s (a create that 500ed); up.sh records the one that answered SSH
  if [[ -f "$RUNS_DIR/web.env" ]]; then
    local rec; rec="$(sed -n 's/^IP=//p' "$RUNS_DIR/web.env")"
    if [[ -n "$rec" ]] && jq -e --arg i "$rec" '.ips | index($i)' <<<"$row" >/dev/null; then WEB_IP="$rec"; fi
  fi
  export WEB_ID WEB_IP WEB_CREATED WEB_REGION
}
