// Google Ad Manager: GPT display tags + VAST pre-roll (general audience only).
//   "ads.networks.gam": { "network_code": "1234567" }
//   slot zone = ad unit path below the network code (e.g. "site/leaderboard").
// Display uses GPT's single-container form (defineSlot + enableServices + display in one inline script per slot).
// Pre-roll: the documented VAST ad tag (answer 10678356) with correlator/url/description_url filled by
// static/js/ads-vast.js. LIMITS of a non-IMA player (documented by Google): you set correlator yourself (done),
// no Active View without OM SDK, ad badging needs VAST Icon support (not implemented), Ad Exchange video demand
// expects the IMA SDK ("a direct IMA SDK integration is always preferable", answer 6259629) and AdSense for video
// (legacy) ended 2026-05-31: expect direct-sold / reservation line items to fill, Google programmatic in-stream
// mostly NOT through this VAST-only player.
import { esc, jsId } from './_util.js';

const unit = (net, slot) => `/${jsId(net.network_code)}/${String(slot.zone || '').replace(/[^A-Za-z0-9_./-]/g, '')}`;
export default {
  id: 'gam',
  name: 'Google Ad Manager (GPT + VAST)',
  google: true,
  audiences: ['general'],
  signup: 'https://admanager.google.com/',
  verified: true,
  verify: {
    url: 'https://developers.google.com/publisher-tag/guides/get-started',
    date: '2026-10-30',
    note: 'GPT tag: developers.google.com/publisher-tag get-started + support answer 1638622; VAST parameters: answer 10678356; '
      + 'IMA adapter / non-IMA players: 6259629; GPT CSP (strict nonce only): developers.google.com/publisher-tag/guides/content-security-policy. '
      + 'Ad Manager needs a linked AdSense account; small sites may need a Google representative.',
  },
  fields: { network_code: { label: 'Network code', pattern: '^[0-9]{3,14}$', required: true } },
  zone: { label: 'Ad unit path (below the network code)', pattern: '^[A-Za-z0-9_./-]{1,100}$' },
  formats: ['banner', 'native', 'vast'],
  head: () => '<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>',
  render(format, slot, net, ctx) {
    if (!slot.zone) return '';
    const id = `div-gpt-ad-${jsId(ctx.slot)}${ctx.mobile ? '-m' : ''}`;
    const size = ctx.w && ctx.h ? `[${ctx.w}, ${ctx.h}]` : "'fluid'";
    const style = ctx.w && ctx.h ? ` style="min-width: ${ctx.w}px; min-height: ${ctx.h}px;"` : '';
    return `<div id="${id}"${style}>
  <script>
    window.googletag = window.googletag || {cmd: []};
    googletag.cmd.push(function() {
      googletag.defineSlot('${esc(unit(net, slot))}', ${size}, '${id}').addService(googletag.pubads());
      googletag.enableServices();
      googletag.display('${id}');
    });
  </script>
</div>`;
  },
  vast: (slot, net) => (slot.zone && net.network_code
    ? `https://pubads.g.doubleclick.net/gampad/ads?iu=${encodeURIComponent(unit(net, slot))}&sz=640x480&gdfp_req=1&output=vast&env=vp&unviewed_position_start=1&url=[PAGEURL]&description_url=[PAGEURL]&correlator=[CACHEBUSTING]`
    : ''),
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'] },
  unsafeEval: true,
  tcf: true,
  adsTxt: net => (net.publisher_id ? [`google.com, ${jsId(net.publisher_id).replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`] : []),
};
