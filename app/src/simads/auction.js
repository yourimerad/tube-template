// SimAds auction: GEO / device / audience -> fictional demand partners bid from rates.json -> one winner.
// Every number is publisher NET (what the site would be paid). Nothing here contacts anybody.
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { creativesFor } from './creatives.js';

export const RATES = JSON.parse(readFileSync(new URL('./rates.json', import.meta.url), 'utf8'));
export const FORMATS = ['banner', 'native', 'sticky', 'popunder', 'interstitial', 'inpage_push', 'vast'];
export const AUDIENCES = ['general', 'adult'];
export const SIZES = ['728x90', '300x250', '320x50', '300x100', '900x250', '160x600', '468x60'];
const T1 = new Set(RATES.tiers.T1);
const T2 = new Set(RATES.tiers.T2);

export const tierOf = geo => (T1.has(geo) ? 'T1' : T2.has(geo) ? 'T2' : 'T3');
export const deviceOf = ua => (/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Silk/i.test(String(ua || '')) ? 'mobile' : 'desktop');
export const audienceOf = (v, fallback = 'general') => (AUDIENCES.includes(v) ? v : AUDIENCES.includes(fallback) ? fallback : 'general');

const cookie = (req, name) => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
};
export { cookie };
const cc = v => (/^[A-Za-z]{2}$/.test(String(v || '').trim()) ? String(v).trim().toUpperCase().replace(/^UK$/, 'GB') : '');

// GEO: cookie simads_geo (set by /simads/geo?c=XX), CF-IPCountry / X-Country, Accept-Language region, else FR.
export function geoOf(req) {
  const fromCookie = cc(cookie(req, 'simads_geo'));
  if (fromCookie) return fromCookie;
  for (const h of ['cf-ipcountry', 'x-country']) { const v = cc(req.headers[h]); if (v && v !== 'XX' && v !== 'T1') return v; }
  const m = /^[a-z]{2,3}-([a-z]{2})\b/i.exec(String(req.headers['accept-language'] || '').trim());
  return m ? m[1].toUpperCase().replace(/^UK$/, 'GB') : 'FR';
}

// eCPM multiplier of a country on top of its tier (T1 ranges are US-level: FR 0.4, DE 0.6 ...).
const MULT = RATES.country_multipliers || {};
export const multiplierOf = geo => (typeof MULT[geo] === 'number' ? MULT[geo] : tierOf(geo) === 'T1' ? (MULT._T1_other ?? 1) : 1);

export function rateFor(audience, format, tier, device, mult = 1) {
  const row = RATES.audiences[audienceOf(audience)]?.[format]?.[tier];
  if (!row) return null;
  const [min, max] = (row[device] || row.desktop).map(v => v * mult);
  return { min, max, fill: row.fill, mid: (min + max) / 2 };
}

// ---------- signed auction tokens ----------
// The price is decided here and travels in an HMAC-signed token (beacons and click URLs carry it), so a
// client can neither invent impressions nor change their price; the DB keeps one row per (auction, event).
let KEY = randomBytes(32);
export const setKey = salt => { KEY = createHmac('sha256', String(salt)).update('simads-token-v1').digest(); };
const mac = s => createHmac('sha256', KEY).update(s).digest('base64url').slice(0, 22);

export function sign(o) {
  const body = Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${body}.${mac(body)}`;
}
const TOKEN_TTL_S = 6 * 3600;
export function verify(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig || body.length > 1200) return null;
  const want = Buffer.from(mac(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Date.now() / 1000 - o.t > TOKEN_TTL_S ? null : o;
  } catch { return null; }
}

// ---------- auction ----------
// Each partner that buys the format bids with probability p so that P(at least one bid) = the fill rate of
// rates.json; bids are drawn inside the [min, max] eCPM range, skewed low (most impressions clear near the
// floor, a few near the top), and the highest bid wins (first price, already net).
const rnd = () => Math.random();
export function runAuction({ audience, format, zone, size, geo, device, force = '' }) {
  const tier = tierOf(geo);
  const r = rateFor(audience, format, tier, device, multiplierOf(geo));
  const aid = randomBytes(8).toString('base64url');
  const base = { aid, audience, format, zone, size, geo, tier, device };
  if (!r || force === 'nofill') return { ...base, filled: false };
  const partners = RATES.partners[audience].filter(p => p.formats.includes(format));
  const fill = force === 'fill' ? 1 : r.fill;
  const p = 1 - (1 - fill) ** (1 / Math.max(1, partners.length));
  let best = null;
  for (const partner of partners) {
    if (force !== 'fill' && rnd() >= p) continue;
    const ecpm = r.min + (r.max - r.min) * rnd() ** 1.7;
    if (!best || ecpm > best.ecpm) best = { partner, ecpm };
  }
  if (!best && force === 'fill') best = { partner: partners[0], ecpm: r.min };
  if (!best) return { ...base, filled: false };
  const pool = creativesFor(audience, format);
  const creative = pool[Math.floor(rnd() * pool.length)];
  const ecpm = Math.round(best.ecpm * 1e4) / 1e4; // 4 decimals (price per impression in micro-dollars stays an integer)
  return { ...base, filled: true, partner: best.partner, creative, ecpm, micros: Math.round(ecpm * 1000) };
}

export const tokenOf = a => sign({ i: a.aid, au: a.audience, f: a.format, z: a.zone, s: a.size, g: a.geo, d: a.device,
  p: a.partner?.id || '', c: a.creative?.id || '', m: a.micros || 0, t: Math.floor(Date.now() / 1000) });

// ---------- projection ----------
// Expected revenue for a traffic profile with the same table (mid of each range x fill x country multiplier).
// geo = shares by country code (US, FR ...) and/or tier (T1 = a generic T1 country, T2, T3).
// Per-page formats count per pageview, popunder per visitor per day (24 h cap), interstitial 1 per N pageviews
// after the first, in-page push 1 per visit, VAST n per pageview.
export const DEFAULT_MIX = { banner: 3, native: 2, sticky: 1, vast: 0.5, popunder: 1, interstitial: 4, inpage_push: 1 };
export const DEFAULT_GEO = { US: 0.3, FR: 0.2, T1: 0.15, T2: 0.2, T3: 0.15 };
// adblock = share of pageviews where no ad loads at all (the sim loader is never blocked; real tags are).
export function project({ audience = 'general', visitors = 1000, pages = 4, geo = DEFAULT_GEO, mobile = 0.6, adblock = 0.25, mix = DEFAULT_MIX } = {}) {
  audience = audienceOf(audience);
  const parts = Object.entries(geo).filter(([k, v]) => v > 0 && (/^T[123]$/.test(k) || /^[A-Z]{2}$/.test(k)))
    .map(([k, share]) => (/^T[123]$/.test(k)
      ? { share, tier: k, mult: k === 'T1' ? (MULT._T1_other ?? 1) : 1 }
      : { share, tier: tierOf(k), mult: multiplierOf(k) }));
  const gsum = parts.reduce((s, p) => s + p.share, 0) || 1;
  const pv = visitors * pages;
  const per = {};
  let total = 0;
  for (const format of FORMATS) {
    const n = Number(mix[format]) || 0;
    if (!n) continue;
    // impressions offered per day for this format
    const offered = format === 'popunder' ? visitors * Math.min(1, n)
      : format === 'inpage_push' ? visitors * n
        : format === 'interstitial' ? Math.max(0, pv - visitors) / Math.max(1, n)
          : pv * n;
    let rev = 0, imps = 0;
    for (const p of parts) {
      for (const [device, share] of [['mobile', mobile], ['desktop', 1 - mobile]]) {
        const r = rateFor(audience, format, p.tier, device, p.mult);
        const i = offered * (1 - adblock) * (p.share / gsum) * share * r.fill;
        imps += i;
        rev += (i * r.mid) / 1000;
      }
    }
    per[format] = { impressions: Math.round(imps), revenue_day: round2(rev), ecpm: imps ? round2((rev / imps) * 1000) : 0 };
    total += rev;
  }
  return {
    audience, visitors, pages, pageviews: pv, geo, mobile, adblock, mix, formats: per,
    revenue_day: round2(total), revenue_month: round2(total * 30.4), rpm_pageviews: pv ? round2((total / pv) * 1000) : 0,
    rpm_visits: visitors ? round2((total / visitors) * 1000) : 0,
  };
}
export const round2 = n => Math.round(n * 100) / 100;
