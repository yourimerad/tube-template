// ExoClick (adult and mainstream; self-serve). One async loader for every display zone, an <ins> per zone whose
// CSS class depends on the ZONE TYPE (copy it from your dashboard if it differs: "ins_classes" below).
//   "ads.networks.exoclick": { "ins_classes": { "banner": "eas6a97888e2" }, "verification": "<meta content>" }
//   slot zone = zone id (digits); mobile_zone for the mobile size (ExoClick zones are per size).
// Popunder: the "remote" variant (static config script + popunder1000.js), hashable for the CSP; the inline
// popMagic variant changes per zone/version (use a custom slot + ads.csp_unsafe_inline if you need it).
// Pre-roll: VAST https://s.magsrv.com/v1/vast.php?idzone=<zone>.
// ads.txt: ExoClick documents none.
import { esc, jsId } from './_util.js';

const CLASSES = { banner: 'eas6a97888e2', banner_mobile: 'eas6a97888e10', sticky: 'eas6a97888e17', native: 'eas6a97888e20',
  interstitial: 'eas6a97888e35', interstitial_mobile: 'eas6a97888e33', inpage_push: 'eas6a97888e31' };
const zoneOk = z => /^[0-9]{4,12}$/.test(z || '');
export default {
  id: 'exoclick',
  name: 'ExoClick',
  audiences: ['adult', 'general'],
  signup: 'https://admin.exoclick.com/signup',
  verified: true,
  unverifiedFormats: ['inpage_push'],
  verify: {
    url: 'https://docs.exoclick.com',
    date: '2026-10-30',
    note: 'Async tag, iframe, remote popunder and VAST URL from docs.exoclick.com (.md pages / llms-full.txt) and live embeds. '
      + 'ins classes: banner desktop/native/interstitial from docs + embeds; mobile banner and sticky seen live; in-page push class '
      + 'unconfirmed: paste your dashboard snippet in a custom slot if it differs.',
  },
  fields: {
    ins_classes: { label: 'Override the <ins> class per format ({"banner": "...", "banner_mobile": "...", ...})', type: 'object' },
    verification: { label: 'exoclick-site-verification meta content (optional)', pattern: '^[A-Za-z0-9]{0,64}$' },
  },
  zone: { label: 'Zone id', pattern: '^[0-9]{4,12}$' },
  formats: ['banner', 'native', 'sticky', 'popunder', 'interstitial', 'inpage_push', 'vast'],
  head: net => [
    net.verification ? `<meta name="exoclick-site-verification" content="${esc(jsId(net.verification))}">` : '',
    '<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>',
  ].filter(Boolean).join('\n'),
  render(format, slot, net, ctx) {
    if (!zoneOk(slot.zone)) return '';
    if (format === 'popunder') {
      return `<script type="application/javascript">
    var ad_idzone = "${slot.zone}",
    ad_popup_fallback = false,
    ad_popup_force = false,
    ad_chrome_enabled = true,
    ad_new_tab = false,
    ad_frequency_period = 1,
    ad_frequency_count = 1,
    ad_trigger_method = 3,
    ad_trigger_delay = 0,
    ad_capping_enabled = true; 
</script>
<script type="application/javascript" src="https://a.pemsrv.com/popunder1000.js"></script>`;
    }
    const cls = { ...CLASSES, ...(net.ins_classes || {}) };
    const key = ctx.mobile && cls[`${format}_mobile`] ? `${format}_mobile` : format;
    return `<ins class="${esc(jsId(cls[key] || cls.banner))}" data-zoneid="${slot.zone}"></ins>
<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script>`;
  },
  vast: slot => (zoneOk(slot.zone) ? `https://s.magsrv.com/v1/vast.php?t=[CACHEBUSTING]&idzone=${slot.zone}` : ''),
  csp: {
    script: ['https://a.magsrv.com', 'https://a.pemsrv.com', 'https:'], frame: ['https:'], img: ['https:'],
    connect: ['https://s.magsrv.com', 'https:'], media: ['https:'],
  },
  adsTxt: () => [],
};
