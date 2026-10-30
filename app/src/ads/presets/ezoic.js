// Ezoic (general audience; ~250k monthly visits needed, smaller sites go to the "Incubator").
//   "ads.networks.ezoic": { "domain": "example.com" }   (ads.txt redirect target)
//   slot zone = placement id (digits, created in the Ezoic dashboard)
// Ezoic ships its own certified TCF 2.3 CMP (gatekeeperconsent): set "ads.consent.mode": "cmp"; the CMP scripts
// are emitted first in <head> and never held back. ads.txt is a 301 to Ezoic's ads.txt manager (docs).
// Ezoic runs Google demand (GPT/AdX): same CSP caveats as Google ('unsafe-eval', https:), and its script injects
// inline scripts at run time (dynamicInline: `./tube ads check` tells you to set ads.csp_unsafe_inline).
import { jsId } from './_util.js';

export default {
  id: 'ezoic',
  name: 'Ezoic',
  google: true,
  audiences: ['general'],
  signup: 'https://pubdash.ezoic.com/',
  verified: true,
  verify: {
    url: 'https://docs.ezoic.com/docs/ezoicads/integration/',
    date: '2026-10-30',
    note: 'Head scripts + placeholder form from docs.ezoic.com integration / implementation / advanced; ads.txt redirect from '
      + 'docs.ezoic.com/docs/ezoicads/adstxt/; CMP from /docs/privacy/gdpr/. CSP hosts are not published by Ezoic.',
  },
  fields: { domain: { label: 'Your domain (for the ads.txt redirect)', pattern: '^[A-Za-z0-9.-]+\\.[a-z]{2,}$' } },
  zone: { label: 'Placement id', pattern: '^[0-9]{1,6}$' },
  formats: ['banner', 'native'],
  cmpHead: () => `<script data-cfasync="false" src="https://cmp.gatekeeperconsent.com/min.js"></script>
<script data-cfasync="false" src="https://the.gatekeeperconsent.com/cmp.min.js"></script>`,
  head: () => `<script async src="//www.ezojs.com/ezoic/sa.min.js"></script>
<script>
    window.ezstandalone = window.ezstandalone || {};
    ezstandalone.cmd = ezstandalone.cmd || [];
</script>
<script src="//ezoicanalytics.com/analytics.js"></script>`,
  render(format, slot) {
    const id = jsId(slot.zone);
    if (!/^[0-9]{1,6}$/.test(id)) return '';
    return `<div id="ezoic-pub-ad-placeholder-${id}"></div>
<script>
    ezstandalone.cmd.push(function () {
        ezstandalone.showAds(${id});
    });
</script>`;
  },
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'], worker: ['blob:'] },
  unsafeEval: true,
  dynamicInline: true,
  tcf: true,
  adsTxtRedirect: (net, host) => `https://srv.adstxtmanager.com/19390/${jsId(net.domain || host)}`,
  adsTxt: () => [],
};
