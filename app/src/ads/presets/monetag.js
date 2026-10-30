// Monetag (ex PropellerAds). GENERAL audience only: "Erotic and pornographic content ... strictly prohibited".
//   "ads.networks.monetag": { "domain": "<tag domain shown in your code>", "verify_meta": "<hash>" }
//   slot zone = the zone id (digits). popunder = OnClick, inpage_push = In-Page Push, interstitial = Vignette.
// Monetag regenerates its tag text and rotates domains: the snippets below follow the current "pretty tag" loader;
// if your dashboard code differs, paste it into the slot with "network": "custom" (verified: false).
// Push notifications / MultiTag need a sw.js at the site root: not supported by this template.
import { esc, jsId } from './_util.js';

export default {
  id: 'monetag',
  name: 'Monetag',
  audiences: ['general'],
  signup: 'https://monetag.com/',
  verified: false,
  verify: {
    url: 'https://help.monetag.com/en/articles/6726318',
    date: '2026-10-30',
    note: 'Formats and placement (head, as high as possible) from help 6726318 / 6726670; adult ban: 6726292. Exact tag text '
      + 'from public embeds (medium confidence, changes often): compare with your dashboard, else use a custom slot.',
  },
  fields: {
    domain: { label: 'Tag domain from your Monetag code', pattern: '^[A-Za-z0-9.-]+\\.[a-z]{2,}$', required: true },
    verify_meta: { label: 'Site verification meta content (optional)', pattern: '^[A-Za-z0-9]{0,64}$' },
  },
  zone: { label: 'Zone id', pattern: '^[0-9]{4,12}$' },
  formats: ['popunder', 'inpage_push', 'interstitial'],
  head: net => (net.verify_meta ? `<meta name="monetag" content="${esc(jsId(net.verify_meta))}">` : ''),
  render(format, slot, net) {
    if (!/^[0-9]{4,12}$/.test(slot.zone || '') || !net.domain) return '';
    const file = format === 'interstitial' ? 'vignette.min.js' : 'tag.min.js';
    return `<script>(function(s){s.dataset.zone='${slot.zone}',s.src='https://${jsId(net.domain)}/${file}'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>`;
  },
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'], worker: ['blob:'] },
  adsTxt: () => [],
};
