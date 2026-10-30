// Ads engine core: config (normalize.js) + presets -> the exact tags of each slot, the per-page loaders,
// the pre-roll VAST URL. Pure (no app imports): views/ads.js wraps it with labels and layout, the CLI
// (./tube ads check) uses it to print what a page will contain.
import { PRESETS } from './presets/index.js';
import { slotNetwork } from './normalize.js';

const DISPLAY = ['leaderboard', 'sidebar', 'inline_mobile', 'native', 'sticky', 'footer'];
export const BEHAVIOURS = ['popunder', 'interstitial', 'inpage_push'];

// Format the preset will actually render for a slot format (sticky/native fall back to a banner).
export function pickFormat(preset, format) {
  if (preset.formats.includes(format)) return format;
  if (format === 'sticky' || format === 'native') return preset.formats.includes('banner') ? 'banner' : null;
  return null;
}

const netOf = (ads, id) => (ads.networks && ads.networks[id]) || {};

// -> null | { network, format, variants: [{ media: 'all'|'desk'|'mob', html }] }
// base = { audience, simOrigin }
export function slotMarkup(ads, name, base) {
  const slot = ads.slots[name];
  const id = slotNetwork(ads, slot);
  const p = id && PRESETS[id];
  if (!p || slot.format === 'vast' || slot.format === 'links') return null;
  const format = pickFormat(p, slot.format);
  if (!format) return null;
  const net = netOf(ads, id);
  const mk = (mobile, zone, size) => {
    const [w, h] = (size || '').split('x').map(Number);
    return String(p.render(format, { ...slot, zone, size }, net, { ...base, slot: name, size, w: w || 0, h: h || 0, mobile }) || '');
  };
  // simads handles desktop/mobile itself (data-mobile-size); networks need one zone per size.
  const twoZones = id !== 'simads' && (slot.mobile_zone || (id === 'custom' && slot.mobile_html));
  const variants = twoZones
    ? [{ media: 'desk', html: mk(false, slot.zone, slot.size) }, { media: 'mob', html: mk(true, slot.mobile_zone || slot.zone, slot.mobile_size || slot.size) }]
    : [{ media: 'all', html: mk(false, slot.zone, slot.size) }];
  return { network: id, format, variants: variants.filter(v => v.html) };
}

// Networks used by the enabled display/behaviour slots of the current mode.
export function usedNetworks(ads) {
  const ids = new Set();
  for (const n of [...DISPLAY, ...BEHAVIOURS]) {
    const id = slotNetwork(ads, ads.slots[n]);
    if (id && PRESETS[id]) ids.add(id);
  }
  return [...ids];
}

// Loaders: once per page, <head> and before </body>.
// cmp: consent-management scripts a network ships itself (Ezoic): emitted first, never held back by consent.
export function pageAssets(ads, base) {
  const head = [], bodyEnd = [], cmp = [];
  for (const id of usedNetworks(ads)) {
    const p = PRESETS[id], net = netOf(ads, id);
    if (p.cmpHead) cmp.push(p.cmpHead(net, base));
    if (p.head) { const h = p.head(net, base); if (h) head.push(h); }
    if (p.bodyEnd) { const b = p.bodyEnd(net, base); if (b) bodyEnd.push(b); }
  }
  return { head, bodyEnd, cmp };
}

// Pre-roll source: { kind: 'vast', url, network } | { kind: 'house' } | null
export function preroll(ads, base) {
  const slot = ads.slots.preroll;
  if (!slot.on || ads.mode === 'off') return null;
  const id = slotNetwork(ads, slot);
  const p = id && PRESETS[id];
  if (p && p.vast && (p.formats.includes('vast'))) {
    const url = p.vast(slot, netOf(ads, id), base);
    if (url) return { kind: 'vast', url, network: id };
  }
  return ads.house_preroll ? { kind: 'house' } : null;
}

// Everything a page can contain (for ./tube ads check and the CSP hashes of the CLI view).
export function allMarkup(ads, base) {
  const parts = [];
  const { head, bodyEnd, cmp } = pageAssets(ads, base);
  parts.push(...cmp, ...head, ...bodyEnd);
  for (const n of [...DISPLAY, ...BEHAVIOURS]) {
    const m = slotMarkup(ads, n, base);
    if (m) parts.push(...m.variants.map(v => v.html));
  }
  return parts.join('\n');
}

// Consent: make every <script> of an ad snippet inert until the visitor accepts
// (type="text/plain" data-consent="ads"; static/js/ads.js re-creates them as real scripts).
export function inertScripts(markup) {
  return String(markup).replace(/<script\b([^>]*)>/gi, (m, attrs) => {
    if (/\bdata-consent\s*=/.test(attrs)) return m;
    const t = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const type = t ? (t[2] ?? t[3] ?? t[4] ?? '') : '';
    if (/json/i.test(type)) return m;
    const rest = t ? attrs.replace(t[0], '') : attrs;
    return `<script type="text/plain" data-consent="ads"${type ? ` data-type="${type}"` : ''}${rest}>`;
  });
}
