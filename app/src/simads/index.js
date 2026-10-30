// SimAds: a simulated ad network (ads.mode = "sim"), registered by server.js under /simads.
// It behaves like the async-loader networks tube sites use (zone tags, VAST pre-roll, popunder, interstitial,
// in-page push, native, sticky) but never contacts a third party and labels every creative "Simulated ad".
//
//   GET  /simads/static/<file>     loader.js, simads.css, report.js, demo.js (app/static/simads)
//   GET  /simads/serve             one ad decision for a zone (JSON)          GET /simads/creative/<id>/<WxH>.svg
//   GET  /simads/vast              VAST 4.2 InLine (&wrapper=1: Wrapper)      GET|POST /simads/e   event beacon
//   GET  /simads/click             logs the click, 302 to /simads/landing     GET /simads/landing  fake advertiser
//   GET  /simads/geo?c=US          GEO cookie for demos/tests                 GET /simads/demo     every format
//   GET  /simads/report(.json)     simulated revenue report                   GET /simads/projection
//   POST /simads/reset             wipe the events (same-origin only)
// Wire protocol: see the ads contract (docs/ARCHITECTURE.md, ads section).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { q } from '../db.js';
import { staticDir } from '../assets.js';
import { t as siteT } from '../i18n.js';
import { svg, creative as creativeById } from './creatives.js';
import { runAuction, tokenOf, verify, setKey, geoOf, deviceOf, tierOf, audienceOf, cookie, project, RATES, FORMATS, SIZES, DEFAULT_MIX, DEFAULT_GEO } from './auction.js';
import * as store from './store.js';
import { demoPage, landingPage, reportPage, geoPage } from './pages.js';

const EVENTS = new Set(['pv', 'req', 'imp', 'view', 'click', 'close', 'start', 'q1', 'mid', 'q3', 'complete', 'skip', 'error']);
const ZONE_RE = /^[a-z0-9_-]{1,40}$/i;
const NATIVE_SIZE = '640x360';
const sim = config.ads?.sim || {};
const SIM_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(sim.origin || '') ? sim.origin.replace(/\/+$/, '') : '';
const siteAudience = () => audienceOf(config.audience || config.ads?.audience || 'general');

export default async function simads(app) {
  // ---------- lazy init: the salt lives in the DB, which is only migrated after plugins are registered ----------
  let SALT = '';
  let ready = null;
  const init = async () => {
    SALT = config.hashSalt || (await q(`SELECT value FROM settings WHERE key = 'hash_salt'`)).rows[0]?.value || randomBytes(32).toString('hex');
    setKey(SALT);
    store.start(app.log);
  };
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!ready) ready = init().catch(err => { ready = null; throw err; });
    await ready;
  });
  app.addHook('onClose', async () => { await store.stop(); });
  const hash = (kind, v) => createHash('sha256').update(`${SALT}|simads-${kind}|${v}`).digest('base64url').slice(0, 22);
  const ipKey = req => hash('ip', req.ip || '');

  // Forms (reset) post urlencoded; Fastify only parses JSON by default. Scoped to this plugin.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 },
    (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

  const baseOf = req => SIM_ORIGIN || `${req.protocol}://${req.host}`;
  const secure = req => (req.protocol === 'https' ? '; Secure' : '');

  // ---------- static (served from memory; the loader URL is not fingerprinted, so a short cache) ----------
  const sdir = join(staticDir, 'simads');
  const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
  const files = new Map();
  for (const f of existsSync(sdir) ? readdirSync(sdir) : []) {
    const ext = f.split('.').pop();
    if (!TYPES[ext]) continue;
    const body = readFileSync(join(sdir, f));
    files.set(f, { body, type: TYPES[ext], etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"` });
  }
  app.get('/static/:file', async (req, reply) => {
    const f = files.get(req.params.file);
    if (!f) return reply.code(404).type('text/plain').send('Not found');
    reply.header('Cache-Control', 'public, max-age=300').header('ETag', f.etag).header('Access-Control-Allow-Origin', '*');
    if (req.headers['if-none-match'] === f.etag) return reply.code(304).send();
    return reply.type(f.type).send(f.body);
  });

  // ---------- creatives ----------
  app.get('/creative/:cid/:size', async (req, reply) => {
    const m = /^(\d+x\d+)\.svg$/.exec(req.params.size);
    const c = creativeById(req.params.cid);
    if (!m || !c || !(SIZES.includes(m[1]) || m[1] === NATIVE_SIZE)) return reply.code(404).type('text/plain').send('Not found');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.type('image/svg+xml').send(svg(c, m[1]));
  });

  // ---------- one ad decision ----------
  // geo / force query params override the cookies: a VAST player may fetch the tag without cookies
  // (credentials: 'omit'), so demos and tests pass them in the tag URL.
  const ctx = req => {
    const qGeo = /^[A-Za-z]{2}$/.test(req.query.geo || '') ? req.query.geo.toUpperCase().replace(/^UK$/, 'GB') : '';
    const force = req.query.force !== undefined ? req.query.force : cookie(req, 'simads_force');
    return {
      audience: audienceOf(req.query.au, siteAudience()),
      geo: qGeo || geoOf(req), device: deviceOf(req.headers['user-agent']),
      force: ['fill', 'nofill'].includes(force) ? force : '',
    };
  };
  const reqRow = a => ({ ev: 'req', aid: a.aid, zone: a.zone, format: a.format, size: a.size || '', audience: a.audience, geo: a.geo,
    tier: a.tier, device: a.device, partner: a.partner?.id || '', creative: a.creative?.id || '', filled: !!a.filled, price_micros: 0 });

  app.get('/serve', async (req, reply) => {
    if (!store.allow(`serve|${ipKey(req)}`, 300)) return reply.code(429).send({ fill: false, error: 'rate limited' });
    const format = FORMATS.includes(req.query.format) && req.query.format !== 'vast' ? req.query.format : 'banner';
    const zone = ZONE_RE.test(req.query.zone || '') ? req.query.zone : format;
    let size = String(req.query.size || '');
    if (format === 'native' || format === 'inpage_push') size = NATIVE_SIZE;
    else if (format === 'interstitial') size = '300x250';
    else if (format === 'popunder') size = '';
    else if (!SIZES.includes(size)) size = '300x250';
    const a = runAuction({ ...ctx(req), format, zone, size });
    store.push(reqRow(a));
    if (!a.filled) return { fill: false, aid: a.aid };
    const tok = tokenOf(a);
    const c = a.creative;
    const base = baseOf(req);
    const [w, h] = size ? size.split('x').map(Number) : [0, 0];
    return {
      fill: true, aid: a.aid, token: tok, zone, format, size, w, h,
      img: size ? `${base}/simads/creative/${c.id}/${size}.svg` : '',
      click: `${base}/simads/click?a=${tok}`,
      advertiser: c.advertiser, title: c.headline, text: c.sub, cta: c.cta,
      partner: a.partner.name, ecpm: a.ecpm, geo: a.geo, tier: a.tier, device: a.device,
      label: 'Simulated ad', ad: t('ad.label', 'Ad'), sponsored: t('ad.sponsored', 'Sponsored'), close: t('ad.close', 'Close ad'),
    };
  });

  // ---------- events ----------
  const event = async (req, reply) => {
    reply.code(204);
    const ev = String(req.query.ev || '');
    if (!EVENTS.has(ev)) return reply.send();
    if (!store.allow(`e|${ipKey(req)}`, ev === 'pv' ? 120 : 1200)) return reply.send();
    if (ev === 'pv') {
      let v = /^[A-Za-z0-9_-]{16,32}$/.test(cookie(req, 'simads_v')) ? cookie(req, 'simads_v') : '';
      if (!v) v = randomBytes(12).toString('base64url');
      // Visit = 30 minutes sliding: every pageview pushes the expiry.
      reply.header('Set-Cookie', `simads_v=${v}; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax${secure(req)}`);
      const geo = geoOf(req);
      store.push({ ev, aid: null, audience: audienceOf(req.query.au, siteAudience()), geo, tier: tierOf(geo),
        device: deviceOf(req.headers['user-agent']), visit: hash('v', v) });
      return reply.send();
    }
    if (ev === 'req') return reply.send(); // requests are logged by /serve and /vast themselves
    const o = verify(req.query.a);
    if (!o) { store.stats.rejected_token++; return reply.send(); }
    store.push(rowOf(o, ev));
    return reply.send();
  };
  const rowOf = (o, ev) => ({ ev, aid: o.i, zone: o.z, format: o.f, size: o.s || '', audience: o.au, geo: o.g, tier: tierOf(o.g),
    device: o.d, partner: o.p, creative: o.c, price_micros: ev === 'imp' ? o.m : 0 });
  app.get('/e', event);
  app.post('/e', event);

  // ---------- click-through (popunder: the opened tab IS the impression) ----------
  app.get('/click', async (req, reply) => {
    const o = verify(req.query.a);
    if (o && store.allow(`c|${ipKey(req)}`, 120)) store.push(rowOf(o, o.f === 'popunder' ? 'imp' : 'click'));
    const qs = o ? new URLSearchParams({ c: o.c, p: o.p, f: o.f, z: o.z }) : new URLSearchParams();
    return reply.redirect(`/simads/landing?${qs}`, 302);
  });

  app.get('/landing', async (req, reply) => {
    const c = creativeById(String(req.query.c || ''));
    const p = Object.values(RATES.partners).flat().find(x => x.id === req.query.p);
    return html(reply, landingPage({ c, partner: p?.name || '', format: String(req.query.f || ''), zone: String(req.query.z || '') }));
  });

  app.get('/geo', async (req, reply) => {
    const c = String(req.query.c || '').trim().toUpperCase().replace(/^UK$/, 'GB');
    const cookies = [];
    if (/^[A-Z]{2}$/.test(c)) cookies.push(`simads_geo=${c}; Path=/; Max-Age=2592000; SameSite=Lax${secure(req)}`);
    else if (c === 'AUTO' || c === '') cookies.push(`simads_geo=; Path=/; Max-Age=0; SameSite=Lax${secure(req)}`);
    if (req.query.force !== undefined) {
      const f = ['fill', 'nofill'].includes(req.query.force) ? req.query.force : '';
      cookies.push(`simads_force=${f}; Path=/; Max-Age=${f ? 86400 : 0}; SameSite=Lax${secure(req)}`);
    }
    if (cookies.length) reply.header('Set-Cookie', cookies);
    const r = String(req.query.r || '');
    if (r.startsWith('/') && !r.startsWith('//') && !r.includes('\\')) return reply.redirect(r, 303);
    return html(reply, geoPage({ geo: /^[A-Z]{2}$/.test(c) ? c : '', tier: /^[A-Z]{2}$/.test(c) ? tierOf(c) : '' }));
  });

  // ---------- VAST 4.2 ----------
  let media = { at: 0, files: [] };
  const mediaFiles = async () => {
    if (Date.now() - media.at < 60_000) return media.files;
    let files = [];
    try {
      const man = JSON.parse(await readFile(join(config.mediaDir, '_simads', 'manifest.json'), 'utf8'));
      files = (Array.isArray(man.videos) ? man.videos : []).filter(v => /^video-\d+\.mp4$/.test(v.file) && existsSync(join(config.mediaDir, '_simads', v.file)))
        .map(v => ({ path: `_simads/${v.file}`, duration: Number(v.duration) || 10, width: v.width || 1280, height: v.height || 720, bitrate: v.bitrate || 1500, title: v.title || '' }));
    } catch { /* no pipeline creatives */ }
    if (!files.length && existsSync(join(config.mediaDir, '_house', 'preroll.mp4'))) {
      files = [{ path: '_house/preroll.mp4', duration: 10, width: 1280, height: 720, bitrate: 1500, title: '' }];
    }
    media = { at: Date.now(), files };
    return files;
  };
  const xml = (reply, body) => reply.type('application/xml; charset=utf-8').header('Access-Control-Allow-Origin', '*')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`);
  const NOFILL = '<VAST version="4.2" xmlns="http://www.iab.com/VAST"></VAST>';
  const cdata = s => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  const hms = s => new Date(Math.max(0, Math.round(s)) * 1000).toISOString().slice(11, 19);
  const exml = s => String(s).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));

  app.get('/vast', async (req, reply) => {
    const base = baseOf(req);
    const files = await mediaFiles();
    let tok = '';
    let o = null;
    if (req.query.a) {
      tok = String(req.query.a);
      o = verify(tok);
      if (!o || o.f !== 'vast') return xml(reply, NOFILL);
    } else {
      if (!store.allow(`vast|${ipKey(req)}`, 120)) return xml(reply, NOFILL);
      const zone = ZONE_RE.test(req.query.zone || '') ? req.query.zone : 'preroll';
      const a = runAuction({ ...ctx(req), format: 'vast', zone, size: '' });
      if (a.filled && !files.length) a.filled = false; // no creative video on disk: no-fill
      store.push(reqRow(a));
      if (!a.filled) return xml(reply, NOFILL);
      tok = tokenOf(a);
      o = verify(tok);
      if (req.query.wrapper === '1') {
        return xml(reply, `<VAST version="4.2" xmlns="http://www.iab.com/VAST">
 <Ad id="${a.aid}">
  <Wrapper followAdditionalWrappers="true" allowMultipleAds="false">
   <AdSystem version="1">SimAds wrapper (simulated)</AdSystem>
   <Error>${cdata(`${base}/simads/e?ev=error&a=${tok}&code=[ERRORCODE]`)}</Error>
   <Impression id="simads-w">${cdata(`${base}/simads/e?ev=imp&a=${tok}`)}</Impression>
   <VASTAdTagURI>${cdata(`${base}/simads/vast?zone=${a.zone}&a=${tok}`)}</VASTAdTagURI>
  </Wrapper>
 </Ad>
</VAST>`);
      }
    }
    if (!files.length) return xml(reply, NOFILL);
    const c = creativeById(o.c) || { advertiser: 'SimAds', headline: 'Simulated ad', id: 'sim' };
    const partner = Object.values(RATES.partners).flat().find(x => x.id === o.p);
    const f = files[parseInt(o.i.replace(/[^0-9a-f]/gi, '').slice(0, 6) || '0', 16) % files.length];
    const mediaUrl = /^https?:\/\//.test(config.mediaBase) ? `${config.mediaBase}/${f.path}` : `${base}${config.mediaBase}/${f.path}`;
    const e = ev => cdata(`${base}/simads/e?ev=${ev}&a=${tok}`);
    const skip = Math.min(5, Math.max(1, Math.floor(f.duration / 2)));
    return xml(reply, `<VAST version="4.2" xmlns="http://www.iab.com/VAST">
 <Ad id="${o.i}">
  <InLine>
   <AdSystem version="1">SimAds (simulated network)</AdSystem>
   <Error>${cdata(`${base}/simads/e?ev=error&a=${tok}&code=[ERRORCODE]`)}</Error>
   <Impression id="simads">${e('imp')}</Impression>
   <AdServingId>${o.i}</AdServingId>
   <AdTitle>${exml(`Simulated ad: ${c.advertiser}`)}</AdTitle>
   <Advertiser>${exml(c.advertiser)}</Advertiser>
   <Description>${exml(`Simulated ad. ${c.headline}. Demand partner: ${partner?.name || 'SimAds'}. Nobody was paid.`)}</Description>
   <Creatives>
    <Creative id="${exml(c.id)}" sequence="1" adId="${exml(c.id)}">
     <UniversalAdId idRegistry="simads">${exml(c.id)}</UniversalAdId>
     <Linear skipoffset="${hms(skip)}">
      <Duration>${hms(f.duration)}</Duration>
      <TrackingEvents>
       <Tracking event="start">${e('start')}</Tracking>
       <Tracking event="firstQuartile">${e('q1')}</Tracking>
       <Tracking event="midpoint">${e('mid')}</Tracking>
       <Tracking event="thirdQuartile">${e('q3')}</Tracking>
       <Tracking event="complete">${e('complete')}</Tracking>
       <Tracking event="skip">${e('skip')}</Tracking>
       <Tracking event="closeLinear">${e('close')}</Tracking>
       <Tracking event="progress" offset="00:00:02">${e('view')}</Tracking>
      </TrackingEvents>
      <VideoClicks>
       <ClickThrough id="simads">${cdata(`${base}/simads/click?a=${tok}`)}</ClickThrough>
       <ClickTracking id="simads">${e('click')}</ClickTracking>
      </VideoClicks>
      <MediaFiles>
       <MediaFile id="simads-${exml(f.path.replace(/\W+/g, '-'))}" delivery="progressive" type="video/mp4" width="${f.width}" height="${f.height}" bitrate="${f.bitrate}" scalable="true" maintainAspectRatio="true">${cdata(mediaUrl)}</MediaFile>
      </MediaFiles>
     </Linear>
    </Creative>
   </Creatives>
  </InLine>
 </Ad>
</VAST>`);
  });

  // ---------- report ----------
  const win = req => (Object.hasOwn(store.WINDOWS, req.query.window) ? req.query.window : '24h');
  app.get('/report.json', async req => {
    const r = await store.report(win(req), { events: Math.max(0, Math.min(5000, Number(req.query.events) || 0)) });
    return { audience: siteAudience(), ...r, projection: project({ audience: siteAudience() }) };
  });
  app.get('/report', async (req, reply) => {
    const r = await store.report(win(req));
    return html(reply, reportPage({ r, audience: siteAudience(), rates: RATES, defaults: { mix: DEFAULT_MIX, geo: DEFAULT_GEO } }));
  });
  app.get('/projection', async req => {
    const n = (v, d, min, max) => { const x = Number(v); return Number.isFinite(x) && x >= min && x <= max ? x : d; };
    const mix = {};
    for (const f of FORMATS) mix[f] = n(req.query[`m_${f}`], DEFAULT_MIX[f], 0, 20);
    return project({
      audience: audienceOf(req.query.audience, siteAudience()),
      visitors: n(req.query.visitors, 1000, 0, 1e9), pages: n(req.query.pages, 4, 1, 100), mobile: n(req.query.mobile, 0.6, 0, 1), adblock: n(req.query.adblock, 0.25, 0, 1),
      geo: geoMix(req.query, n), mix,
    });
  });

  // GEO mix from g_<CC|T1|T2|T3>=share query params (shares are normalized), else the default mix.
  const geoMix = (qs, n) => {
    const g = {};
    for (const [k, v] of Object.entries(qs)) {
      const m = /^g_([A-Za-z]{2}|T[123])$/.exec(k);
      if (m) g[m[1].toUpperCase().replace(/^UK$/, 'GB')] = n(v, 0, 0, 1e6);
    }
    return Object.values(g).some(v => v > 0) ? g : DEFAULT_GEO;
  };

  // Same-origin POST only: Origin (or, without it, Sec-Fetch-Site / Referer) must be this host.
  app.post('/reset', async (req, reply) => {
    const host = req.headers.host;
    const hostOf = u => { try { return new URL(u).host; } catch { return null; } };
    const same = req.headers.origin ? hostOf(req.headers.origin) === host
      : req.headers['sec-fetch-site'] ? req.headers['sec-fetch-site'] === 'same-origin'
        : hostOf(req.headers.referer || '') === host;
    if (!same) return reply.code(403).send({ error: 'cross-origin reset refused' });
    await store.reset();
    if (String(req.headers.accept || '').includes('text/html')) return reply.redirect('/simads/report?reset=1', 303);
    return { ok: true };
  });

  app.get('/demo', async (req, reply) => html(reply, demoPage({ audience: audienceOf(req.query.au, siteAudience()) })));
}

// Site strings when available (locales/<lang>.json "ad.*"), English otherwise.
function t(key, fallback) { const v = siteT(key); return v === key ? fallback : v; }

const html = (reply, page) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(String(page));
