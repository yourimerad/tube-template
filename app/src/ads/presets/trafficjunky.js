// TrafficJunky: NO self-serve publisher program. trafficjunky.com is advertiser-facing ("start advertising across our
// premium network of sites ... Pornhub and our premium network"), no publisher sign-up or docs were found, and its
// publisher tags (adsbytrafficjunky / popsByTrafficJunky) appear only on Aylo's own sites. Kept as an id so a config
// naming it fails validation with this explanation.
export default {
  id: 'trafficjunky',
  name: 'TrafficJunky (no self-serve publisher program)',
  audiences: ['adult'],
  closed: 'TrafficJunky has no self-serve publisher program (advertiser-only, inventory = Aylo sites): see https://www.trafficjunky.com/resources/faq',
  signup: '',
  verified: true,
  verify: { url: 'https://www.trafficjunky.com/resources/faq', date: '2026-10-30', note: 'Advertiser-only; no publisher sign-up found.' },
  fields: {},
  zone: null,
  formats: [],
  render: () => '',
  csp: {},
  adsTxt: () => [],
};
