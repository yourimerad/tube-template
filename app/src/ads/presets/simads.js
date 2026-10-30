// "simads": the simulated ad network (app/src/simads, served at /simads by the app itself in mode "sim").
// Wire protocol (shared with the SIM plugin, see docs/ARCHITECTURE.md "Ads engine"):
//   loader once per page in <head>: <script async src="{S}/simads/static/loader.js" data-audience="general|adult">
//   every display slot:  <ins class="simads" data-zone="<slot>" data-format="banner|native|popunder|interstitial|
//                         inpage_push|sticky" data-size="728x90" data-mobile-size="320x50" data-cap-hours="24">
//   pre-roll:            {S}/simads/vast?zone=preroll  (VAST 4.2)
// {S} = ads.sim.origin ("" = same origin). In mode "sim" EVERY enabled slot uses this preset, whatever network
// is configured, so the owner rehearses the exact layout without contacting any third party.
import { esc } from './_util.js';

const origin = ctx => ctx.simOrigin || '';
export default {
  id: 'simads',
  name: 'Simulated network (mode "sim", private sites only)',
  audiences: ['adult', 'general'],
  signup: '',
  verified: true,
  verify: { url: '', date: '2026-10-30', note: 'Local simulation, see app/src/simads.' },
  fields: {},
  zone: null,
  formats: ['banner', 'native', 'sticky', 'popunder', 'interstitial', 'inpage_push', 'vast'],
  head: (net, ctx) => `<script async src="${esc(origin(ctx))}/simads/static/loader.js" data-audience="${esc(ctx.audience)}"></script>`,
  render(format, slot, net, ctx) {
    const a = [`class="simads"`, `data-zone="${esc(slot.name)}"`, `data-format="${esc(format)}"`];
    if (slot.size) a.push(`data-size="${esc(slot.size)}"`);
    if (slot.mobile_size) a.push(`data-mobile-size="${esc(slot.mobile_size)}"`);
    if (slot.cap_hours) a.push(`data-cap-hours="${slot.cap_hours}"`);
    if (slot.every) a.push(`data-every="${slot.every}"`);
    return `<ins ${a.join(' ')}></ins>`;
  },
  vast: (slot, net, ctx) => `${origin(ctx || {})}/simads/vast?zone=${encodeURIComponent(slot.name)}`,
  csp: {},
  adsTxt: () => [],
};
