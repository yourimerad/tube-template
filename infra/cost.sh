#!/usr/bin/env bash
# cost.sh [--summary]                                                                  (`./tube cost`)
# Spend so far + monthly idle cost, EUR excl. and incl. VAT (VAT env, default 1.2 = 20%).
#   - <prefix>* instances: OVH usage API (GET .../usage/current, refreshed ~hourly) for every id in runs/instances.tsv
#     or alive now, plus an estimate = elapsed minutes x catalog hourly price (OVH bills hourly instances per minute)
#   - idle per month: <prefix>park-* snapshots (size x `snapshot.consumption` GiB*h price x 730) +
#     the bucket (rclone size x deploy.storage.price_gb_month)
# Prices: public catalog https://eu.api.ovh.com/v1/order/catalog/public/cloud?ovhSubsidiary=$OVH_SUBSIDIARY (FR)
# (cached 24 h in runs/catalog-prices.json; prices there are in 1e-8 EUR). --summary prints one line.
set -euo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ "$TARGET" == ovh ]] || { echo "cost: target ovh only (an ssh server costs whatever your provider bills)"; exit 0; }
# shellcheck source=ovh.sh
source "$INFRA_DIR/ovh.sh"
SUMMARY=no; [[ "${1:-}" == --summary ]] && SUMMARY=yes
VAT="${VAT:-1.2}"
STORAGE_GB_MONTH="$STORAGE_PRICE"
PRICES="$RUNS_DIR/catalog-prices.json"
want="$(printf '%s\n' "$WEB_FLAVOR" "$LOADGEN_FLAVOR" snapshot | jq -R . | jq -sc .)"
if [[ ! -s "$PRICES" || $(( $(date +%s) - $(stat -c %Y "$PRICES") )) -gt 86400 ]] || ! jq -e --argjson w "$want" 'all($w[]; . as $k | has($k))' "$PRICES" >/dev/null 2>&1; then
  tmp="$(mktemp)"
  if curl -fsS --max-time 30 "https://eu.api.ovh.com/v1/order/catalog/public/cloud?ovhSubsidiary=${OVH_SUBSIDIARY:-FR}" -o "$tmp"; then
    jq -c --argjson w "$want" '[.addons[] | select(.planCode | endswith(".consumption")) | select((.planCode | sub("\\.consumption$"; "")) as $k | $w | index($k))
            | {key: (.planCode | sub("\\.consumption$"; "")), value: (.pricings[0].price / 1e8)}] | from_entries' "$tmp" > "$PRICES.new" \
      && mv "$PRICES.new" "$PRICES"
  fi
  rm -f "$tmp"
fi
price() { jq -r --arg k "$1" --arg d "$2" '.[$k] // ($d|tonumber)' "$PRICES" 2>/dev/null || echo "$2"; }
P_WEB="$(price "$WEB_FLAVOR" 0)"; P_LG="$(price "$LOADGEN_FLAVOR" 0)"; P_SNAP_GIBH="$(price snapshot 0.000015)"
declare -A HOURLY=(["$WEB_FLAVOR"]="$P_WEB" ["$LOADGEN_FLAVOR"]="$P_LG")

# ---- instances
declare -A NAME=() FLV=() CREATED=()
if [[ -f "$RUNS_DIR/instances.tsv" ]]; then
  while IFS=$'\t' read -r created name id flavor _img _cap _region; do
    [[ -n "$id" ]] || continue; NAME[$id]=$name; FLV[$id]=$flavor; CREATED[$id]=$created
  done < "$RUNS_DIR/instances.tsv"
fi
live="$(prefix_instances)"
while IFS=$'\t' read -r id name created; do
  [[ -n "$id" ]] || continue; NAME[$id]=$name; CREATED[$id]="${CREATED[$id]:-$created}"
  if [[ -z "${FLV[$id]:-}" ]]; then if [[ "$name" == "$LOADGEN_NAME" ]]; then FLV[$id]="$LOADGEN_FLAVOR"; else FLV[$id]="$WEB_FLAVOR"; fi; fi
done < <(jq -r '.[] | [.id, .name, .created] | @tsv' <<<"$live")
ids="$( (( ${#NAME[@]} )) && printf '%s\n' "${!NAME[@]}" | jq -R . | jq -sc . || echo '[]')"
usage="$(ovh_get "$P/usage/current")" || usage='{}'
api_total="$(jq --argjson ids "$ids" '[.hourlyUsage.instance[]?.details[]? | select(.instanceId as $i | $ids | index($i)) | .totalPrice] | add // 0' <<<"$usage")"
est_total=0
est_lines=()
for id in "${!NAME[@]}"; do
  c=$(iso_to_epoch "${CREATED[$id]}"); now=$(date +%s); end=$now
  alive="$(jq -r --arg i "$id" 'any(.[]; .id==$i)' <<<"$live")"
  if [[ "$alive" != true ]]; then
    d="$(awk -v i="$id" '$1==i {print $3}' "$RUNS_DIR/deleted.tsv" 2>/dev/null | head -1)"; end="${d:-$now}"
  fi
  p="${HOURLY[${FLV[$id]}]:-0}"
  line="$(awk -v n="${NAME[$id]}" -v f="${FLV[$id]}" -v s=$(( end - c )) -v p="$p" -v a="$alive" -v v="$VAT" \
          'BEGIN{h=s/3600; printf "  %-14s %-5s %6.1f min %-7s x %.4f EUR/h = %.4f EUR excl. / %.4f incl. VAT", n, f, s/60, (a=="true"?"alive":"deleted"), p, h*p, h*p*v}')"
  est_lines+=("$line")
  est_total="$(awk -v t="$est_total" -v s=$(( end - c )) -v p="$p" 'BEGIN{printf "%.6f", t + s/3600*p}')"
done

# ---- idle storage
snaps="$(park_snapshots)"
snap_gb="$(jq '[.[].size] | add // 0' <<<"$snaps")"
B="$(bucket_name || true)"; b_bytes=0
if [[ -n "$B" && "$B" == "$TUBE_PREFIX"* ]]; then
  b_bytes="$("$INFRA_DIR/bucket.sh" du 2>/dev/null | sed -n 's/.*Total size:.*(\([0-9]*\) Byte.*/\1/p' | head -1)"; b_bytes="${b_bytes:-0}"
fi
read -r snap_m bucket_m idle_m < <(awk -v g="$snap_gb" -v p="$P_SNAP_GIBH" -v b="$b_bytes" -v s="$STORAGE_GB_MONTH" \
  'BEGIN{sm=g*p*730; bm=b/1e9*s; printf "%.4f %.4f %.4f\n", sm, bm, sm+bm}')

if [[ "$SUMMARY" == yes ]]; then
  awk -v e="$est_total" -v a="$api_total" -v i="$idle_m" -v v="$VAT" \
    'BEGIN{printf "cost: instances ~%.3f EUR excl. (%.3f incl. VAT; usage API %.3f), idle %.3f EUR/month excl. (%.3f incl.)\n", e, e*v, a, i, i*v}'
  exit 0
fi
echo "== $TUBE_PREFIX* instances (catalog: $WEB_FLAVOR $P_WEB, $LOADGEN_FLAVOR $P_LG EUR/h excl. VAT)"
if (( ${#est_lines[@]} )); then printf '%s\n' "${est_lines[@]}"; else echo "  none recorded"; fi
awk -v v="$VAT" -v e="$est_total" 'BEGIN{printf "  estimate total: %.4f EUR excl. VAT, %.4f incl. VAT\n", e, e*v}'
echo "  usage API ($(jq -r '.period.from // "?"' <<<"$usage") -> now, last update $(jq -r '.lastUpdate // "?"' <<<"$usage")): $(awk -v v="$VAT" -v a="$api_total" 'BEGIN{printf "%.4f EUR excl., %.4f incl. VAT", a, a*v}')"
echo "== idle storage per month (snapshot $P_SNAP_GIBH EUR/GiB*h = $(awk -v p="$P_SNAP_GIBH" 'BEGIN{printf "%.4f", p*730}') EUR/GiB/month; storage-standard $STORAGE_GB_MONTH EUR/GB/month)"
jq -r '.[] | "  snapshot \(.name)  \(.size*100|round/100) GiB  \(.status)"' <<<"$snaps"
[[ -n "$B" && "$B" == "$TUBE_PREFIX"* ]] && awk -v n="$B" -v b="$b_bytes" 'BEGIN{printf "  bucket %s  %.3f GB\n", n, b/1e9}'
awk -v v="$VAT" -v sm="$snap_m" -v bm="$bucket_m" -v t="$idle_m" \
  'BEGIN{printf "  snapshots %.4f + bucket %.4f = %.4f EUR/month excl. VAT, %.4f incl. VAT\n", sm, bm, t, t*v}'
awk -v v="$VAT" -v e="$est_total" -v t="$idle_m" 'BEGIN{printf "== TOTAL so far %.4f EUR excl. / %.4f incl. VAT; then idle %.4f / %.4f EUR per month\n", e, e*v, t, t*v}'
