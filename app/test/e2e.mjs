// Headless browser check of the real UI (run inside mcr.microsoft.com/playwright, see test/run-e2e.sh).
// Env: BASE (site URL), AUTH_USER/AUTH_PASS (basic auth, optional), SHOTS (screenshot dir),
//      VIDEO_PATH (/v/<id>/<slug> to test; default = first card on home),
//      LOCALE (browser locale, e.g. fr-FR / en-US), LABEL_TEXT (content label expected on video pages, '' = none),
//      EXPECT_CATS (number of category tiles), EXPECT_STICKY=0|1, EXPECT_PREROLL=0|1 (default 1 each).
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:18190';
const SHOTS = process.env.SHOTS || '/shots';
const LOCALE = process.env.LOCALE || 'en-US';
const LABEL_TEXT = process.env.LABEL_TEXT ?? '';
const EXPECT_CATS = process.env.EXPECT_CATS ? Number(process.env.EXPECT_CATS) : null;
const EXPECT_STICKY = process.env.EXPECT_STICKY !== '0';
const EXPECT_PREROLL = process.env.EXPECT_PREROLL !== '0';
const auth = process.env.AUTH_USER ? { username: process.env.AUTH_USER, password: process.env.AUTH_PASS } : undefined;
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// All <video> elements currently playing (not paused, time advancing or ready).
const playingVideos = page => page.evaluate(() => [...document.querySelectorAll('video')]
  .filter(v => !v.paused && !v.ended && v.readyState >= 2)
  .map(v => ({ src: v.currentSrc || v.src, cls: v.className, t: v.currentTime })));

async function waitFor(fn, timeout = 5000, step = 100) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(step); }
  return last;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  // ---------------- desktop home + hover preview ----------------
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: auth, locale: LOCALE });
  const page = await desk.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/home-desktop-1440-viewport.png` });
  if (EXPECT_STICKY) {
    ok('sticky ad bar shown', await page.locator('#adbar').isVisible());
    await page.click('#adbar .adbar-x');
    ok('sticky ad bar closable', await page.locator('#adbar').isHidden());
  } else ok('no sticky ad bar', (await page.locator('#adbar').count()) === 0);
  const docLang = await page.evaluate(() => document.documentElement.lang);
  ok('html lang matches the site language', LOCALE.startsWith(docLang), docLang);
  await page.screenshot({ path: `${SHOTS}/home-desktop-1440.png`, fullPage: true });
  const cards = page.locator('.grid .card[data-preview]');
  const nCards = await cards.count();
  ok('home renders video cards', nCards >= 2, `${nCards} cards`);
  ok('no <video> before hover', (await page.locator('video').count()) === 0);

  const hoverCard = async i => {
    const box = await cards.nth(i).locator('.thumb').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  };
  await hoverCard(0);
  await sleep(250);
  ok('no preview before 500 ms', (await page.locator('video').count()) === 0);
  await sleep(450); // 700 ms total
  const p0 = await waitFor(async () => { const v = await playingVideos(page); return v.length ? v : null; }, 3000);
  const src0 = await cards.nth(0).getAttribute('data-preview');
  ok('hover 700 ms -> exactly one preview playing', p0 && p0.length === 1 && p0[0].src.endsWith(src0), JSON.stringify(p0));
  await page.screenshot({ path: `${SHOTS}/home-hover-preview.png`, clip: { x: 0, y: 0, width: 1440, height: 700 } });

  await hoverCard(1);
  await sleep(700);
  const p1 = await waitFor(async () => { const v = await playingVideos(page); return v.length === 1 && !v[0].src.endsWith(src0) ? v : null; }, 3000);
  const src1 = await cards.nth(1).getAttribute('data-preview');
  ok('moving to card 2 -> its preview plays', p1 && p1.length === 1 && p1[0].src.endsWith(src1), JSON.stringify(p1));
  ok('first preview stopped and unloaded', (await cards.nth(0).locator('video').count()) === 0 && (await page.locator('video').count()) === 1);
  await page.mouse.move(5, 5);
  await sleep(200);
  ok('leaving the card stops the preview', (await page.locator('video').count()) === 0);
  if (EXPECT_STICKY) ok('native ad / placeholder ad slots present', (await page.locator('[data-ad-slot]').count()) >= 2);
  ok('no JS errors on home', errors.length === 0, errors.join(' | '));

  // ---------------- categories ----------------
  await page.goto(`${BASE}/categories`, { waitUntil: 'networkidle' });
  const nCats = await page.locator('.cat-tile').count();
  ok('categories tiles', EXPECT_CATS === null ? nCats >= 1 : nCats === EXPECT_CATS, `${nCats} tiles: ${(await page.locator('.cat-tile .cat-name').allTextContents()).join(' | ')}`);
  await page.screenshot({ path: `${SHOTS}/categories-desktop-1440.png`, fullPage: true });

  // ---------------- video page ----------------
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const vpath = process.env.VIDEO_PATH || await cards.nth(0).locator('h3 a').getAttribute('href');
  const vid = vpath.split('/')[2];
  await page.goto(`${BASE}${vpath}`, { waitUntil: 'networkidle' });
  if (LABEL_TEXT) ok('content label visible', await page.locator('.ia-label', { hasText: LABEL_TEXT }).isVisible());
  else ok('no content label', (await page.locator('.ia-label').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/video-desktop-1440.png`, fullPage: true });
  await page.click('#bigplay');
  if (EXPECT_PREROLL) {
    const adPlaying = await waitFor(() => page.evaluate(() => {
      const a = document.getElementById('advid');
      return !document.getElementById('adlayer').hidden && a && !a.paused && a.currentTime > 0.2 && a.currentSrc.includes('/_house/preroll.mp4');
    }), 6000);
    ok('pre-roll plays', adPlaying);
    ok('skip disabled at start', await page.locator('#adskip').isDisabled());
    await page.screenshot({ path: `${SHOTS}/video-preroll.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
    const skippable = await waitFor(() => page.locator('#adskip').isEnabled(), 8000, 200);
    ok('skip enabled after 5 s', skippable, await page.locator('#adskip').textContent());
    await page.click('#adskip');
  }
  const t0 = await waitFor(() => page.evaluate(() => { const v = document.getElementById('mainvid'); return v.currentTime > 0.3 ? v.currentTime : 0; }), 10000);
  await sleep(1500);
  const t1 = await page.evaluate(() => document.getElementById('mainvid').currentTime);
  const mainInfo = await page.evaluate(() => { const v = document.getElementById('mainvid'); return { paused: v.paused, src: v.currentSrc, w: v.videoWidth, h: v.videoHeight }; });
  ok('HLS main video plays (currentTime advancing)', t0 > 0 && t1 > t0 + 0.5, `t0=${t0} t1=${t1} ${JSON.stringify(mainInfo)}`);
  ok('ad layer hidden after skip', await page.locator('#adlayer').isHidden());
  const qItems = await page.locator('#qsel').isVisible() ? (await page.click('#qbtn'), await page.locator('#qmenu button').allTextContents()) : [];
  ok('quality selector lists auto + rungs', qItems.length >= 2 && /auto/i.test(qItems[0]), JSON.stringify(qItems));
  if (qItems.length >= 2) {
    await page.locator('#qmenu button').nth(qItems.length - 1).click();
    await sleep(1500);
    const lvl = await page.evaluate(() => { const v = document.getElementById('mainvid'); return { h: v.videoHeight, w: v.videoWidth, t: v.currentTime }; });
    ok('manual quality switch keeps playing', lvl.t > t1, JSON.stringify(lvl));
  }
  await page.evaluate(() => { const v = document.getElementById('mainvid'); v.volume = 0.35; });
  await page.screenshot({ path: `${SHOTS}/video-playing.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });

  // comment + vote
  const stamp = `e2e test ${Date.now()} <b>no html</b> https://example.invalid`;
  await page.fill('#cmt-form input[name=author]', 'Tester');
  await page.fill('#cmt-form textarea[name=body]', stamp);
  await page.click('#cmt-form button[type=submit]');
  const posted = await waitFor(() => page.locator('#cmt-list .cmt-body', { hasText: stamp }).count(), 4000);
  ok('comment posted and rendered as text', posted === 1 && (await page.locator('#cmt-list b, #cmt-list a').count()) === 0);
  await page.click('.vbtn-up');
  await waitFor(() => page.locator('.vbtn-up[aria-pressed="true"]').count(), 3000);
  await page.locator('#cmt-list .cmt-up').first().click();
  await sleep(500);
  const st = await page.request.get(`${BASE}/api/videos/${vid}/state`);
  const state = await st.json();
  ok('API state: vote=1, likes>=1, views>=1, comments>=1', state.vote === 1 && state.likes >= 1 && state.views >= 1 && state.comments >= 1, JSON.stringify(state));
  const cm = await (await page.request.get(`${BASE}/api/videos/${vid}/comments?sort=popular`)).json();
  ok('comment upvote counted', cm.comments.some(c => c.body === stamp.trim() && c.upvotes === 1), `${cm.count} comments`);
  // change vote to dislike then remove
  await page.click('.vbtn-down');
  await sleep(500);
  const st2 = await (await page.request.get(`${BASE}/api/videos/${vid}/state`)).json();
  ok('vote changeable (like -> dislike)', st2.vote === -1 && st2.likes === state.likes - 1 && st2.dislikes >= 1, JSON.stringify(st2));
  await page.reload({ waitUntil: 'networkidle' });
  const vol = await page.evaluate(() => localStorage.getItem('tp-vol'));
  ok('volume remembered in localStorage', vol === '0.35', vol);
  ok('own vote restored after reload', await waitFor(() => page.locator('.vbtn-down[aria-pressed="true"]').count(), 3000));
  ok('no JS errors overall (desktop)', errors.length === 0, errors.join(' | '));
  await desk.close();

  // ---------------- mobile ----------------
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    httpCredentials: auth, locale: LOCALE,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  const m = await mob.newPage();
  await m.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await m.screenshot({ path: `${SHOTS}/home-mobile-390.png`, fullPage: true });
  await m.evaluate(() => window.scrollTo(0, 250));
  await sleep(1300);
  const mp = await waitFor(async () => { const v = await playingVideos(m); return v.length ? v : null; }, 3000);
  ok('touch: centred card autoplays its preview after 500 ms still', mp && mp.length === 1 && mp[0].src.endsWith('preview.mp4'), JSON.stringify(mp));
  await m.screenshot({ path: `${SHOTS}/home-mobile-390-preview.png` });
  await m.goto(`${BASE}/categories`, { waitUntil: 'networkidle' });
  await m.screenshot({ path: `${SHOTS}/categories-mobile-390.png`, fullPage: true });
  await m.goto(`${BASE}${vpath}`, { waitUntil: 'networkidle' });
  await m.screenshot({ path: `${SHOTS}/video-mobile-390.png`, fullPage: true });
  await mob.close();
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
