// JuicyAds (adult; self-serve). "JuicyAds v3.0" banner/native tag + PopUnders v3.
//   slot zone = adzone id (digits); size = the dashboard's data-width x data-height (often the creative height plus a
//   label strip: 728x102, 300x262, 468x72, 300x112: set "size" on the slot to the dashboard values).
//   popunder slot zone = the opaque "c" token of the PopUnders code (not the zone id).
// JuicyAds' terms forbid editing the ad code: the preset reproduces it; if yours differs use a custom slot.
// No VAST endpoint (In-Video is an iframe overlay). No ads.txt line documented.
import { esc, jsId } from './_util.js';

export default {
  id: 'juicyads',
  name: 'JuicyAds',
  audiences: ['adult'],
  signup: 'https://manage.juicyads.com/signup.php',
  verified: true,
  verify: {
    url: 'https://help.juicyads.com',
    date: '2026-10-30',
    note: 'v3.0 tag and PopUnders v3 from help.juicyads.com + live embeds; terms: help article 115000346328 (no code edits).',
  },
  fields: { verification: { label: 'juicyads-site-verification meta content (optional)', pattern: '^[A-Za-z0-9]{0,64}$' } },
  zone: { label: 'Adzone id (popunder: the c= token)', pattern: '^[A-Za-z0-9_-]{3,64}$' },
  formats: ['banner', 'native', 'sticky', 'popunder'],
  head: net => [
    net.verification ? `<meta name="juicyads-site-verification" content="${esc(jsId(net.verification))}">` : '',
    '<script type="text/javascript" data-cfasync="false" async src="https://poweredby.jads.co/js/jads.js"></script>',
  ].filter(Boolean).join('\n'),
  render(format, slot, net, ctx) {
    const z = jsId(slot.zone);
    if (!z) return '';
    if (format === 'popunder') {
      return `<!-- JuicyAds PopUnders v3 Start -->
<script type="text/javascript" src="https://js.juicyads.com/jp.php?c=${esc(z)}&u=http%3A%2F%2Fwww.juicyads.rocks"></script>
<!-- JuicyAds PopUnders v3 End -->`;
    }
    if (!/^[0-9]+$/.test(z)) return '';
    return `<ins id="${z}" data-width="${ctx.w || 300}" data-height="${ctx.h || 250}"></ins>
<script type="text/javascript" data-cfasync="false" async>(adsbyjuicy = window.adsbyjuicy || []).push({'adzone':${z}});</script>`;
  },
  csp: { script: ['https://poweredby.jads.co', 'https://js.juicyads.com', 'https://adserver.juicyads.com'], frame: ['https:'], img: ['https:'], connect: ['https:'] },
  adsTxt: () => [],
};
