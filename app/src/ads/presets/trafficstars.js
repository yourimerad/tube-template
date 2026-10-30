// TrafficStars (adult; publisher sign-up on trafficstars.com, no public publisher docs: tags from live sites).
//   slot zone = the spot codename (32 characters) of that format.
//   "ads.networks.trafficstars": { "extid": "<optional external id>", "verification": "<site id>" }
// banner/native: "master spot" tag; popunder: attribute-only p.js; interstitial: InterstitialTsAd.
// VAST URL (https://tsyndicate.com/do2/<spot>/vast) seen only in tracker lists: unverified, test before use.
import { esc, jsId } from './_util.js';

const spotOk = z => /^[A-Za-z0-9]{16,40}$/.test(z || '');
export default {
  id: 'trafficstars',
  name: 'TrafficStars',
  audiences: ['adult'],
  signup: 'https://trafficstars.com/publishers',
  verified: true,
  unverifiedFormats: ['vast', 'interstitial'],
  verify: {
    url: 'https://docs.trafficstars.com',
    date: '2026-10-30',
    note: 'Spot codenames from docs.trafficstars.com (API); master spot / p.js / interstitial tags from live embeds (no public '
      + 'publisher tag docs). VAST URL unverified: paste the dashboard VAST link into the preroll slot "vast_url" (network "vast").',
  },
  fields: {
    extid: { label: 'External id for popunder/interstitial (optional)', pattern: '^[A-Za-z0-9_-]{0,64}$' },
    verification: { label: 'Trafficstars meta content (optional)', pattern: '^[A-Za-z0-9]{0,64}$' },
  },
  zone: { label: 'Spot codename', pattern: '^[A-Za-z0-9]{16,40}$' },
  formats: ['banner', 'native', 'sticky', 'popunder', 'interstitial', 'vast'],
  head: net => (net.verification ? `<meta name="Trafficstars" content="${esc(jsId(net.verification))}">` : ''),
  render(format, slot, net, ctx) {
    if (!spotOk(slot.zone)) return '';
    const ext = jsId(net.extid);
    if (format === 'popunder') {
      return `<script type="text/javascript" src="https://cdn.tsyndicate.com/sdk/v1/p.js" data-ts-spot="${slot.zone}"${ext ? ` data-ts-extid="${ext}"` : ''} data-ts-mode="selective" async defer></script>`;
    }
    if (format === 'interstitial') {
      return `<link rel="stylesheet" href="https://cdn.tsyndicate.com/sdk/v1/interstitial.ts.css" />
<script src="https://cdn.tsyndicate.com/sdk/v1/interstitial.ts.js"></script>
<script>InterstitialTsAd({spot:"${slot.zone}", extid:"${ext}", cookieExpires:${(slot.cap_hours || 1) * 3600}});</script>`;
    }
    const id = `ts_ad_${jsId(ctx.slot)}${ctx.mobile ? '_m' : ''}`;
    return `<div id="${id}"></div>
<script src="https://cdn.tsyndicate.com/sdk/v1/master.spot.js"></script>
<script>TsMasterSpot({"containerId":"${id}","spot":"${slot.zone}"});</script>`;
  },
  vast: slot => (spotOk(slot.zone) ? `https://tsyndicate.com/do2/${slot.zone}/vast` : ''),
  csp: { script: ['https://cdn.tsyndicate.com', 'https:'], style: ['https://cdn.tsyndicate.com'], frame: ['https:'], img: ['https:'], connect: ['https:'], media: ['https:'] },
  adsTxt: () => [],
};
