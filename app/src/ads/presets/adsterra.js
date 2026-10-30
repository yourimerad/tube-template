// Adsterra. ADULT SITES: unclear. The help center offers an "Adult ads" toggle, but the managed publisher terms list
// "pornography, of any kind, adult or mature content" as grounds to refuse a site: ask Adsterra support first.
//   "ads.networks.adsterra": { "banner_host": "www.highperformanceformat.com" }   (host shown in YOUR banner code)
//   banner / sticky slot: zone = the banner key (32 hex); the tag sets atOptions then loads <host>/<key>/invoke.js
//   native slot: zone = the full script URL of the Native Banner code (https://.../<hash>/invoke.js)
//   popunder / inpage_push (Social Bar) slot: zone = the full script URL of that code (https://.../xx/yy/zz/<hash>.js)
// Tag hosts differ per account and the scripts load further rotating domains: the CSP allows https: for
// script/frame/img/connect. No VAST. ads.txt: Adsterra provides none ("advertisers do not require them").
import { esc, jsId } from './_util.js';

const URL_RE = '^https://[A-Za-z0-9.-]+/[A-Za-z0-9/._-]+\\.js$';
const isUrl = z => new RegExp(URL_RE).test(z || '');
export default {
  id: 'adsterra',
  name: 'Adsterra',
  audiences: ['general', 'adult'],
  signup: 'https://beta.publishers.adsterra.com/signup/',
  verified: true,
  verify: {
    url: 'https://help-publishers.adsterra.com/en/articles/5210780',
    date: '2026-10-30',
    note: 'Placement (popunder before </head>, Social Bar before </body>) from help 5210780; snippet shapes from several public '
      + 'embeds. Adult sites: contradictory (help 5056373 vs adsterra.com/publishers-terms-managed/), ask support. The host in YOUR code (highperformanceformat.com, effectivegatecpm.com, ...) is per account: copy the URL as is.',
  },
  fields: { banner_host: { label: 'Host of your banner code (default www.highperformanceformat.com)', pattern: '^([A-Za-z0-9.-]+)?$' } },
  zone: { label: 'Banner key, or the full https script URL of the code', pattern: `^([0-9a-f]{32}|${URL_RE.slice(1, -1)})$` },
  formats: ['banner', 'native', 'popunder', 'inpage_push'],
  render(format, slot, net, ctx) {
    const z = slot.zone || '';
    if (format === 'banner') {
      if (!/^[0-9a-f]{32}$/.test(z) || !ctx.w) return '';
      const host = jsId(net.banner_host) || 'www.highperformanceformat.com';
      return `<script>
  atOptions = {
    'key' : '${z}',
    'format' : 'iframe',
    'height' : ${ctx.h},
    'width' : ${ctx.w},
    'params' : {}
  };
</script>
<script src="https://${esc(host)}/${z}/invoke.js"></script>`;
    }
    if (!isUrl(z)) return '';
    if (format === 'native') {
      const hash = (/\/([0-9a-f]{16,64})\/invoke\.js$/.exec(z) || [])[1] || '';
      return `<script async="async" data-cfasync="false" src="${esc(z)}"></script>\n<div id="container-${hash}"></div>`;
    }
    return `<script src="${esc(z)}"></script>`;
  },
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'] },
  adsTxt: () => [],
};
