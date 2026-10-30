// AdXpansion: CLOSED. adxpansion.com redirects to juicyads.com/adxpansion/: "AdXpansion ended operations and closed on
// Aug 1, 2019 ... AdXpansion is closed permanently" (JuicyAds bought the domain). Kept as an id so a config naming it
// fails validation with this explanation; use "juicyads".
export default {
  id: 'adxpansion',
  name: 'AdXpansion (closed 2019, use JuicyAds)',
  audiences: ['adult'],
  closed: 'AdXpansion closed permanently on 1 Aug 2019 (https://www.juicyads.com/adxpansion/); use "juicyads"',
  signup: '',
  verified: true,
  verify: { url: 'https://www.juicyads.com/adxpansion/', date: '2026-10-30', note: 'Network closed.' },
  fields: {},
  zone: null,
  formats: [],
  render: () => '',
  csp: {},
  adsTxt: () => [],
};
