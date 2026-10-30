// k6/tube.js : one iteration = one realistic visit of the site (run by infra/loadtest.sh on the <prefix>loadgen box).
//   GET / + its posters (parallel, like a browser) -> hover 2-3 preview.mp4 (full files) -> GET a video page
//   -> master.m3u8 -> rung index (RUNG, default 480) -> init + SEGMENTS (default 15) segments, the first 3 back
//   to back (player buffer) then one every 4 s (MODE=playback) or no pause (MODE=throughput)
//   -> POST view after 2 segments -> sometimes GET comments (30%) / POST vote (20%) -> think time.
// Comment POSTs only with COMMENT_POST=1, and then only VUs 1..COMMENT_POST_VUS (default 3) on their first
// iteration (at most a handful of rows to delete afterwards).
// Env: BASE_URL (required) BASIC_USER BASIC_PASS VUS="50,150,300" RAMP=1m HOLD=3m MODE SEGMENTS RUNG MEDIA_BASE
//      CATALOG_FILE (catalog.json path inside the container; else GET MEDIA_BASE/catalog.json)
//      VIDEO_PATH (e.g. "/v/{id}/{slug}"; default: discovered from links on the home page, else "/v/{id}")
//      VIEW_PATH VOTE_PATH COMMENTS_PATH (templates with {id} / {slug}) INSECURE=1 (staging cert)
import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { Counter } from 'k6/metrics';

// response bytes per stage (k6's data_received is not tagged per request); 429s from nginx limit_req (per IP)
const respBytes = new Counter('resp_bytes');
const rateLimited = new Counter('rate_limited_429');
// the site's nginx answers 404 for /media/catalog.json: loadtest.sh ships the catalog next to the script
const CATALOG = __ENV.CATALOG_FILE ? JSON.parse(open(__ENV.CATALOG_FILE)) : null;

const BASE = (__ENV.BASE_URL || '').replace(/\/$/, '');
const AUTH = 'Basic ' + encoding.b64encode(`${__ENV.BASIC_USER || 'viewer'}:${__ENV.BASIC_PASS || ''}`);
const MODE = __ENV.MODE || 'playback';
const SEGMENTS = parseInt(__ENV.SEGMENTS || '15', 10);
const RUNG = __ENV.RUNG || '480';
const MEDIA = (__ENV.MEDIA_BASE || '/media').replace(/\/$/, '');
const VIEW_PATH = __ENV.VIEW_PATH || '/api/videos/{id}/view';
const VOTE_PATH = __ENV.VOTE_PATH || '/api/videos/{id}/vote';
const COMMENTS_PATH = __ENV.COMMENTS_PATH || '/api/videos/{id}/comments';
const COMMENT_POST = __ENV.COMMENT_POST === '1';
const COMMENT_POST_VUS = parseInt(__ENV.COMMENT_POST_VUS || '3', 10);
const VUS = (__ENV.VUS || '50,150,300').split(',').map((v) => parseInt(v, 10)).filter((v) => v > 0);
const RAMP = __ENV.RAMP || '1m';
const HOLD = __ENV.HOLD || '3m';
const KINDS = ['page', 'poster', 'preview', 'playlist', 'segment', 'api'];

function secs(d) { const m = /^(\d+)(s|m)$/.exec(d); if (!m) throw new Error(`bad duration ${d}`); return parseInt(m[1], 10) * (m[2] === 'm' ? 60 : 1); }
const stages = [];
const windows = []; // [startSec, endSec, tag] of each hold phase
let t = 0;
for (const v of VUS) {
  stages.push({ duration: RAMP, target: v }); t += secs(RAMP);
  stages.push({ duration: HOLD, target: v }); windows.push([t, t + secs(HOLD), `v${v}`]); t += secs(HOLD);
}
stages.push({ duration: '30s', target: 0 });

// thresholds double as "please report this tagged sub-metric" (k6 only summarises tagged sub-metrics that have one)
const thresholds = { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<3000'] };
for (const k of KINDS) thresholds[`http_req_duration{kind:${k}}`] = ['p(95)<5000'];
for (const w of windows) {
  thresholds[`http_req_duration{stage:${w[2]}}`] = ['p(95)<5000'];
  thresholds[`http_req_failed{stage:${w[2]}}`] = ['rate<0.05'];
  thresholds[`http_reqs{stage:${w[2]}}`] = ['count>=0'];
  thresholds[`resp_bytes{stage:${w[2]}}`] = ['count>=0'];
  thresholds[`rate_limited_429{stage:${w[2]}}`] = ['count>=0'];
}

export const options = {
  scenarios: { visits: { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '20s', gracefulStop: '60s' } },
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  insecureSkipTLSVerify: __ENV.INSECURE === '1',
  userAgent: 'Mozilla/5.0 (tube-loadtest k6)',
  batchPerHost: 6,
  noConnectionReuse: false,
};

function stageTag(t0) {
  const el = (Date.now() - t0) / 1000;
  for (const w of windows) if (el >= w[0] && el < w[1]) return w[2];
  return 'ramp';
}
function params(kind, stage, extra) {
  const p = { headers: { Authorization: AUTH }, tags: { kind, stage } };
  if (kind === 'poster' || kind === 'preview' || kind === 'segment') p.responseType = 'none'; // bytes counted, not kept
  if (extra) Object.assign(p.headers, extra);
  return p;
}
function acct(r, st) {
  const cl = parseInt((r.headers && (r.headers['Content-Length'] || r.headers['content-length'])) || '0', 10);
  respBytes.add(cl > 0 ? cl : (typeof r.body === 'string' ? r.body.length : 0), { stage: st });
  if (r.status === 429) rateLimited.add(1, { stage: st });
  return r;
}
function get(url, kind, st) { return acct(http.get(url, params(kind, st)), st); }
function fill(tpl, v) { return tpl.replace('{id}', v.id).replace('{slug}', v.slug || v.id); }
function resolve(base, rel) {
  if (/^https?:\/\//.test(rel)) return rel;
  if (rel.startsWith('/')) return BASE + rel;
  return base.substring(0, base.lastIndexOf('/') + 1) + rel;
}
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rand(a, b) { return a + Math.random() * (b - a); }

export function setup() {
  if (!BASE) throw new Error('BASE_URL is required');
  const h = { headers: { Authorization: AUTH }, tags: { kind: 'setup', stage: 'setup' } };
  let list = CATALOG;
  if (!list) {
    const cat = http.get(`${BASE}${MEDIA}/catalog.json`, h);
    if (cat.status !== 200) throw new Error(`catalog.json HTTP ${cat.status}: pass CATALOG_FILE`);
    list = cat.json();
  }
  const videos = list.map((v) => ({ id: v.id, slug: v.slug }));
  if (!videos.length) throw new Error('empty catalog');
  let tpl = __ENV.VIDEO_PATH || '';
  if (!tpl) {
    const home = http.get(`${BASE}/`, h);
    const hrefs = [...String(home.body).matchAll(/href="([^"#?]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      const v = videos.find((x) => (x.slug && href.includes(x.slug)) || href.includes(x.id));
      if (v && !href.includes(MEDIA + '/')) {
        tpl = href;
        if (v.slug) tpl = tpl.replace(v.slug, '{slug}');
        tpl = tpl.replace(v.id, '{id}');
        tpl = tpl.replace(/^https?:\/\/[^/]+/, '');
        break;
      }
    }
  }
  if (!tpl) tpl = '/v/{id}';
  console.log(`setup: ${videos.length} videos, video page template ${tpl}, mode ${MODE}, stages ${JSON.stringify(stages)}`);
  return { videos, tpl, t0: Date.now() };
}

export default function (data) {
  const st = stageTag(data.t0);
  http.cookieJar().clear(BASE); // every iteration is a new visitor
  const vids = data.videos;

  // home + posters of the grid
  const home = get(`${BASE}/`, 'page', st);
  check(home, { 'home 200': (r) => r.status === 200 });
  for (const r of http.batch(vids.slice(0, 24).map((v) => ['GET', `${BASE}${MEDIA}/${v.media_path || v.id}/poster.webp`, null, params('poster', st)]))) acct(r, st);
  sleep(rand(1, 3));

  // hover previews (2-3 full files)
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const r = get(`${BASE}${MEDIA}/${(x => x.media_path || x.id)(pick(vids))}/preview.mp4`, 'preview', st);
    check(r, { 'preview 200': (x) => x.status === 200 });
    sleep(rand(0.5, 1.5));
  }

  // video page + HLS playback
  const v = pick(vids);
  const page = get(BASE + fill(data.tpl, v), 'page', st);
  check(page, { 'video page 200': (r) => r.status === 200 });
  const masterUrl = `${BASE}${MEDIA}/${v.media_path || v.id}/hls/master.m3u8`;
  const master = get(masterUrl, 'playlist', st);
  if (!check(master, { 'master 200': (r) => r.status === 200 })) return;
  const lines = String(master.body).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const rungRel = lines.find((l) => l.startsWith(`${RUNG}/`) || l.includes(`/${RUNG}/`)) || lines[Math.min(1, lines.length - 1)];
  if (!rungRel) return;
  const rungUrl = resolve(masterUrl, rungRel);
  const idx = get(rungUrl, 'playlist', st);
  if (!check(idx, { 'rung index 200': (r) => r.status === 200 })) return;
  const body = String(idx.body);
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(body);
  if (map) get(resolve(rungUrl, map[1]), 'segment', st);
  const segs = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, SEGMENTS);
  for (let i = 0; i < segs.length; i++) {
    const r = get(resolve(rungUrl, segs[i]), 'segment', st);
    check(r, { 'segment 200': (x) => x.status === 200 });
    if (i === 1) {
      const view = http.post(BASE + fill(VIEW_PATH, v), '{}', params('api', st, { 'Content-Type': 'application/json' }));
      check(view, { 'view 2xx': (x) => x.status >= 200 && x.status < 300 });
    }
    if (MODE === 'playback' && i >= 2) sleep(4);
  }

  if (Math.random() < 0.3) get(BASE + fill(COMMENTS_PATH, v), 'api', st);
  if (Math.random() < 0.2) {
    http.post(BASE + fill(VOTE_PATH, v), JSON.stringify({ value: 1 }), params('api', st, { 'Content-Type': 'application/json' }));
  }
  if (COMMENT_POST && __VU <= COMMENT_POST_VUS && __ITER === 0) {
    http.post(BASE + fill(COMMENTS_PATH, v), JSON.stringify({ author: 'k6', body: 'k6 load test comment (delete me)' }),
      params('api', st, { 'Content-Type': 'application/json' }));
  }
  sleep(rand(2, 5));
}

function n2(x) { return x === undefined || x === null ? '-' : Number(x).toFixed(1); }
export function handleSummary(data) {
  const m = data.metrics;
  const dur = data.state.testRunDurationMs / 1000;
  const out = [];
  const d = m.http_req_duration.values;
  out.push(`duration ${dur.toFixed(0)} s, iterations ${m.iterations ? m.iterations.values.count : 0}, max VUs ${m.vus_max ? m.vus_max.values.max : '-'}`);
  out.push(`requests ${m.http_reqs.values.count} (${n2(m.http_reqs.values.rate)}/s), failed ${(100 * m.http_req_failed.values.rate).toFixed(2)}%`);
  if (m.rate_limited_429) out.push(`HTTP 429 (nginx per-IP limit_req) ${m.rate_limited_429.values.count}`);
  out.push(`latency p50 ${n2(d.med)} ms, p95 ${n2(d['p(95)'])} ms, p99 ${n2(d['p(99)'])} ms`);
  out.push(`received ${(m.data_received.values.count / 1e9).toFixed(2)} GB, avg ${(m.data_received.values.rate * 8 / 1e6).toFixed(1)} Mbps`);
  for (const k of KINDS) {
    const s = m[`http_req_duration{kind:${k}}`];
    if (s && s.values.count !== 0) out.push(`  ${k.padEnd(9)} p50 ${n2(s.values.med)} ms  p95 ${n2(s.values['p(95)'])} ms`);
  }
  for (const w of windows) {
    const s = m[`http_req_duration{stage:${w[2]}}`];
    const f = m[`http_req_failed{stage:${w[2]}}`];
    const r = m[`http_reqs{stage:${w[2]}}`];
    const b = m[`resp_bytes{stage:${w[2]}}`];
    const rl = m[`rate_limited_429{stage:${w[2]}}`];
    const len = w[1] - w[0];
    if (!s) continue;
    out.push(`  hold ${w[2].padEnd(5)} p50 ${n2(s.values.med)} ms  p95 ${n2(s.values['p(95)'])} ms  fail ${f ? (100 * f.values.rate).toFixed(2) : '-'}%  ` +
      `${r ? (r.values.count / len).toFixed(1) : '-'} req/s  ${b ? (b.values.count * 8 / len / 1e6).toFixed(1) : '-'} Mbps  429s ${rl ? rl.values.count : 0}`);
  }
  const txt = out.join('\n') + '\n';
  return { stdout: txt, '/lt/summary.json': JSON.stringify(data), '/lt/summary.txt': txt };
}
