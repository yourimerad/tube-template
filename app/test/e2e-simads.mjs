// Headless browser check of SimAds, the simulated ad network (ads.mode "sim"); run by test/run-e2e.sh in the
// Playwright image. Skips (exit 0) when the site does not serve /simads (ads.mode is not "sim").
// Env: BASE (site URL), AUTH_USER/AUTH_PASS (basic auth, optional), SHOTS (screenshot dir), LOCALE.
// It resets the SimAds events (POST /simads/reset) and sets the simads_geo / simads_force cookies of its own browser.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:18190').replace(/\/+$/, '');
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.SHOTS || '/shots';
const LOCALE = process.env.LOCALE || 'en-US';
const auth = process.env.AUTH_USER ? { username: process.env.AUTH_USER, password: process.env.AUTH_PASS } : undefined;
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  simads: ${name}${extra ? `  (${extra})` : ''}`);
};
const skip = (name, why) => console.log(`SKIP  simads: ${name}  (${why})`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout = 5000, step = 100) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { last = await fn().catch(() => null); if (last) return last; await sleep(step); }
  return last;
}
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const foreign = new Set();
const cspErrors = [];
const jsErrors = [];
const track = ctx => {
  ctx.on('request', r => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    try { if (new URL(u).origin !== ORIGIN) foreign.add(u); } catch { foreign.add(u); }
  });
  ctx.on('page', p => {
    p.on('console', m => {
      if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text());
      else if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) jsErrors.push(m.text());
    });
    p.on('pageerror', e => jsErrors.push(String(e)));
  });
};
const reportJson = async (req, extra = '') => (await req.get(`${BASE}/simads/report.json?window=1h${extra}`)).json();

try {
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: auth, locale: LOCALE });
  track(desk);
  const probe = await desk.request.get(`${BASE}/simads/static/loader.js`);
  if (probe.status() !== 200) {
    skip('everything', `GET /simads/static/loader.js -> ${probe.status()}: ads.mode is not "sim"`);
    await browser.close();
    process.exit(0);
  }

  // ---------------- reset: same-origin only ----------------
  const evil = await desk.request.post(`${BASE}/simads/reset`, { headers: { Origin: 'http://evil.example' } });
  ok('reset refuses a foreign Origin', evil.status() === 403, `status ${evil.status()}`);
  const good = await desk.request.post(`${BASE}/simads/reset`, { headers: { Origin: ORIGIN, Accept: 'application/json' } });
  ok('reset accepts same origin', good.status() === 200, `status ${good.status()}`);
  let rep = await reportJson(desk.request);
  ok('report empty after reset', rep.totals.impressions === 0 && rep.totals.requests === 0 && rep.totals.pageviews === 0, JSON.stringify(rep.totals).slice(0, 120));

  // ---------------- demo page, desktop, GEO US, forced fill ----------------
  const page = await desk.newPage();
  await page.goto(`${BASE}/simads/geo?c=US&force=fill&r=/simads/demo`, { waitUntil: 'load' });
  ok('GEO redirect lands on the demo', page.url().endsWith('/simads/demo'), page.url());
  const displays = 'ins.simads[data-format="banner"], ins.simads[data-format="native"], ins.simads[data-format="sticky"]';
  const nDisplay = await page.locator(displays).count();
  const filled = await waitFor(async () => {
    const n = await page.locator(`${displays.split(', ').map(s => `${s}[data-simads="filled"]`).join(', ')}`).count();
    return n === nDisplay ? n : null;
  }, 8000);
  ok('loader fills every display zone (banner, native, sticky)', filled === nDisplay && nDisplay >= 9, `${filled}/${nDisplay}`);
  const imgsOk = await waitFor(() => page.evaluate(() => {
    const imgs = [...document.querySelectorAll('ins.simads img.simads-img')];
    return imgs.length && imgs.every(i => i.complete && i.naturalWidth > 0) ? imgs.length : 0;
  }), 5000);
  ok('every creative image loaded (SVG per size)', imgsOk >= 9, `${imgsOk} images`);
  const labels = await page.evaluate(() => [...document.querySelectorAll('ins.simads[data-simads="filled"]')]
    .filter(i => ['banner', 'native', 'sticky'].includes(i.dataset.format)).every(i => /Simulated ad/.test(i.textContent) && [...i.querySelectorAll('.simads-label, .simads-ad')].some(e => /^(Ad\b|Publicité)/.test(e.textContent))));
  ok('every creative says "Ad" and "Simulated ad"', labels);
  const native = await page.locator('ins.simads[data-format="native"] .card.card-ad').first().textContent();
  ok('native ad is a card with "Sponsored"', /Sponsored|Sponsorisé/i.test(native || '') && /Simulated ad/.test(native || ''), (native || '').trim().slice(0, 80));
  const lbW = await page.evaluate(() => document.querySelector('ins[data-zone="leaderboard"] img')?.width);
  ok('desktop leaderboard is 728 wide', lbW === 728, String(lbW));
  const stickyPos = await page.evaluate(() => getComputedStyle(document.querySelector('ins.simads[data-format="sticky"]')).position);
  ok('sticky ad is fixed', stickyPos === 'fixed', stickyPos);
  ok('no interstitial on the first pageview', (await page.locator('.simads-inter').count()) === 0);
  const push = await waitFor(() => page.locator('.simads-push').isVisible(), 7000);
  ok('in-page push appears after its delay', push);
  ok('push labelled', /Simulated ad/.test(await page.locator('.simads-push').textContent()));
  await page.screenshot({ path: `${SHOTS}/simads-demo-desktop.png`, fullPage: true });
  await page.click('.simads-push .simads-x');
  ok('push closable', (await page.locator('.simads-push').count()) === 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500); // viewability: 1 s at >= 50 %

  // popunder: first click anywhere opens one tab (landing), then capped
  const popWait = desk.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await page.click('.sa-intro h1');
  const pop = await popWait;
  if (pop) await pop.waitForLoadState('load').catch(() => {});
  ok('popunder opens a tab on the first click', pop && /\/simads\/landing/.test(pop.url()), pop?.url());
  ok('landing page labelled as fake', pop && /fake advertiser/i.test(await pop.textContent('body')));
  await pop?.close();
  const clickWait = desk.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await page.click('ins[data-zone="sidebar"] a.simads-a');
  const landing = await clickWait;
  if (landing) await landing.waitForLoadState('load').catch(() => {});
  ok('banner click goes through /simads/click to the landing', landing && /\/simads\/landing\?/.test(landing.url()), landing?.url());
  await landing?.close();

  // second pageview: interstitial (data-every=2), popunder capped
  await page.reload({ waitUntil: 'load' });
  const inter = await waitFor(() => page.locator('.simads-inter').isVisible(), 6000);
  ok('interstitial on the 2nd pageview', inter);
  await sleep(400);
  ok('interstitial close usable at once (no forced countdown)', await page.locator('.simads-inter-x').isEnabled());
  await page.screenshot({ path: `${SHOTS}/simads-interstitial.png` });
  await page.click('.simads-inter-x');
  ok('interstitial closed', (await page.locator('.simads-inter').count()) === 0);
  ok('popunder capped on the next pageview', await page.locator('ins[data-format="popunder"][data-simads="capped"]').count() === 1);
  const pop2 = desk.waitForEvent('page', { timeout: 2000 }).catch(() => null);
  await page.click('.sa-intro h1');
  ok('no second popunder within the cap', !(await pop2));

  // ---------------- VAST through the site's ads-vast.js ----------------
  await page.click('#sa-play');
  const playing = await waitFor(() => page.evaluate(() => document.body.dataset.vast === 'playing'), 8000);
  const t0 = await page.evaluate(() => document.getElementById('sa-vid').currentTime);
  await sleep(1200);
  const t1 = await page.evaluate(() => document.getElementById('sa-vid').currentTime);
  ok('VAST InLine pre-roll plays', playing && t1 > t0, `t0=${t0} t1=${t1}`);
  const skipOn = await waitFor(() => page.locator('#sa-skip').isEnabled(), 8000);
  ok('skip enabled after skipoffset', skipOn);
  await page.click('#sa-skip');
  ok('pre-roll skipped', await page.evaluate(() => document.body.dataset.vast === 'skip'));
  await page.click('#sa-play-w');
  const playingW = await waitFor(() => page.evaluate(() => document.body.dataset.vast === 'playing'), 8000);
  ok('VAST Wrapper -> InLine plays', playingW);
  const done = await waitFor(() => page.evaluate(() => document.body.dataset.vast === 'complete'), 20000, 250);
  ok('wrapper pre-roll plays to the end', done, await page.evaluate(() => document.body.dataset.vast));

  const wrapXml = await (await desk.request.get(`${BASE}/simads/vast?zone=preroll&wrapper=1`)).text();
  const inner = /<VASTAdTagURI><!\[CDATA\[(.*?)\]\]><\/VASTAdTagURI>/.exec(wrapXml)?.[1];
  ok('wrapper XML: VAST 4.2 Wrapper + VASTAdTagURI', /<VAST version="4\.2"/.test(wrapXml) && /<Wrapper/.test(wrapXml) && !!inner);
  const inXml = inner ? await (await desk.request.get(inner)).text() : '';
  ok('inline XML: Linear, skipoffset, MediaFile mp4, tracking, ClickThrough', /<InLine>/.test(inXml) && /skipoffset="00:00:0\d"/.test(inXml)
    && /<MediaFile[^>]+type="video\/mp4"/.test(inXml) && ['start', 'firstQuartile', 'midpoint', 'thirdQuartile', 'complete', 'skip'].every(e => inXml.includes(`event="${e}"`))
    && /<ClickThrough[^>]*><!\[CDATA\[[^\]]*\/simads\/click\?/.test(inXml));
  await desk.request.get(`${BASE}/simads/geo?force=nofill`);
  const noXml = await (await desk.request.get(`${BASE}/simads/vast?zone=preroll`)).text();
  ok('no-fill = empty VAST 4.2', /<VAST version="4\.2"/.test(noXml) && !/<Ad[\s>]/.test(noXml));
  const noServe = await (await desk.request.get(`${BASE}/simads/serve?zone=t&format=banner&size=300x250`)).json();
  ok('no-fill banner', noServe.fill === false);
  await desk.request.get(`${BASE}/simads/geo?force=fill`);

  // ---------------- GEO changes the eCPM ----------------
  const avg = async c => {
    await desk.request.get(`${BASE}/simads/geo?c=${c}`);
    let s = 0;
    for (let i = 0; i < 25; i++) s += (await (await desk.request.get(`${BASE}/simads/serve?zone=geo_test&format=banner&size=300x250`)).json()).ecpm || 0;
    return s / 25;
  };
  const us = await avg('US'), fr = await avg('FR'), inn = await avg('IN');
  ok('eCPM US > FR > IN', us > fr && fr > inn && us > 3 * inn, `US ${us.toFixed(3)} FR ${fr.toFixed(3)} IN ${inn.toFixed(3)}`);
  await desk.request.get(`${BASE}/simads/geo?c=US`);

  // ---------------- mobile ----------------
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    httpCredentials: auth, locale: LOCALE, userAgent: MOBILE_UA });
  track(mob);
  const m = await mob.newPage();
  await m.goto(`${BASE}/simads/geo?c=FR&force=fill&r=/simads/demo`, { waitUntil: 'load' });
  const mlb = await waitFor(() => m.evaluate(() => document.querySelector('ins[data-zone="leaderboard"] img')?.width), 6000);
  ok('mobile leaderboard uses data-mobile-size 320x50', mlb === 320, String(mlb));
  ok('mobile sticky filled', await waitFor(() => m.locator('ins[data-format="sticky"][data-simads="filled"]').count(), 5000));
  await sleep(1500);
  await m.screenshot({ path: `${SHOTS}/simads-demo-mobile.png` });

  // ---------------- loader inert on the age gate ----------------
  const gp = await desk.newPage();
  await gp.goto(`${BASE}/simads/landing`, { waitUntil: 'load' });
  const gate = await gp.evaluate(async () => {
    document.documentElement.setAttribute('data-age-gate', '');
    const ins = document.createElement('ins');
    ins.className = 'simads';
    ins.dataset.zone = 'gate_test';
    ins.dataset.format = 'banner';
    ins.dataset.size = '300x250';
    document.body.append(ins);
    const s = document.createElement('script');
    s.src = '/simads/static/loader.js';
    document.head.append(s);
    await new Promise(r => setTimeout(r, 1500));
    return { loaded: !!window.SimAds, state: ins.dataset.simads || '' };
  });
  ok('loader does nothing on the age-gate page', gate.loaded && gate.state === '', JSON.stringify(gate));
  await gp.close();

  // ---------------- real site pages (only when the engine renders sim tags) ----------------
  const real = await desk.newPage();
  await real.goto(`${BASE}/`, { waitUntil: 'load' });
  // sim mode shows the consent banner like live mode: ad scripts stay inert until "Accept"
  if (await real.locator('#consent').isVisible().catch(() => false)) await real.click('#consent [data-consent-choice="1"]');
  const nReal = await real.locator('ins.simads').count();
  if (!nReal) skip('real pages carry ins.simads', 'home has no ins.simads (age gate, consent or ads.mode)');
  else {
    ok('home loads the sim loader', await real.locator('script[src*="/simads/static/loader.js"]').count() >= 1);
    const settled = await waitFor(() => real.evaluate(() => [...document.querySelectorAll('ins.simads')]
      .every(i => ['filled', 'nofill', 'capped', 'opened'].includes(i.dataset.simads) || ['interstitial', 'inpage_push'].includes(i.dataset.format))), 8000);
    const nFilled = await real.locator('ins.simads[data-simads="filled"]').count();
    ok('home sim zones filled by the loader', settled && nFilled >= 1, `${nFilled}/${nReal} filled`);
    await real.screenshot({ path: `${SHOTS}/simads-home.png`, fullPage: true });
    const href = await real.locator('.grid .card[data-preview] a.thumb').first().getAttribute('href').catch(() => null);
    if (href) {
      await real.goto(`${BASE}${href}`, { waitUntil: 'load' });
      const nv = await real.locator('ins.simads').count();
      const fv = await waitFor(async () => real.locator('ins.simads[data-simads="filled"]').count(), 6000);
      ok('video page sim zones filled', nv === 0 || fv >= 1, `${fv}/${nv}`);
    }
  }
  await real.close();

  // ---------------- report ----------------
  await sleep(1500); // the server flushes events every second (report.json flushes too)
  rep = await reportJson(desk.request, '&events=5000');
  const T = rep.totals;
  const imps = rep.events.filter(e => e.ev === 'imp');
  const sumMicros = imps.reduce((s, e) => s + e.price_micros, 0);
  ok('beacons in the DB: pageviews, visits, impressions, views, clicks', T.pageviews >= 3 && T.visits >= 2 && T.impressions >= 10 && T.viewable >= 5 && T.clicks >= 1,
    `pv ${T.pageviews} visits ${T.visits} imp ${T.impressions} view ${T.viewable} clicks ${T.clicks}`);
  ok('revenue = sum of impression prices', T.revenue_micros === sumMicros && Math.abs(T.revenue - sumMicros / 1e6) < 1e-9 && imps.length === T.impressions,
    `revenue ${T.revenue} vs ${sumMicros / 1e6} (${imps.length} imp events)`);
  ok('eCPM / RPM consistent', Math.abs(T.ecpm - (T.revenue / T.impressions) * 1000) < 1e-3 && Math.abs(T.rpm_pageviews - (T.revenue / T.pageviews) * 1000) < 1e-3,
    `ecpm ${T.ecpm} rpm ${T.rpm_pageviews}`);
  ok('fill <= requests', T.filled <= T.requests && T.fill_rate <= 1, `${T.filled}/${T.requests}`);
  const fmt = Object.fromEntries(rep.by_format.map(r => [r.key, r]));
  ok('every format has impressions', ['banner', 'native', 'sticky', 'popunder', 'interstitial', 'inpage_push', 'vast'].every(f => fmt[f]?.impressions >= 1),
    rep.by_format.map(r => `${r.key}:${r.impressions}`).join(' '));
  ok('closes logged (push + interstitial)', T.closes >= 2, String(T.closes));
  ok('video funnel: start, q1, skip, complete', T.video.start >= 2 && T.video.q1 >= 1 && T.video.skip >= 1 && T.video.complete >= 1, JSON.stringify(T.video));
  const dev = rep.by_device.map(r => r.key).sort().join(',');
  ok('by device: desktop + mobile', dev === 'desktop,mobile', dev);
  const geos = rep.by_geo.map(r => r.key);
  ok('by GEO has US and FR', geos.includes('US') && geos.includes('FR'), geos.join(','));
  const sumZones = rep.by_zone.reduce((s, r) => s + r.revenue_micros, 0);
  ok('zones add up to the total', sumZones === T.revenue_micros, `${sumZones} vs ${T.revenue_micros}`);
  // replayed beacon does not count twice
  const one = imps[0];
  if (one) {
    const xml = await (await desk.request.get(`${BASE}/simads/vast?zone=preroll`)).text();
    const impUrl = /<Impression[^>]*><!\[CDATA\[(.*?)\]\]>/.exec(xml)?.[1];
    if (impUrl) { await desk.request.get(impUrl); await desk.request.get(impUrl); }
    const after = await reportJson(desk.request);
    ok('a replayed impression beacon counts once', after.totals.impressions === T.impressions + (impUrl ? 1 : 0), `${T.impressions} -> ${after.totals.impressions}`);
    const forged = await desk.request.get(`${BASE}/simads/e?ev=imp&a=eyJpIjoiZm9yZ2VkIn0.AAAAAAAAAAAAAAAAAAAAAA`);
    const after2 = await reportJson(desk.request);
    ok('a forged token is not counted', forged.status() === 204 && after2.totals.impressions === after.totals.impressions);
  }

  const rp = await desk.newPage();
  await rp.goto(`${BASE}/simads/report?window=1h`, { waitUntil: 'load' });
  ok('report page renders totals', /Simulated revenue/.test(await rp.textContent('body')));
  const day = await waitFor(() => rp.locator('#sa-proj-out').getAttribute('data-day'), 5000);
  ok('projection calculator computes $/day', Number(day) > 0, `$${day}/day for the default profile`);
  await rp.fill('input[name="visitors"]', '20000');
  await rp.locator('input[name="visitors"]').dispatchEvent('change');
  const day2 = await waitFor(async () => { const d = await rp.locator('#sa-proj-out').getAttribute('data-day'); return Number(d) > Number(day) * 10 ? d : null; }, 5000);
  ok('projection scales with visitors', !!day2, `${day} -> ${day2}`);
  const usOnly = await (await desk.request.get(`${BASE}/simads/projection?visitors=1000&g_US=1`)).json();
  const frOnly = await (await desk.request.get(`${BASE}/simads/projection?visitors=1000&g_FR=1`)).json();
  ok('projection: FR traffic earns less than US', frOnly.revenue_day < usOnly.revenue_day * 0.6, `US $${usOnly.revenue_day}/day, FR $${frOnly.revenue_day}/day`);
  await rp.screenshot({ path: `${SHOTS}/simads-report.png`, fullPage: true });
  await rp.click('.sa-reset button');
  await rp.waitForLoadState('load');
  rep = await reportJson(desk.request);
  ok('reset button empties the report', rep.totals.impressions === 0 && rep.totals.pageviews <= 1, JSON.stringify(rep.totals).slice(0, 100));

  ok('no request left the site origin', foreign.size === 0, [...foreign].slice(0, 5).join(' '));
  ok('no CSP violation', cspErrors.length === 0, cspErrors.slice(0, 3).join(' | '));
  ok('no JS errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
  await desk.request.get(`${BASE}/simads/geo?c=auto&force=`);
  await mob.close();
  await desk.close();
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.pass);
console.log(`\nsimads: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
