// Content-Security-Policy built from the enabled ad presets.
// Pages are cached (nginx 30 s, identical for everyone), so no per-request nonces: inline ad snippets are
// allowed by the sha256 of their (deterministic) text, computed from the page itself. 'unsafe-inline' only
// with the documented escape hatch ads.csp_unsafe_inline (networks that inject inline scripts at run time);
// browsers ignore 'unsafe-inline' when hashes are present, so the hatch drops the hashes.
import { createHash } from 'node:crypto';
import { PRESETS } from './presets/index.js';
import { usedNetworks, preroll } from './render.js';
import { slotNetwork } from './normalize.js';

const DIRS = ['script', 'frame', 'img', 'connect', 'media', 'style', 'worker'];
const originOf = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : ''; } catch { return ''; } };

// sha256 of every inline <script> (no src) that may run: normal, module, and inert ads scripts / templates.
export function inlineScriptHashes(markup) {
  const out = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(markup)))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '';
    if (/json/i.test(type)) continue;
    if (type === 'text/plain' && !/\bdata-consent\s*=/.test(attrs)) continue;
    if (!m[2].trim()) continue;
    out.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return [...out].sort();
}

// Origins per directive for the current ads mode. ctx = { simOrigin }
export function adOrigins(ads, ctx = {}) {
  const o = Object.fromEntries(DIRS.map(d => [d, new Set()]));
  const add = (dirs, list) => { for (const d of dirs) for (const v of list || []) if (v) o[d].add(v); };
  const all = ['script', 'frame', 'img', 'connect'];
  if (ads.mode === 'sim' && ctx.simOrigin) add([...all, 'media'], [ctx.simOrigin]);
  if (ads.mode === 'live') {
    add(['script', 'frame', 'img', 'connect', 'media'], ads.csp_origins); // old ads.csp_origins
    for (const id of usedNetworks(ads)) {
      const p = PRESETS[id];
      for (const d of DIRS) add([d], p.csp?.[d]);
      if (p.extraOrigins) {
        for (const n of Object.keys(ads.slots)) if (slotNetwork(ads, ads.slots[n]) === id) add(all, p.extraOrigins(ads.networks[id] || {}, ads.slots[n]));
        add(all, p.extraOrigins(ads.networks[id] || {}, null));
      }
    }
    // Display creatives and tracking pixels come from many CDNs: images are allowed from any https origin.
    if (usedNetworks(ads).length) o.img.add('https:');
    if (ads.consent.effective === 'cmp') add(all, ads.consent.cmp_csp);
  }
  const pr = preroll(ads, ctx);
  if (pr && pr.kind === 'vast' && ads.mode === 'live') {
    // VAST wrappers chain to any ad server, creatives and trackers live on any CDN.
    const p = PRESETS[pr.network];
    add(['connect'], [originOf(pr.url)]);
    for (const d of ['connect', 'media', 'img']) add([d], p?.csp?.[d]);
    o.connect.add('https:'); o.media.add('https:'); o.img.add('https:');
  }
  return o;
}

// Full header. base = { mediaOrigin, simOrigin }, hashes = inlineScriptHashes(page)
export function buildCsp(ads, base = {}, hashes = []) {
  const o = adOrigins(ads, base);
  const j = (...xs) => [...new Set(xs.flat().filter(Boolean))].join(' ');
  const live = ads.mode === 'live' && usedNetworks(ads).length > 0;
  const inline = ads.mode === 'live' && ads.csp_unsafe_inline ? ["'unsafe-inline'"] : hashes;
  // Google tags (AdSense, GPT, Ezoic) need 'unsafe-eval': it is part of Google's own documented policy.
  const needEval = ads.mode === 'live' && (ads.csp_unsafe_eval || usedNetworks(ads).some(id => PRESETS[id].unsafeEval));
  const eval_ = needEval ? ["'unsafe-eval'"] : [];
  const parts = [
    "default-src 'self'",
    `img-src ${j("'self'", 'data:', base.mediaOrigin, [...o.img])}`,
    `media-src ${j("'self'", 'blob:', base.mediaOrigin, [...o.media])}`,
    `connect-src ${j("'self'", base.mediaOrigin, base.vastOrigin, [...o.connect])}`,
    `worker-src ${j("'self'", 'blob:', [...o.worker])}`,
    `script-src ${j("'self'", [...o.script], inline, eval_)}`,
    ...(o.frame.size ? [`frame-src ${j([...o.frame])}`] : []),
    // Ad tags set inline style attributes (<ins style="display:block">): allowed only when real networks run.
    `style-src ${j("'self'", live ? "'unsafe-inline'" : '', [...o.style])}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' mailto:", // mailto: the NCII removal form (/legal/ncii)
    "frame-ancestors 'self'",
  ];
  return parts.join('; ');
}
