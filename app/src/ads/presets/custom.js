// "custom": any network without a preset. The owner pastes the dashboard snippet per slot:
//   "ads.slots.leaderboard": { "network": "custom", "html": "<ins ...></ins><script ...></script>",
//                              "mobile_html": "...", "csp": ["https://cdn.network.example"] }
//   "ads.networks.custom": { "head_html": "<script async src=...></script>", "body_html": "...",
//                            "csp": ["https://..."], "ads_txt": ["network.example, 123, DIRECT"] }
// Pre-roll: "ads.slots.preroll": { "network": "custom", "vast_url": "https://..." }.
// Inline scripts in the pasted HTML are hashed into the CSP automatically (they must be static).
// Origins listed in "csp" go to script-src, frame-src, img-src and connect-src.
export default {
  id: 'custom',
  name: 'Custom (paste your network snippet)',
  audiences: ['adult', 'general'],
  signup: '',
  verified: true,
  verify: { url: '', date: '2026-10-30', note: 'Raw HTML pasted by the owner: rendered verbatim (scripts made inert until consent).' },
  fields: {},
  zone: null,
  formats: ['banner', 'native', 'sticky', 'popunder', 'interstitial', 'inpage_push', 'vast'],
  head: net => net.head_html || '',
  bodyEnd: net => net.body_html || '',
  render: (format, slot, net, ctx) => (ctx.mobile && slot.mobile_html ? slot.mobile_html : slot.html),
  vast: slot => slot.vast_url,
  csp: {},
  extraOrigins: (net, slot) => [...(Array.isArray(net.csp) ? net.csp : []), ...(slot?.csp || [])],
  adsTxt: net => (Array.isArray(net.ads_txt) ? net.ads_txt : []),
};
