// "vast": a plain VAST tag URL for the pre-roll, from any ad server (old form "ads.vast_url" maps here).
//   "ads.slots.preroll": { "vast_url": "https://ads.example.com/vast?zone=1&cb=[CACHEBUSTING]&url=[PAGEURL]" }
// Macros filled by the player (ads-vast.js): [CACHEBUSTING] [TIMESTAMP] [PAGEURL] [DOMAIN] [REFERRER]
// [WIDTH] [HEIGHT] [UA]. The tag origin goes to connect-src; creatives are allowed by media-src https:.
export default {
  id: 'vast',
  name: 'Any VAST tag (pre-roll)',
  audiences: ['adult', 'general'],
  signup: '',
  verified: true,
  verify: { url: 'https://iabtechlab.com/standards/vast/', date: '2026-10-30', note: 'IAB VAST 2.0-4.3; macros per VAST 4.x section 6.' },
  fields: {},
  zone: null,
  formats: ['vast'],
  render: () => '',
  vast: slot => slot.vast_url,
  csp: {},
  adsTxt: () => [],
};
