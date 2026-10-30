import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createHash, randomBytes } from 'node:crypto';
import { config, siteOrigin } from './config.js';
import { pool, q, waitForDb, migrate, seed, loadSalt } from './db.js';
import * as repo from './repo.js';
import { staticDir } from './assets.js';
import { listingPage, categoriesPage, watchPage, errorPage } from './views/pages.js';
import { legalPage, gatePage, simVerifierPage, LEGAL_PAGES, RTA } from './views/legal.js';
import { buildCsp, inlineScriptHashes } from './ads/csp.js';
import { adsTxt, adsTxtRedirect } from './ads/adstxt.js';
import { makeAgeGate, safeNext } from './ads/agegate.js';
import { t, paths } from './i18n.js';
import { themeCss, faviconSvg } from './theme.js';

const app = Fastify({
  trustProxy: true, // only reachable through nginx (no published port)
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    // Never log client IPs: only method + url.
    serializers: { req: r => ({ method: r.method, url: r.url }), res: r => ({ statusCode: r.statusCode }) },
  },
  bodyLimit: 16 * 1024,
});

let SALT = '';
const hash = (kind, value) => createHash('sha256').update(`${SALT}|${kind}|${value}`).digest('base64url');

// ---------- headers ----------
const mediaOrigin = /^https?:\/\//.test(config.mediaBase) ? new URL(config.mediaBase).origin : '';
// CSP from the enabled ad presets (src/ads/csp.js): origins per directive + sha256 of the page's inline
// scripts (pages are cached and identical for everyone: hashes, never nonces).
const cspBase = { mediaOrigin, simOrigin: config.ads.sim.origin };
const cspCache = new Map(); // inline-script set -> header (few distinct pages kinds)
const cspFor = page => {
  const hashes = inlineScriptHashes(page);
  const k = hashes.join(' ');
  if (!cspCache.has(k)) { if (cspCache.size > 200) cspCache.clear(); cspCache.set(k, buildCsp(config.ads, cspBase, hashes)); }
  return cspCache.get(k);
};

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.private) reply.header('X-Robots-Tag', 'noindex, nofollow');
  const ct = String(reply.getHeader('content-type') || '');
  if (ct.startsWith('text/html')) {
    reply.header('Content-Security-Policy', cspFor(typeof payload === 'string' ? payload : ''));
    if (gate.enabled) reply.header('Vary', 'Cookie'); // a CDN must not serve gated pages to ungated visitors
    if (config.audience === 'adult') reply.header('Rating', RTA); // RTA label as a header too (rtalabel.org)
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  }
  return payload;
});

// Anonymous HTML: identical for everyone (no cookies set, no per-user content), so nginx
// caches it 30 s (X-Accel-Expires) and a future CDN may too (s-maxage). Browsers revalidate.
const sendPage = (reply, page, status = 200) => {
  reply.code(status).type('text/html; charset=utf-8');
  if (status === 200) {
    reply.header('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=30');
    reply.header('X-Accel-Expires', '30');
  } else {
    reply.header('Cache-Control', 'no-store');
  }
  return reply.send(String(page));
};

// HTML forms (age gate): application/x-www-form-urlencoded, tiny bodies only.
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2048 },
  (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

// ---------- age gate (audience "adult", src/ads/agegate.js) ----------
// Session cookies av_exp + av_sig (1 h sliding, no "remember me"), checked here AND by nginx (secure_link: gates
// /media, keys the page cache). Geo rules from CF-IPCountry / X-Country / X-Region (set by a CDN or proxy).
const gate = makeAgeGate({ audience: config.audience, gate: config.ageGate, cookieSecret: config.ageCookieSecret, tokenSecret: config.ageGateSecret });
if (gate.enabled && gate.mode === 'provider' && !gate.tokenReady) app.log.warn('age gate: no provider verification key (AGE_GATE_SECRET / verify.public_key / verify.jwks_url): tokens will be refused');
const UNGATED = /^\/(age\/|legal\/|static\/|simads\/report\.json$|healthz$|robots\.txt$|ads\.txt$|theme\.css$|favicon\.(svg|ico)$)/;
const isHttps = req => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
if (gate.enabled) {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (UNGATED.test(path)) return;
    const rule = gate.rule(req.headers);
    if (rule !== 'block' && gate.passed(req.headers.cookie)) return;
    if (path.startsWith('/api/')) return reply.code(403).header('Cache-Control', 'no-store').send({ error: t('age.api_refused') });
    if (path.startsWith('/media/') || path.startsWith('/simads/')) return reply.code(403).header('Cache-Control', 'no-store').send('age verification required');
    return sendPage(reply, gatePage({ next: safeNext(req.url), rule }), rule === 'block' ? 451 : 200);
  });
}
const sameOrigin = req => {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};
const noStorePage = (reply, page, status) => reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(String(page));

if (gate.enabled) {
  app.register(async r => {
    r.addHook('onRequest', async (req, reply) => { reply.header('Cache-Control', 'no-store'); });
    r.get('/gate', async (req, reply) => noStorePage(reply, gatePage({ next: safeNext(req.query.next), rule: gate.rule(req.headers) }), 200));
    // 18+ click-through: mode "click", or a geo rule "click" for this visitor's country/state.
    r.post('/confirm', async (req, reply) => {
      if (!sameOrigin(req)) return reply.code(403).send('origin refused');
      if (gate.rule(req.headers) !== 'click') return reply.code(403).send('age verification required');
      reply.header('Set-Cookie', gate.setCookies(isHttps(req)));
      return reply.redirect(safeNext(req.body?.next), 303);
    });
    // Sliding 1 h session: static/js/age.js calls this while the visitor is active.
    r.post('/refresh', async (req, reply) => {
      if (!sameOrigin(req) || !gate.passed(req.headers.cookie)) return reply.code(403).send('');
      reply.header('Set-Cookie', gate.setCookies(isHttps(req)));
      return reply.code(204).send();
    });
    r.post('/leave', async (req, reply) => {
      reply.header('Set-Cookie', gate.clearCookies(isHttps(req)));
      return reply.redirect(config.ageGate.exit_url, 303);
    });
    if (gate.mode === 'provider' || gate.mode === 'sim') {
      r.get('/start', async (req, reply) => {
        const next = safeNext(req.query.next);
        const { state, cookie } = gate.newState(isHttps(req));
        const proto = isHttps(req) ? 'https' : req.protocol;
        const back = `${proto}://${req.headers.host}/age/callback?next=${encodeURIComponent(next)}`;
        const start = gate.mode === 'sim' ? `${proto}://${req.headers.host}/age/sim` : config.ageGate.provider.start_url;
        let u;
        try { u = new URL(start); } catch { return noStorePage(reply, gatePage({ next, error: t('age.provider_missing') }), 500); }
        u.searchParams.set('return_url', back);
        u.searchParams.set('state', state);
        reply.header('Set-Cookie', cookie);
        return reply.redirect(u.toString(), 302);
      });
      r.get('/callback', async (req, reply) => {
        const next = safeNext(req.query.next);
        const ok = await gate.verifyToken(req.query.token, gate.stateOf(req.headers.cookie));
        if (ok !== true) {
          req.log.info({ reason: ok }, 'age verification refused');
          return noStorePage(reply, gatePage({ next, error: t('age.failed') }), 403);
        }
        reply.header('Set-Cookie', [...gate.setCookies(isHttps(req)), gate.clearState(isHttps(req))]);
        return reply.redirect(next, 303);
      });
    }
    if (gate.mode === 'sim') {
      const backOk = (req, u) => { try { const x = new URL(u); return x.host === req.headers.host && x.pathname === '/age/callback'; } catch { return false; } };
      r.get('/sim', async (req, reply) => {
        if (!backOk(req, req.query.return_url)) return reply.code(400).send('bad return_url');
        return noStorePage(reply, simVerifierPage({ returnUrl: req.query.return_url, state: String(req.query.state || '') }), 200);
      });
      r.post('/sim', async (req, reply) => {
        const b = req.body || {};
        if (!sameOrigin(req) || !backOk(req, b.return_url)) return reply.code(400).send('bad request');
        const token = gate.signToken({ over18: b.result === '1', exp: Math.floor(Date.now() / 1000) + 300, state: String(b.state || '') });
        const u = new URL(b.return_url);
        u.searchParams.set('token', token);
        u.searchParams.set('state', String(b.state || ''));
        return reply.redirect(u.toString(), 303);
      });
    }
  }, { prefix: '/age' });
}

// ---------- static (nginx serves /static directly in compose; this is the fallback/dev path) ----------
await app.register(fastifyStatic, {
  root: staticDir,
  prefix: '/static/',
  cacheControl: false,
  setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
});

// ---------- helpers ----------
const intParam = (v, d, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};
const pageOf = req => intParam(req.query.page, 1, 1, 1000);
const sortOf = req => (repo.SORT_TABS.includes(req.query.sort) ? req.query.sort : 'recommended');

let catCache = { at: 0, rows: [] };
async function cats() {
  if (Date.now() - catCache.at > 60_000) catCache = { at: Date.now(), rows: await repo.categories() };
  return catCache.rows;
}

const notFound = (reply, msg = t('errors.page_not_found')) => sendPage(reply, errorPage(404, msg), 404);

// ---------- pages ----------
app.get('/', async (req, reply) => {
  const sort = sortOf(req), page = pageOf(req);
  const { rows, total } = await repo.listVideos({ sort, page });
  return sendPage(reply, listingPage({ heading: t('home_heading'), nav: 'home', path: '/', sort, cats: await cats(),
    rows, total, page, title: page > 1 ? t('page_n', { n: page }) : '' }));
});

// Localised paths (/tendances, /trending ...) from locales/<lang>.json "paths".
for (const [path, sort, nav, heading] of [
  [paths.trending, 'trending', 'trending', t('nav.trending')],
  [paths.new, 'new', 'new', t('nav.new')],
  [paths.top_rated, 'top_rated', 'top_rated', t('nav.top_rated')],
]) {
  app.get(path, async (req, reply) => {
    const page = pageOf(req);
    const { rows, total } = await repo.listVideos({ sort, page });
    return sendPage(reply, listingPage({ heading, nav, path, sort, tabs: false, cats: await cats(), rows, total, page,
      title: heading, sub: sort === 'trending' ? t('trending_sub') : '' }));
  });
}

app.get('/categories', async (req, reply) => sendPage(reply, categoriesPage(await cats())));

app.get('/c/:slug', async (req, reply) => {
  const cat = await repo.category(req.params.slug);
  if (!cat) return notFound(reply, t('cat_not_found'));
  const sort = sortOf(req), page = pageOf(req);
  const { rows, total } = await repo.listVideos({ sort, page, category: cat.slug });
  return sendPage(reply, listingPage({ heading: cat.name, nav: 'categories', path: `/c/${cat.slug}`, sort,
    cats: await cats(), activeCat: cat.slug, rows, total, page, title: cat.name, empty: t('cat_empty') }));
});

app.get('/tag/:tag', async (req, reply) => {
  const tag = String(req.params.tag).trim().toLowerCase().slice(0, 60);
  if (!tag) return notFound(reply);
  const sort = sortOf(req), page = pageOf(req);
  const { rows, total } = await repo.listVideos({ sort, page, tag });
  return sendPage(reply, listingPage({ heading: `#${tag}`, path: `/tag/${encodeURIComponent(tag)}`, sort, cats: await cats(),
    rows, total, page, title: t('tag_title', { tag }), empty: t('tag_empty') }));
});

app.get('/search', async (req, reply) => {
  const term = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!term) return reply.redirect('/');
  const page = pageOf(req);
  const { rows, total } = await repo.searchVideos(term, page);
  return sendPage(reply, listingPage({ heading: t('search_heading', { q: term }), path: '/search', extraParams: { q: term },
    tabs: false, sort: 'recommended', cats: await cats(), rows, total, page, q: term, title: t('search_title', { q: term }),
    empty: t('search_empty') }));
});

const watch = async (req, reply) => {
  const v = await repo.video(req.params.id);
  if (!v) return notFound(reply, t('errors.video_not_found'));
  if (req.params.slug !== v.slug) return reply.redirect(`/v/${v.id}/${v.slug}`, 301);
  const [related, comments] = await Promise.all([repo.related(v), repo.comments(v.id, 'recent', 50)]);
  return sendPage(reply, watchPage({ v, related, comments }));
};
app.get('/v/:id', watch);
app.get('/v/:id/:slug', watch);

app.get('/robots.txt', async (req, reply) => {
  reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=300');
  return config.private
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /search\nSitemap: ${siteOrigin()}/sitemap.xml\n`;
});

app.get('/sitemap.xml', async (req, reply) => {
  if (config.private) return reply.code(404).type('text/plain').send('Not found');
  const esc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const o = siteOrigin();
  const cs = await cats();
  const vids = await repo.sitemapEntries();
  const urls = [`${o}/`, `${o}/categories`, `${o}${paths.trending}`, `${o}${paths.new}`, `${o}${paths.top_rated}`]
    .map(u => `<url><loc>${esc(u)}</loc></url>`)
    .concat(cs.map(c => `<url><loc>${esc(`${o}/c/${c.slug}`)}</loc></url>`))
    .concat(vids.map(v => `<url><loc>${esc(`${o}/v/${v.id}/${v.slug}`)}</loc><lastmod>${new Date(v.published_at).toISOString().slice(0, 10)}</lastmod></url>`));
  reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=300');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
});

// ads.txt: lines of the configured network presets + ads.ads_txt (src/ads/adstxt.js).
const adsTxtBody = adsTxt(config.ads, config.siteName);
const adsTxtTo = adsTxtRedirect(config.ads, config.siteHost);
app.get('/ads.txt', async (req, reply) => (adsTxtTo ? reply.redirect(adsTxtTo, 301)
  : reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=300').send(adsTxtBody)));

// Adult audience: 2257 / DMCA / abuse report pages (template text, placeholders from site.config.json "legal").
if (config.audience === 'adult') {
  for (const k of LEGAL_PAGES) app.get(`/legal/${k}`, async (req, reply) => sendPage(reply, legalPage(k)));
}

// Simulated ad network (ads.mode "sim", private sites only): app/src/simads, its own routes under /simads.
if (config.adsMode === 'sim') {
  let simads = null;
  try { ({ default: simads } = await import('./simads/index.js')); } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND' || !String(err.message).includes('simads/index.js')) throw err;
    app.log.warn('ads.mode sim but src/simads/index.js is missing: sim slots will stay empty');
  }
  if (simads) await app.register(simads, { prefix: '/simads' });
}

// Per-site theme (accent + content-label colours) and favicon, fingerprinted by content (?v=hash).
const immutable = 'public, max-age=31536000, immutable';
app.get('/theme.css', async (req, reply) => reply.type('text/css; charset=utf-8').header('Cache-Control', immutable).send(themeCss));
app.get('/favicon.svg', async (req, reply) => reply.type('image/svg+xml').header('Cache-Control', immutable).send(faviconSvg));
app.get('/favicon.ico', async (req, reply) => reply.redirect('/favicon.svg', 301));

app.get('/healthz', { logLevel: 'warn' }, async (req, reply) => {
  reply.header('Cache-Control', 'no-store');
  try { await q('SELECT 1'); return { ok: true }; } catch { return reply.code(503).send({ ok: false }); }
});

// ---------- API (never cached; JSON only) ----------
const VID_COOKIE = 'tv';
function visitor(req, reply) {
  const m = /(?:^|;\s*)tv=([A-Za-z0-9_-]{22})(?:;|$)/.exec(req.headers.cookie || '');
  let id = m && m[1];
  if (!id) {
    id = randomBytes(16).toString('base64url');
    const secure = req.protocol === 'https' ? '; Secure' : '';
    reply.header('Set-Cookie', `${VID_COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
  }
  return hash('v', id);
}
const ipHash = req => hash('ip', req.ip || '');

app.register(async api => {
  api.addHook('onRequest', async (req, reply) => { reply.header('Cache-Control', 'no-store'); });
  // Cross-site POST protection: browsers send Origin on fetch POST; reject foreign origins.
  api.addHook('preHandler', async (req, reply) => {
    if (req.method !== 'GET' && req.headers.origin) {
      let host = '';
      try { host = new URL(req.headers.origin).host; } catch { /* bad origin */ }
      if (host !== req.headers.host) return reply.code(403).send({ error: t('api.origin_refused') });
    }
  });

  const ID = { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z0-9]{4,32}$' } }, required: ['id'] };
  const videoExists = async id => (await q('SELECT 1 FROM videos WHERE id = $1 AND NOT hidden', [id])).rowCount > 0;

  api.get('/videos/:id/state', { schema: { params: ID } }, async (req, reply) => {
    const vh = visitor(req, reply);
    const { rows } = await q(`SELECT v.views, v.likes, v.dislikes, v.comments_count,
        (SELECT value FROM votes WHERE video_id = v.id AND visitor_hash = $2) AS vote
      FROM videos v WHERE v.id = $1 AND NOT v.hidden`, [req.params.id, vh]);
    if (!rows[0]) return reply.code(404).send({ error: t('api.video_not_found') });
    const r = rows[0];
    return { views: Number(r.views), likes: r.likes, dislikes: r.dislikes, comments: r.comments_count, vote: r.vote ?? 0 };
  });

  api.post('/videos/:id/view', { schema: { params: ID } }, async (req, reply) => {
    const vh = visitor(req, reply);
    const id = req.params.id;
    if (!(await videoExists(id))) return reply.code(404).send({ error: t('api.video_not_found') });
    const fresh = await q(`INSERT INTO view_dedup (video_id, visitor_hash) VALUES ($1, $2)
      ON CONFLICT (video_id, visitor_hash) DO UPDATE SET last_at = now()
        WHERE view_dedup.last_at < now() - interval '6 hours'
      RETURNING 1`, [id, vh]);
    let counted = false;
    if (fresh.rowCount) {
      counted = true;
      await q('UPDATE videos SET views = views + 1 WHERE id = $1', [id]);
      await q(`INSERT INTO video_views_daily (video_id, day, views) VALUES ($1, current_date, 1)
        ON CONFLICT (video_id, day) DO UPDATE SET views = video_views_daily.views + 1`, [id]);
    }
    const { rows } = await q('SELECT views FROM videos WHERE id = $1', [id]);
    return { counted, views: Number(rows[0].views) };
  });

  api.post('/videos/:id/vote', {
    schema: { params: ID, body: { type: 'object', properties: { value: { type: 'integer', enum: [-1, 0, 1] } }, required: ['value'] } },
  }, async (req, reply) => {
    const vh = visitor(req, reply);
    const id = req.params.id, value = req.body.value;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query('SELECT 1 FROM videos WHERE id = $1 AND NOT hidden FOR UPDATE', [id]);
      if (!lock.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: t('api.video_not_found') }); }
      const prev = (await client.query('SELECT value FROM votes WHERE video_id = $1 AND visitor_hash = $2', [id, vh])).rows[0]?.value ?? 0;
      if (prev !== value) {
        if (value === 0) await client.query('DELETE FROM votes WHERE video_id = $1 AND visitor_hash = $2', [id, vh]);
        else await client.query(`INSERT INTO votes (video_id, visitor_hash, value) VALUES ($1, $2, $3)
          ON CONFLICT (video_id, visitor_hash) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [id, vh, value]);
        const dl = (value === 1) - (prev === 1), dd = (value === -1) - (prev === -1);
        await client.query('UPDATE videos SET likes = likes + $2, dislikes = dislikes + $3 WHERE id = $1', [id, dl, dd]);
      }
      const { rows } = await client.query('SELECT likes, dislikes FROM videos WHERE id = $1', [id]);
      await client.query('COMMIT');
      return { vote: value, likes: rows[0].likes, dislikes: rows[0].dislikes };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  const pubComment = c => ({ id: Number(c.id), author: c.author, body: c.body, upvotes: c.upvotes, created_at: c.created_at });

  api.get('/videos/:id/comments', { schema: { params: ID } }, async req => {
    const sort = req.query.sort === 'popular' ? 'popular' : 'recent';
    const rows = await repo.comments(req.params.id, sort, 100);
    const { rows: c } = await q('SELECT comments_count FROM videos WHERE id = $1', [req.params.id]);
    return { count: c[0]?.comments_count ?? 0, comments: rows.map(pubComment) };
  });

  // Strip control chars (keep newlines), collapse runs of blank lines.
  const clean = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max + 1);

  api.post('/videos/:id/comments', {
    schema: {
      params: ID,
      body: { type: 'object', properties: { author: { type: 'string' }, body: { type: 'string' }, website: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const vh = visitor(req, reply);
    const id = req.params.id;
    // Honeypot filled -> bots get a fake success and nothing is stored.
    if (req.body.website) return { ok: true, comment: null };
    const author = clean(req.body.author, 40).replace(/\s+/g, ' ');
    const body = clean(req.body.body, 1000);
    if (author.length < 2 || author.length > 40) return reply.code(400).send({ error: t('api.author_len') });
    if (body.length < 2 || body.length > 1000) return reply.code(400).send({ error: t('api.body_len') });
    if (!(await videoExists(id))) return reply.code(404).send({ error: t('api.video_not_found') });
    const ih = ipHash(req);
    const recent = await q(`SELECT count(*)::int AS n FROM comments WHERE ip_hash = $1 AND created_at > now() - interval '1 minute'`, [ih]);
    if (recent.rows[0].n >= config.commentRatePerMin) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ error: t('api.rate_limited') });
    }
    const { rows } = await q(`INSERT INTO comments (video_id, author, body, visitor_hash, ip_hash)
      VALUES ($1, $2, $3, $4, $5) RETURNING id, author, body, upvotes, created_at`, [id, author, body, vh, ih]);
    const cnt = await q('UPDATE videos SET comments_count = comments_count + 1 WHERE id = $1 RETURNING comments_count', [id]);
    return reply.code(201).send({ ok: true, count: cnt.rows[0].comments_count, comment: pubComment(rows[0]) });
  });

  api.post('/comments/:cid/upvote', {
    schema: { params: { type: 'object', properties: { cid: { type: 'integer', minimum: 1 } }, required: ['cid'] } },
  }, async (req, reply) => {
    const vh = visitor(req, reply);
    const cid = req.params.cid;
    const exists = await q('SELECT 1 FROM comments WHERE id = $1 AND NOT hidden', [cid]);
    if (!exists.rowCount) return reply.code(404).send({ error: t('api.comment_not_found') });
    const ins = await q(`INSERT INTO comment_votes (comment_id, visitor_hash) VALUES ($1, $2)
      ON CONFLICT DO NOTHING RETURNING 1`, [cid, vh]);
    const { rows } = ins.rowCount
      ? await q('UPDATE comments SET upvotes = upvotes + 1 WHERE id = $1 RETURNING upvotes', [cid])
      : await q('SELECT upvotes FROM comments WHERE id = $1', [cid]);
    return { upvotes: rows[0].upvotes, voted: true, already: !ins.rowCount };
  });
}, { prefix: '/api' });

// ---------- errors ----------
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).header('Cache-Control', 'no-store').send({ error: t('api.not_found') });
  return notFound(reply);
});

app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status >= 500) req.log.error(err);
  if (req.url.startsWith('/api/')) {
    return reply.code(status).header('Cache-Control', 'no-store')
      .send({ error: status === 400 ? t('api.bad_request') : status === 500 ? t('api.server_error') : err.message });
  }
  return sendPage(reply, errorPage(status, status === 500 ? t('errors.server') : t('errors.bad_request')), status);
});

// ---------- start ----------
await waitForDb(app.log);
await migrate(app.log);
SALT = await loadSalt(app.log);
await seed(app.log);
// Prune expired view-dedup rows hourly.
setInterval(() => q(`DELETE FROM view_dedup WHERE last_at < now() - interval '6 hours'`).catch(err => app.log.warn(err)), 3600_000).unref();

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', close);
process.on('SIGINT', close);

await app.listen({ port: config.port, host: config.host });
