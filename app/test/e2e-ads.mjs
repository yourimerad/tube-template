// Ads engine e2e (Playwright, run by test/run-e2e.sh). The scenario comes from ADS_SCENARIO (set by
// test/ads-scenarios.sh, which restarts the dev stack with the matching config); without it the script only runs
// the checks that fit the current mode (placeholder / off) and the config validation cases.
//   placeholder  labelled house slots, zero third-party request, no CSP violation, /ads.txt
//   live         2 presets (ExoClick + Adsterra) + a custom slot + sponsored links + ExoClick VAST pre-roll, EVERY
//                third-party request intercepted (page.route): exact tags, CSP origins + sha256 hashes, consent
//                banner refuse / accept, US opt-out with Global Privacy Control, VAST tracking
//   adult-click  age gate click-through: nothing explicit / no ad before the gate, /media 403, session cookies,
//                nginx cache never leaks a verified page to an unverified visitor, geo block, sliding refresh
//   adult-sim    simulated age verifier (ok + failure) with the simulated ad network behind the gate
// Validation cases (REPO_DIR mounted): lib/config.mjs refuses Google + adult, Google + popunder, Google + built-in
// EU banner, sim ads on a public site, public adult click-through, AdXpansion; accepts the legacy boolean form.
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = (process.env.BASE || 'http://127.0.0.1:18190').replace(/\/+$/, '');
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.SHOTS || '/shots';
const LOCALE = process.env.LOCALE || 'en-US';
const SCEN = process.env.ADS_SCENARIO || (process.env.ADS_MODE === 'placeholder' && process.env.AUDIENCE !== 'adult' ? 'placeholder' : '');
const auth = process.env.AUTH_USER ? { username: process.env.AUTH_USER, password: process.env.AUTH_PASS } : undefined;
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ads: ${name}${extra ? `  (${extra})` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout = 5000, step = 100) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { last = await fn().catch(() => null); if (last) return last; await sleep(step); }
  return last;
}

// ---------- validation cases (no browser) ----------
function validationCases() {
  const repo = process.env.REPO_DIR;
  if (!repo || !fs.existsSync(`${repo}/lib/config.mjs`)) { console.log('SKIP  ads: validation cases (REPO_DIR not mounted)'); return; }
  const dir = fs.mkdtempSync('/tmp/adsval-');
  fs.mkdirSync(`${dir}/videos`);
  const base = { site: { name: 'Val Test', language: 'en' }, videos: { dir: 'videos' }, deploy: { target: 'ssh', prefix: 'val-' } };
  const pub = { publisher_id: 'pub-1234567890123456' };
  const cases = [
    ['Google preset on an adult site refused', false, { audience: 'adult', age_gate: { mode: 'sim' }, ads: { mode: 'live', consent: { mode: 'cmp', cmp_html: '<script src="https://cmp.example/c.js"></script>' }, networks: { adsense: pub }, slots: { leaderboard: { network: 'adsense', zone: '1234567890' } } } }, /adult/],
    ['Google + popunder refused', false, { ads: { mode: 'live', consent: { region: 'us' }, networks: { adsense: pub }, slots: { leaderboard: { network: 'adsense', zone: '1234567890' }, popunder: { network: 'adsterra', zone: 'https://pl1.example.com/aa/bb/cc/0123456789abcdef0123456789abcdef.js' } } } }, /popunder/],
    ['Google + built-in EU banner refused (certified TCF CMP needed)', false, { ads: { mode: 'live', networks: { adsense: pub }, slots: { leaderboard: { network: 'adsense', zone: '1234567890' } } } }, /TCF CMP/],
    ['Google with consent.region "us" accepted', true, { ads: { mode: 'live', consent: { region: 'us' }, networks: { adsense: pub }, slots: { leaderboard: { network: 'adsense', zone: '1234567890' } } } }],
    ['ads.mode sim on a public site refused', false, { private: false, ads: { mode: 'sim' } }, /private/],
    ['public adult site with click-through refused (FR/UK/27 US states)', false, { private: false, audience: 'adult', age_gate: { mode: 'click' } }, /27 US states/],
    ['public adult click-through with allow_click_through accepted', true, { private: false, audience: 'adult', age_gate: { mode: 'click', allow_click_through: true } }],
    ['closed network (AdXpansion) refused', false, { audience: 'adult', age_gate: { mode: 'sim' }, ads: { mode: 'live', slots: { leaderboard: { network: 'adxpansion', zone: '1' } } } }, /closed/],
    ['legacy boolean slots + ads.vast_url accepted', true, { ads: { mode: 'placeholder', slots: { sticky: false, preroll: true }, vast_url: 'https://ads.example.com/vast' } }],
  ];
  for (const [name, expectOk, over, re] of cases) {
    const f = `${dir}/site.config.json`;
    fs.writeFileSync(f, JSON.stringify({ ...base, ...over }));
    let pass = true, out = '';
    try { out = execFileSync('node', [`${repo}/lib/config.mjs`, '--config', f, 'validate'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TUBE_SECRETS_DIR: dir } }); }
    catch (e) { pass = false; out = String(e.stderr || e.message); }
    ok(`validate: ${name}`, pass === expectOk && (!re || re.test(out)), pass === expectOk ? '' : out.split('\n').slice(0, 3).join(' | '));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- helpers ----------
const INLINE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
function inlineHashes(markup) {
  const out = new Set();
  let m;
  while ((m = INLINE.exec(markup))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs) || !m[2].trim()) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '';
    if (/json/i.test(type) || (type === 'text/plain' && !/data-consent/.test(attrs))) continue;
    out.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return [...out];
}
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const VAST = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.2"><Ad id="t1"><InLine><AdSystem>Test</AdSystem><AdTitle>t</AdTitle>
<Impression><![CDATA[https://track.vast.example/imp?cb=[CACHEBUSTING]]]></Impression>
<Error><![CDATA[https://track.vast.example/err?code=[ERRORCODE]]]></Error>
<Creatives><Creative><Linear skipoffset="00:00:02"><Duration>00:00:05</Duration>
<TrackingEvents><Tracking event="start"><![CDATA[https://track.vast.example/start]]></Tracking>
<Tracking event="firstQuartile"><![CDATA[https://track.vast.example/q1]]></Tracking>
<Tracking event="skip"><![CDATA[https://track.vast.example/skip]]></Tracking></TrackingEvents>
<VideoClicks><ClickThrough><![CDATA[https://advertiser.vast.example/]]></ClickThrough></VideoClicks>
<MediaFiles><MediaFile delivery="progressive" type="video/mp4" width="1280" height="720"><![CDATA[https://cdn.vast.example/ad.mp4]]></MediaFile></MediaFiles>
</Linear></Creative></Creatives></InLine></Ad></VAST>`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let houseMp4 = null;
// A context whose third-party requests are ALL intercepted (never reach the network) and recorded.
async function ctxOf(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: auth, locale: LOCALE, ...opts });
  ctx.foreign = [];
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await ctx.route('**/*', async route => {
    const u = route.request().url();
    let o = '';
    try { o = new URL(u).origin; } catch { /* data: */ }
    if (!o || o === 'null' || o === ORIGIN) return route.continue();
    ctx.foreign.push(u);
    if (/vast\.php|\/vast/.test(u)) return route.fulfill({ status: 200, contentType: 'application/xml', body: VAST, headers: { 'access-control-allow-origin': '*' } });
    if (/\.mp4(\?|$)/.test(u)) {
      if (!houseMp4) houseMp4 = await (await ctx.request.get(`${BASE}/media/_house/preroll.mp4`)).body();
      return route.fulfill({ status: 200, contentType: 'video/mp4', body: houseMp4, headers: { 'access-control-allow-origin': '*' } });
    }
    if (/\.js(\?|$)|\.php(\?|$)/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__stubs = (window.__stubs || 0) + 1;' });
    return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
  });
  return ctx;
}
const cspErrors = page => page.evaluate(() => window.__csp || []);

try {
  if (!SCEN || SCEN === 'placeholder') validationCases();
  if (!SCEN) {
    console.log(`SKIP  ads: browser scenarios (ADS_MODE=${process.env.ADS_MODE || '?'}, no ADS_SCENARIO: run test/ads-scenarios.sh)`);
  }

  // ------------------------------------------------ placeholder ------------------------------------------------
  if (SCEN === 'placeholder') {
    const ctx = await ctxOf();
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const slots = await page.locator('[data-ad-slot]').count();
    ok('placeholder slots rendered', slots >= 3, `${slots} slots`);
    const unlabelled = await page.evaluate(() => [...document.querySelectorAll('.ad[data-ad-slot]')].filter(a => !a.querySelector('.ad-tag')).length);
    ok('every placeholder labelled', unlabelled === 0, `${unlabelled} unlabelled`);
    const watchHref = await page.locator('.card h3 a').first().getAttribute('href');
    const wHtml = await (await ctx.request.get(`${BASE}${watchHref}`)).text();
    ok('watch page: footer + sidebar placeholder slots', wHtml.includes('data-ad-slot="footer"') && wHtml.includes('data-ad-slot="rect-side-1"'));
    ok('no third-party request', ctx.foreign.length === 0, ctx.foreign.slice(0, 3).join(' '));
    ok('no ads.js / consent banner in placeholder mode', (await page.locator('#consent').count()) === 0 && !(await res.text()).includes('/static/js/ads.js'));
    const csp = res.headers()['content-security-policy'] || '';
    ok('CSP has no third-party origin / unsafe-inline script', !/https:\/\/|'unsafe-inline'[^;]*;\s*object/.test(csp.replace(/style-src[^;]*;/, '')) && !/script-src[^;]*'unsafe-inline'/.test(csp), csp.slice(0, 160));
    await page.goto(`${BASE}/categories`, { waitUntil: 'networkidle' });
    ok('no CSP violation', (await cspErrors(page)).length === 0, (await cspErrors(page)).join(' | '));
    const txt = await ctx.request.get(`${BASE}/ads.txt`);
    ok('/ads.txt served as text/plain', txt.status() === 200 && /text\/plain/.test(txt.headers()['content-type']));
    await page.screenshot({ path: `${SHOTS}/ads-placeholder-home.png` });
    await ctx.close();
  }

  // ------------------------------------------------ live ------------------------------------------------
  if (SCEN === 'live') {
    // 1. before consent
    const ctx = await ctxOf();
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const home = await res.text();
    const href = await page.locator('.card h3 a').first().getAttribute('href');
    const wres = await ctx.request.get(`${BASE}${href}`);
    const html = await wres.text(); // watch page: leaderboard + sidebar + footer slots
    const csp = wres.headers()['content-security-policy'] || '';
    ok('home CSP carries the preset origins', (res.headers()['content-security-policy'] || '').includes('https://a.magsrv.com'));
    ok('consent banner shown', await page.locator('#consent').isVisible());
    const btns = await page.locator('#consent [data-consent-choice]').evaluateAll(bs => bs.map(b => {
      const s = getComputedStyle(b); return { cls: b.className, bg: s.backgroundColor, fs: s.fontSize, h: b.offsetHeight };
    }));
    ok('accept and refuse have the same prominence', btns.length === 2 && btns[0].cls === btns[1].cls && btns[0].bg === btns[1].bg && btns[0].fs === btns[1].fs && btns[0].h === btns[1].h, JSON.stringify(btns));
    await sleep(800);
    ok('no third-party request before consent', ctx.foreign.length === 0, ctx.foreign.slice(0, 3).join(' '));
    ok('house placeholder shown while consent is pending', await page.locator('.ad-net .ad-house').first().isVisible());
    ok('ExoClick loader inert until consent', home.includes('<script type="text/plain" data-consent="ads" data-type="application/javascript" async  src="https://a.magsrv.com/ad-provider.js"></script>'));
    ok('ExoClick tag exact (desktop zone)', html.includes('<template data-ad-tpl data-media="desk"><ins class="eas6a97888e2" data-zoneid="1234567"></ins>\n<script>(AdProvider = window.AdProvider || []).push({"serve": {}});</script></template>'));
    ok('ExoClick tag exact (mobile zone)', html.includes('<template data-ad-tpl data-media="mob"><ins class="eas6a97888e10" data-zoneid="7654321"></ins>'));
    ok('Adsterra banner tag exact', html.includes(`atOptions = {\n    'key' : '0123456789abcdef0123456789abcdef',\n    'format' : 'iframe',\n    'height' : 250,\n    'width' : 300,\n    'params' : {}\n  };\n</script>\n<script src="https://www.highperformanceformat.com/0123456789abcdef0123456789abcdef/invoke.js"></script>`));
    ok('custom slot HTML verbatim', html.includes('<div class="cust-ad">custom</div><script>window.__custom = 1;</script>'));
    ok('every live slot labelled "Ad"', await page.evaluate(() => [...document.querySelectorAll('.ad-live.ad-net')].every(a => a.querySelector('.ad-label'))));
    ok('sponsored links labelled + rel sponsored', await page.evaluate(() => { const a = document.querySelector('a.nav-spons'); return !!a && /sponsored/.test(a.rel) && !!a.querySelector('.ad-tag'); }));
    // CSP: origins of the presets + sha256 of every inline script, no unsafe-inline / nonce
    const script = (/script-src ([^;]*)/.exec(csp) || [])[1] || '';
    const missing = inlineHashes(html).filter(h => !script.includes(h));
    ok('CSP allows every inline script by sha256', missing.length === 0, missing.join(' '));
    ok('CSP: preset origins, no unsafe-inline / nonce', script.includes('https://a.magsrv.com') && !/unsafe-inline|nonce-/.test(script), script.slice(0, 200));
    ok('CSP: custom slot origin allowed', csp.includes('https://cdn.custom.example'));
    // 2. refuse
    await page.click('#consent [data-consent-choice="0"]');
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(800);
    ok('refuse: banner gone, still no third-party request', !(await page.locator('#consent').isVisible()) && ctx.foreign.length === 0, ctx.foreign.slice(0, 3).join(' '));
    ok('refuse remembered (tube_consent=0)', (await ctx.cookies()).some(c => c.name === 'tube_consent' && c.value === '0'));
    await ctx.close();

    // 3. accept
    const ctx2 = await ctxOf();
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p2.click('#consent [data-consent-choice="1"]');
    const loaded = await waitFor(async () => ctx2.foreign.some(u => u === 'https://a.magsrv.com/ad-provider.js'), 5000);
    ok('accept: network loader requested (intercepted)', loaded, ctx2.foreign.slice(0, 5).join(' '));
    ok('accept: desktop ExoClick zone mounted, mobile zone not', await p2.evaluate(() => !!document.querySelector('ins.eas6a97888e2[data-zoneid="1234567"]') && !document.querySelector('ins[data-zoneid="7654321"]')));
    ok('accept: house placeholders removed', (await p2.locator('.ad-net .ad-house').count()) === 0);
    ok('accept: no CSP violation', (await cspErrors(p2)).length === 0, (await cspErrors(p2)).join(' | '));
    await p2.screenshot({ path: `${SHOTS}/ads-live-accepted.png` });
    // watch page: custom slot + Adsterra, then the VAST pre-roll through the ExoClick VAST URL (intercepted stubs)
    await p2.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
    ok('accept: custom inline script ran (hash allowed)', await waitFor(() => p2.evaluate(() => window.__custom === 1), 3000));
    ok('accept: Adsterra invoke.js after its atOptions (sequential)', await waitFor(async () => ctx2.foreign.some(u => u.includes('/0123456789abcdef0123456789abcdef/invoke.js')), 3000));
    ok('watch page: no CSP violation', (await cspErrors(p2)).length === 0, (await cspErrors(p2)).join(' | '));
    await p2.click('#bigplay');
    const vastCall = await waitFor(async () => ctx2.foreign.find(u => u.startsWith('https://s.magsrv.com/v1/vast.php?') && u.includes('idzone=4444444')), 6000);
    ok('VAST tag requested with macros filled', !!vastCall && !/\[CACHEBUSTING\]/.test(vastCall), vastCall || '');
    const adSrc = await waitFor(() => p2.evaluate(() => { const a = document.getElementById('advid'); return a && a.currentTime > 0.2 ? a.currentSrc : ''; }), 8000);
    ok('VAST creative plays', adSrc === 'https://cdn.vast.example/ad.mp4', adSrc);
    ok('VAST impression + start tracked', await waitFor(async () => ctx2.foreign.some(u => u.startsWith('https://track.vast.example/imp')) && ctx2.foreign.includes('https://track.vast.example/start'), 4000));
    const canSkip = await waitFor(() => p2.locator('#adskip').isEnabled(), 6000, 200);
    if (canSkip) await p2.click('#adskip');
    ok('VAST skip tracked', canSkip && await waitFor(async () => ctx2.foreign.includes('https://track.vast.example/skip'), 3000));
    ok('main video plays after the ad', await waitFor(() => p2.evaluate(() => document.getElementById('mainvid').currentTime > 0.3), 10000));
    const txt = await (await ctx2.request.get(`${BASE}/ads.txt`)).text();
    ok('/ads.txt lists ads.ads_txt lines', txt.includes('custom.example, 42, DIRECT'), txt.trim().split('\n').slice(-2).join(' | '));
    await ctx2.close();

    // 4. US opt-out: Global Privacy Control signal = refusal, button shows the opted-out state
    const ctx3 = await ctxOf();
    await ctx3.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    const p3 = await ctx3.newPage();
    await p3.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await sleep(800);
    ok('GPC: no banner, no third-party request', !(await p3.locator('#consent').isVisible()) && ctx3.foreign.length === 0, ctx3.foreign.slice(0, 3).join(' '));
    ok('"Do Not Sell or Share" link present (opted out)', (await p3.locator('[data-optout][aria-pressed="true"]').count()) === 1);
    await ctx3.close();
  }

  // ------------------------------------------------ adult: click-through gate ------------------------------------------------
  if (SCEN === 'adult-click' || SCEN === 'adult-sim') {
    const ctx = await ctxOf();
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const gateHtml = await res.text();
    ok('gate served in place of the home page', await page.locator('.gate').isVisible());
    ok('RTA label: meta + Rating header', gateHtml.includes('content="RTA-5042-1996-1400-1577-RTA"') && res.headers().rating === 'RTA-5042-1996-1400-1577-RTA');
    ok('gate page marked <html data-age-gate>', /<html[^>]*\sdata-age-gate/.test(gateHtml));
    ok('gate page: no script, no video, no image, no ad', !/<script|<video|<img|<ins|simads|data-ad-slot/i.test(gateHtml));
    ok('gate page: no third-party request', ctx.foreign.length === 0);
    const media = await ctx.request.get(`${BASE}/media/_house/preroll.mp4`);
    ok('media refused before the gate (nginx)', media.status() === 403, String(media.status()));
    const api = await ctx.request.get(`${BASE}/api/videos/x/comments`);
    ok('API refused before the gate', api.status() === 403);
    for (const k of ['2257', 'dmca', 'report', 'ncii']) {
      const r = await ctx.request.get(`${BASE}/legal/${k}`);
      ok(`/legal/${k} reachable without the gate`, r.status() === 200 && !(await r.text()).includes('class="gate"'));
    }
    ok('NCII page has the removal form', (await (await ctx.request.get(`${BASE}/legal/ncii`)).text()).includes('action="mailto:'));
    ok('2257 page carries the synthetic-content statement', /synthetic|synthétique/i.test(await (await ctx.request.get(`${BASE}/legal/2257`)).text()));
    // pass the gate
    await page.click('.gate .gate-enter');
    if (SCEN === 'adult-sim') {
      ok('sim verifier page shown', await page.locator('[data-sim-result="1"]').isVisible());
      await page.click('[data-sim-result="1"]');
    }
    await page.waitForLoadState('networkidle');
    if (await page.locator('#consent').isVisible().catch(() => false)) await page.click('#consent [data-consent-choice="1"]');
    ok('content after the gate', (await page.locator('.card').count()) > 0);
    const ck = await ctx.cookies();
    const exp = ck.find(c => c.name === 'av_exp'), sig = ck.find(c => c.name === 'av_sig');
    ok('gate cookies are session cookies (no remember-me)', exp && sig && exp.expires === -1 && sig.expires === -1, JSON.stringify(ck.map(c => [c.name, c.expires])));
    ok('av_sig is HttpOnly, av_exp ~1 h ahead', sig?.httpOnly && Number(exp?.value) - Date.now() / 1000 > 3000 && Number(exp?.value) - Date.now() / 1000 <= 3600);
    ok('media served after the gate', (await ctx.request.get(`${BASE}/media/_house/preroll.mp4`, { headers: { range: 'bytes=0-99' } })).status() < 300);
    // cache: the verified page is cached, an unverified visitor still gets the gate
    const r1 = await ctx.request.get(`${BASE}/categories`);
    const r2 = await ctx.request.get(`${BASE}/categories`);
    ok('verified page cached (X-Cache HIT)', r2.headers()['x-cache'] === 'HIT' && !(await r2.text()).includes('class="gate"'), `${r1.headers()['x-cache']} -> ${r2.headers()['x-cache']}`);
    const anon = await browser.newContext({ httpCredentials: auth });
    const ra = await anon.request.get(`${BASE}/categories`);
    ok('cache does not leak the verified page to an unverified visitor', (await ra.text()).includes('class="gate"'), ra.headers()['x-cache']);
    await anon.addCookies([{ name: 'av_exp', value: '9999999999', url: BASE }, { name: 'av_sig', value: 'AAAAAAAAAAAAAAAAAAAAAA', url: BASE }]);
    const rf = await anon.request.get(`${BASE}/categories`);
    ok('forged cookie refused (page + media)', (await rf.text()).includes('class="gate"') && (await anon.request.get(`${BASE}/media/_house/preroll.mp4`)).status() === 403);
    await anon.close();
    // sliding session
    await sleep(1100);
    const rr = await ctx.request.post(`${BASE}/age/refresh`, { headers: { origin: ORIGIN } });
    const exp2 = (await ctx.cookies()).find(c => c.name === 'av_exp');
    ok('POST /age/refresh slides the session', rr.status() === 204 && Number(exp2.value) > Number(exp.value), `${rr.status()} ${exp.value} -> ${exp2?.value}`);
    if (SCEN === 'adult-sim') {
      ok('simulated ad loader present after the gate only', (await (await ctx.request.get(`${BASE}/`)).text()).includes('/simads/static/loader.js'));
      const bad = await ctxOf();
      const pb = await bad.newPage();
      await pb.goto(`${BASE}/`);
      await pb.click('.gate .gate-enter');
      await pb.click('[data-sim-result="0"]');
      await pb.waitForLoadState('networkidle');
      ok('failed verification keeps the gate', (await pb.locator('.gate-err').count()) === 1 && !(await bad.cookies()).some(c => c.name === 'av_sig'));
      await bad.close();
    }
    if (SCEN === 'adult-click') {
      const geo = await browser.newContext({ httpCredentials: auth, extraHTTPHeaders: { 'X-Country': 'KP' } });
      const rg = await geo.request.get(`${BASE}/`);
      ok('geo rule "block" -> 451', rg.status() === 451, String(rg.status()));
      await geo.close();
    }
    await page.screenshot({ path: `${SHOTS}/ads-${SCEN}-after-gate.png` });
    await ctx.close();
  }
} catch (e) {
  ok('e2e-ads ran without exception', false, e.stack || String(e));
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\ne2e-ads (${SCEN || 'no scenario'}): ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
