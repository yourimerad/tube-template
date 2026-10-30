// Ads config normalizer, shared by the app (src/config.js) and the CLI (lib/config.mjs, lib/ads.mjs).
// Pure: no I/O, no app imports. Input = the "ads" object of site.config.json / site.json (any age:
// boolean slots, ads.vast_url, csp_origins, house_preroll all keep working); output = one shape:
//
//   { mode, slots: { <name>: { on, name, format, network, zone, mobile_zone, size, mobile_size, cap_hours,
//                              every, vast_url, html, mobile_html, csp } },
//     networks, consent: { mode, effective, region, cmp_html, cmp_csp, policy_url },
//     sponsored_links, ads_txt, sim: { origin, audience_rates }, vast_url, house_preroll, native_every,
//     csp_origins, csp_unsafe_inline, csp_unsafe_eval }
export const ADS_MODES = ['off', 'placeholder', 'sim', 'live'];

// Slot name -> ad format + default sizes ([desktop, mobile]). Names are fixed (views place them).
export const SLOTS = {
  leaderboard: { format: 'banner', size: '728x90', mobile_size: '320x50', default: true },
  sidebar: { format: 'banner', size: '300x250', default: true },
  inline_mobile: { format: 'banner', size: '300x250', default: true },
  native: { format: 'native', size: '300x250', default: true },
  sticky: { format: 'sticky', size: '728x90', mobile_size: '320x50', default: true },
  preroll: { format: 'vast', default: true },
  footer: { format: 'banner', size: '900x250', mobile_size: '300x250', default: true },
  popunder: { format: 'popunder', default: false, cap_hours: 24 },
  interstitial: { format: 'interstitial', default: false, cap_hours: 1, every: 3 },
  inpage_push: { format: 'inpage_push', default: false, cap_hours: 1 },
  sponsored_links: { format: 'links', default: true },
};
export const SLOT_NAMES = Object.keys(SLOTS);
export const CONSENT_MODES = ['auto', 'banner', 'cmp', 'none'];

const str = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const posInt = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

export function normalizeSlot(name, value) {
  const def = SLOTS[name];
  const o = value && typeof value === 'object' ? value : {};
  const on = value === undefined ? def.default : typeof value === 'boolean' ? value : o.enabled !== false;
  return {
    name, on, format: def.format,
    network: str(o.network) || (o.vast_url ? 'vast' : o.html ? 'custom' : ''),
    zone: str(o.zone), mobile_zone: str(o.mobile_zone),
    size: str(o.size) || def.size || '', mobile_size: str(o.mobile_size) || def.mobile_size || '',
    cap_hours: posInt(o.cap_hours, def.cap_hours || 0), every: posInt(o.every, def.every || 0),
    vast_url: str(o.vast_url), html: typeof o.html === 'string' ? o.html : '',
    mobile_html: typeof o.mobile_html === 'string' ? o.mobile_html : '',
    csp: Array.isArray(o.csp) ? o.csp.map(str).filter(Boolean) : [],
  };
}

// ctx: { language: 'fr'|'en', modeOverride?: string }
export function normalizeAds(raw = {}, ctx = {}) {
  const a = raw || {};
  const mode = ADS_MODES.includes(ctx.modeOverride) ? ctx.modeOverride : ADS_MODES.includes(a.mode) ? a.mode : 'placeholder';
  const slots = {};
  for (const n of SLOT_NAMES) {
    const s = normalizeSlot(n, a.slots?.[n]);
    if (mode === 'off') s.on = false;
    slots[n] = s;
  }
  // Old form: ads.vast_url feeds the pre-roll when the slot has no own source.
  const vastUrl = str(a.vast_url);
  if (vastUrl && !slots.preroll.vast_url && !slots.preroll.network) { slots.preroll.vast_url = vastUrl; slots.preroll.network = 'vast'; }
  const c = a.consent || {};
  const cmode = CONSENT_MODES.includes(c.mode) ? c.mode : 'auto';
  // region: "eu" (opt-in consent banner, default: cached HTML cannot know the visitor's country, so the banner is
  // shown to EVERY visitor), "us" (no opt-in banner: "Do Not Sell or Share" link + Global Privacy Control), "other".
  const region = ['eu', 'us', 'other'].includes(c.region) ? c.region : 'eu';
  const effective = cmode === 'auto' ? (region === 'us' ? 'none' : 'banner') : cmode;
  return {
    mode, slots,
    networks: a.networks && typeof a.networks === 'object' ? a.networks : {},
    consent: {
      mode: cmode, effective, region,
      cmp_html: typeof c.cmp_html === 'string' ? c.cmp_html : '',
      cmp_csp: Array.isArray(c.cmp_csp) ? c.cmp_csp.map(str).filter(Boolean) : [],
      policy_url: str(c.policy_url),
      // US opt-out link + GPC (CCPA/CPRA): default on for region "us" and for English sites (US visitors likely);
      // shown next to the consent banner too, an opt-out (or GPC) always wins.
      us_optout: c.us_optout === undefined ? region === 'us' || (ctx.language === 'en' && region === 'eu') : c.us_optout === true,
    },
    sponsored_links: (Array.isArray(a.sponsored_links) ? a.sponsored_links : [])
      .filter(l => l && l.label && /^https?:\/\//.test(l.url || '')).map(l => ({ label: str(l.label), url: str(l.url) })),
    ads_txt: (Array.isArray(a.ads_txt) ? a.ads_txt : []).map(str).filter(Boolean),
    sim: { origin: str(a.sim?.origin).replace(/\/+$/, ''), audience_rates: str(a.sim?.audience_rates) || 'auto' },
    vast_url: vastUrl,
    house_preroll: mode !== 'off' && a.house_preroll !== false,
    native_every: Math.max(2, Number(a.native_every) || 8),
    csp_origins: (Array.isArray(a.csp_origins) ? a.csp_origins : []).filter(o => /^https:\/\/[a-z0-9.*-]+(:\d+)?$/i.test(o)),
    csp_unsafe_inline: a.csp_unsafe_inline === true,
    csp_unsafe_eval: a.csp_unsafe_eval === true,
  };
}

// Network a slot is served by in the current mode: null (placeholder / off / plain container).
export function slotNetwork(ads, slot) {
  if (!slot.on) return null;
  if (ads.mode === 'sim') return 'simads';
  if (ads.mode !== 'live') return null;
  return slot.network || null;
}
