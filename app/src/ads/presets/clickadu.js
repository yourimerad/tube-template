// Clickadu (explicit or mainstream feed per zone; self-serve). Code text is shown only as images/videos in the help
// center: verified false. Attribute-only forms seen live:
//   banner / inpage_push: loader <script src="//<host>/bn.js"> once + <div data-cl-spot="<spot id>">
//   popunder:             <script data-clocid="<zone id>" src="//<host>/on.js">
//   "ads.networks.clickadu": { "bn_host": "<host of bn.js>", "on_host": "<host of on.js>" }  (random per account)
// Pre-roll: paste the VAST 3.0 link into the preroll slot "vast_url". Anti-adblock code: custom slot +
// ads.csp_unsafe_inline.
import { esc, jsId } from './_util.js';

const HOST = '^[A-Za-z0-9.-]+\\.[a-z]{2,}$';
export default {
  id: 'clickadu',
  name: 'Clickadu',
  audiences: ['general', 'adult'],
  signup: 'https://pub.clickadu.com/auth/signUp',
  verified: false,
  verify: {
    url: 'https://faq.clickadu.com/en/articles/9497443',
    date: '2026-10-30',
    note: 'Formats from faq.clickadu.com (9506353, 9497515, 9497908, 9497443); tag shapes from live embeds only. Clickadu asks '
      + 'for the code "exactly as displayed": if yours differs, use a custom slot.',
  },
  fields: { bn_host: { label: 'Host of bn.js (banner / in-page)', pattern: HOST }, on_host: { label: 'Host of on.js (popunder)', pattern: HOST } },
  zone: { label: 'Spot / zone id', pattern: '^[0-9]{4,12}$' },
  formats: ['banner', 'inpage_push', 'popunder', 'vast'],
  head: net => (net.bn_host ? `<script data-cfasync="false" async type="text/javascript" src="https://${esc(jsId(net.bn_host))}/bn.js"></script>` : ''),
  render(format, slot, net) {
    const z = jsId(slot.zone);
    if (!/^[0-9]{4,12}$/.test(z)) return '';
    if (format === 'popunder') return net.on_host ? `<script async data-cfasync="false" data-clocid="${z}" src="https://${esc(jsId(net.on_host))}/on.js"></script>` : '';
    return net.bn_host ? `<div data-cl-spot="${z}"></div>` : '';
  },
  vast: slot => slot.vast_url || '',
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'], media: ['https:'] },
  adsTxt: () => [],
};
