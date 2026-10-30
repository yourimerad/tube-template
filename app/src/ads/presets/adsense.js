// Google AdSense (general audience only: adult content is not allowed by Google publisher policies).
//   "ads.networks.adsense": { "publisher_id": "ca-pub-1234567890123456", "auto_ads": false }
//   slot zone = the ad unit's data-ad-slot id (digits). Native/sticky slots use the responsive unit.
// Auto ads: set "auto_ads": true and switch Auto ads on in the AdSense dashboard; the head code is the same tag.
// Rules enforced by `./tube validate`: no popunder / interstitial slot with a Google preset, a certified TCF CMP
// (ads.consent.mode "cmp" + cmp_html) for EU/EEA/UK traffic, never with "audience": "adult".
// CSP: Google only supports a nonce-based strict CSP (we serve cached pages without nonces), so the policy allows
// scripts/frames/connections from any https origin plus 'unsafe-eval' (part of Google's own documented policy).
import { esc, jsId } from './_util.js';

const pub = net => { const p = jsId(net.publisher_id); return p.startsWith('ca-') ? p : `ca-${p}`; };
export default {
  id: 'adsense',
  name: 'Google AdSense',
  google: true,
  audiences: ['general'],
  signup: 'https://adsense.google.com/start/',
  verified: true,
  verify: {
    url: 'https://support.google.com/adsense/answer/9190028',
    date: '2026-10-30',
    note: 'Display unit + head code: answers 9274516 / 9190028; responsive unit: 9183460; ads.txt line: 12171612; '
      + 'CSP (strict nonce only, allowlists unsupported): 16283098; certified TCF CMP required in EEA/UK/CH: 13554116. '
      + 'No VAST: AdSense for video (legacy) ended 2026-05-31, video goes through Ad Manager / AdX + IMA SDK.',
  },
  fields: { publisher_id: { label: 'Publisher id (ca-pub-...)', pattern: '^(ca-)?pub-[0-9]{10,20}$', required: true }, auto_ads: { label: 'Auto ads (true/false)', type: 'boolean' } },
  zone: { label: 'Ad unit id (data-ad-slot)', pattern: '^[0-9]{6,12}$' },
  formats: ['banner', 'native'],
  head: net => `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(pub(net))}" crossorigin="anonymous"></script>`,
  render(format, slot, net, ctx) {
    if (!slot.zone) return '';
    const style = format === 'banner' && ctx.w && ctx.h ? `display:inline-block;width:${ctx.w}px;height:${ctx.h}px` : 'display:block';
    const resp = style === 'display:block' ? '\ndata-ad-format="auto"\ndata-full-width-responsive="true"' : '';
    return `<ins class="adsbygoogle"
style="${style}"
data-ad-client="${esc(pub(net))}"
data-ad-slot="${esc(jsId(slot.zone))}"${resp}></ins>
<script>
(adsbygoogle = window.adsbygoogle || []).push({});
</script>`;
  },
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'] },
  unsafeEval: true,
  dynamicInline: false,
  tcf: true,
  adsTxt: net => (net.publisher_id ? [`google.com, ${pub(net).replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`] : []),
};
