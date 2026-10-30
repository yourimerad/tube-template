#!/usr/bin/env bash
# Run app/test/e2e-ads.mjs scenarios against the local dev stack of a (PRIVATE, throwaway) site config: for each
# scenario it writes <config dir>/.ads-scenario.json (the config + the scenario's audience / age_gate / ads),
# restarts the dev stack with it, runs the test, and finally restarts the stack with the original config.
#   TUBE_CONFIG=/path/site.config.json app/test/ads-scenarios.sh [placeholder] [live] [adult-click] [adult-sim]
# No third-party request ever leaves the browser: the live scenario intercepts every one of them (page.route).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
BASE_CFG=${TUBE_CONFIG:?set TUBE_CONFIG to the site.config.json of a private test site}
DIR=$(cd "$(dirname "$BASE_CFG")" && pwd)
SCEN_CFG="$DIR/.ads-scenario.json"
scenarios=("${@:-placeholder live adult-click adult-sim}")
read -r -a scenarios <<<"${scenarios[*]}"

write_cfg() { # scenario -> $SCEN_CFG
  node --input-type=module - "$REPO" "$BASE_CFG" "$SCEN_CFG" "$1" <<'EOF'
import fs from 'node:fs';
const [repo, src, dst, scen] = process.argv.slice(2);
const { readRaw } = await import(`${repo}/lib/config.mjs`);
const c = readRaw(src);
if (c.private === false) { console.error('ads-scenarios: refusing a public site config'); process.exit(2); }
const live = {
  mode: 'live',
  consent: { mode: 'auto', region: 'eu', us_optout: true },
  networks: { exoclick: {}, adsterra: { banner_host: 'www.highperformanceformat.com' } },
  slots: {
    leaderboard: { network: 'exoclick', zone: '1234567', mobile_zone: '7654321' },
    sidebar: { network: 'adsterra', zone: '0123456789abcdef0123456789abcdef' },
    footer: { network: 'custom', html: '<div class="cust-ad">custom</div><script>window.__custom = 1;</script><script async src="https://cdn.custom.example/tag.js"></script>', csp: ['https://cdn.custom.example'] },
    preroll: { network: 'exoclick', zone: '4444444' },
    sticky: false, native: false, inline_mobile: false, popunder: false, interstitial: false, inpage_push: false,
  },
  sponsored_links: [{ label: 'Partner', url: 'https://partner.example/' }],
  ads_txt: ['custom.example, 42, DIRECT'],
};
const over = {
  placeholder: { audience: 'general', ads: { mode: 'placeholder' } },
  live: { audience: 'general', ads: live },
  'adult-click': { audience: 'adult', age_gate: { mode: 'click', geo_rules: { KP: 'block' } }, legal: { synthetic: true, report_email: 'abuse@example.invalid' }, ads: { mode: 'placeholder' } },
  'adult-sim': { audience: 'adult', age_gate: { mode: 'sim' }, legal: { synthetic: true, report_email: 'abuse@example.invalid' }, ads: { mode: 'sim' } },
}[scen];
if (!over) { console.error(`unknown scenario ${scen}`); process.exit(2); }
fs.writeFileSync(dst, JSON.stringify({ ...c, ...over }, null, 2));
EOF
}

rc=0
for s in "${scenarios[@]}"; do
  echo "==== ads scenario: $s"
  write_cfg "$s"
  TUBE_CONFIG="$SCEN_CFG" "$REPO/tube" dev --ads config | tail -3
  TUBE_CONFIG="$SCEN_CFG" E2E_ONLY="e2e-ads.mjs" ADS_SCENARIO="$s" SKIP_CURL=1 "$REPO/tube" test || rc=1
done
echo "==== restoring the dev stack with $BASE_CFG"
rm -f "$SCEN_CFG"
TUBE_CONFIG="$BASE_CFG" "$REPO/tube" dev --ads config | tail -2
exit "$rc"
