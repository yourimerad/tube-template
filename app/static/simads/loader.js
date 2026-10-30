// SimAds loader: the async tag of the simulated ad network (ads.mode = "sim").
//   <script async src="{S}/simads/static/loader.js" data-audience="general|adult"></script>
//   <ins class="simads" data-zone="leaderboard" data-format="banner|native|sticky|popunder|interstitial|inpage_push"
//        data-size="728x90" data-mobile-size="320x50" data-cap-hours="24" [data-every="3"] [data-delay="4"]></ins>
// Finds every ins.simads (also ones added later), asks {S}/simads/serve for each and renders the creative or runs
// the behaviour. Beacons: pv, imp, view (>= 50% visible for 1 s), close; clicks go through {S}/simads/click.
// Vanilla JS, no inline style (CSP): styles come from simads.css, sizes are set through CSSOM.
(() => {
  'use strict';
  if (window.SimAds) return;
  const me = document.currentScript || document.querySelector('script[src*="/simads/static/loader.js"]');
  const S = me ? new URL(me.src, location.href).origin : location.origin;
  const AU = me?.dataset.audience === 'adult' ? 'adult' : 'general';
  const cross = S !== location.origin;
  const MOBILE_W = 768;

  // ---------- small helpers ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
  };
  const getCookie = k => (document.cookie.match(new RegExp(`(?:^|; )${k}=([^;]*)`)) || [])[1] || '';
  const beacon = (ev, tok, extra = '') => {
    const url = `${S}/simads/e?ev=${ev}${tok ? `&a=${encodeURIComponent(tok)}` : ''}&au=${AU}${extra}`;
    try { new Image().src = url; } catch (_) { /* ignore */ }
  };
  const beaconNow = (ev, tok) => { // survives navigation (closing a tab right after "close")
    const url = `${S}/simads/e?ev=${ev}&a=${encodeURIComponent(tok)}`;
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    beacon(ev, tok);
  };
  async function serve(ins, format, size) {
    const qs = new URLSearchParams({ zone: ins.dataset.zone || format, format, size: size || '', w: String(window.innerWidth), au: AU });
    try {
      const r = await fetch(`${S}/simads/serve?${qs}`, { credentials: cross ? 'include' : 'same-origin', cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }
  const sizeOf = ins => (window.innerWidth < MOBILE_W && ins.dataset.mobileSize ? ins.dataset.mobileSize : ins.dataset.size) || '300x250';
  const label = ad => el('span', 'simads-label', `${ad.ad || 'Ad'} · ${ad.label || 'Simulated ad'}`);
  const link = (ad, cls) => {
    const a = el('a', cls);
    a.href = ad.click;
    a.target = '_blank';
    a.rel = 'noopener sponsored nofollow';
    a.setAttribute('aria-label', `${ad.ad || 'Ad'}: ${ad.advertiser} (${ad.label})`);
    return a;
  };
  const img = (ad, w, h) => { const i = el('img', 'simads-img'); i.src = ad.img; i.width = w; i.height = h; i.alt = `${ad.label}: ${ad.advertiser}`; i.decoding = 'async'; return i; };
  const mark = (ins, ad) => {
    ins.dataset.simads = ad && ad.fill ? 'filled' : 'nofill';
    if (ad && ad.fill) { ins.dataset.simadsEcpm = String(ad.ecpm); ins.dataset.simadsAid = ad.aid; }
    ins.classList.add(ad && ad.fill ? 'simads-filled' : 'simads-nofill');
  };

  // ---------- viewability: >= 50 % in view for 1 s, page visible ----------
  const timers = new WeakMap();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const e of entries) {
      const t = e.target;
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        if (!timers.has(t)) timers.set(t, setTimeout(() => {
          if (document.visibilityState !== 'visible') { timers.delete(t); return; }
          io.unobserve(t);
          beacon('view', t.dataset.simadsTok);
        }, 1000));
      } else if (timers.has(t)) { clearTimeout(timers.get(t)); timers.delete(t); }
    }
  }, { threshold: [0, 0.5, 1] }) : null;
  const watch = (node, ad) => { node.dataset.simadsTok = ad.token; if (io) io.observe(node); };
  const impression = (node, ad) => { beacon('imp', ad.token); watch(node, ad); };

  // ---------- formats ----------
  function banner(ins, ad, host = ins) {
    const box = el('div', 'simads-box');
    box.style.width = `${ad.w}px`;
    box.style.aspectRatio = `${ad.w} / ${ad.h}`;
    const a = link(ad, 'simads-a');
    const i = img(ad, ad.w, ad.h);
    a.append(i);
    box.append(a, label(ad));
    host.replaceChildren(box);
    i.addEventListener('load', () => impression(box, ad), { once: true });
    return box;
  }

  function native(ins, ad) {
    const card = el('div', 'card card-ad simads-native');
    const th = link(ad, 'thumb thumb-ad simads-thumb');
    th.append(img(ad, 640, 360), el('span', 'b-dur simads-ad', ad.ad || 'Ad'));
    const h = el('h3', 'title');
    const ta = link(ad, '');
    ta.textContent = ad.title;
    h.append(ta);
    const meta = el('div', 'meta');
    meta.append(el('span', 'ad-spons', ad.sponsored || 'Sponsored'), el('span', '', ad.advertiser), el('span', 'simads-sim', ad.label));
    card.append(th, h, meta);
    ins.replaceChildren(card);
    th.querySelector('img').addEventListener('load', () => impression(card, ad), { once: true });
  }

  function closeBtn(ad, onClose) {
    const b = el('button', 'simads-x', '×');
    b.type = 'button';
    b.setAttribute('aria-label', ad.close || 'Close ad');
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); beaconNow('close', ad.token); onClose(); });
    return b;
  }

  function sticky(ins, ad) {
    const bar = ins.closest('.adbar');
    if (bar) { // the site's own closable bar: render inside it and show it
      banner(ins, ad);
      bar.hidden = false;
      bar.querySelector('.adbar-x')?.addEventListener('click', () => beaconNow('close', ad.token), { once: true });
      return;
    }
    ins.classList.add('simads-sticky');
    const inner = el('div', 'simads-sticky-in');
    ins.replaceChildren(inner);
    banner(ins, ad, inner);
    inner.append(closeBtn(ad, () => ins.remove()));
    document.documentElement.classList.add('simads-has-sticky');
  }

  // Popunder: one new tab on the first user click anywhere, then capped for data-cap-hours (localStorage + cookie).
  function popCapped(zone, hours) {
    const at = Number(store.get(`simads_pop_${zone}`) || 0);
    return getCookie(`simads_pop_${zone}`) === '1' || (at && Date.now() - at < hours * 3600e3);
  }
  async function popunder(ins) {
    const zone = ins.dataset.zone || 'popunder';
    const hours = Math.max(0.01, Number(ins.dataset.capHours) || 24);
    if (popCapped(zone, hours)) { ins.dataset.simads = 'capped'; return; }
    const ad = await serve(ins, 'popunder', '');
    mark(ins, ad);
    if (!ad || !ad.fill) return;
    const onClick = e => {
      // any click on the page, except on SimAds' own UI (close buttons, push, interstitial, other zones)
      if (!e.isTrusted || popCapped(zone, hours) || e.target.closest?.('ins.simads, .simads-push, .simads-inter')) return;
      document.removeEventListener('click', onClick, true);
      store.set(`simads_pop_${zone}`, String(Date.now()));
      document.cookie = `simads_pop_${zone}=1; Path=/; Max-Age=${Math.round(hours * 3600)}; SameSite=Lax`;
      window.open(ad.click, '_blank', 'noopener'); // the opened click URL logs the popunder impression
      ins.dataset.simads = 'opened';
    };
    document.addEventListener('click', onClick, true);
  }

  // Interstitial: full-screen overlay with a countdown close, never on the first pageview, max 1 per N pageviews.
  let PVN = 0; // pageviews with zones, counted once per page by startOnce()
  async function interstitial(ins) {
    const zone = ins.dataset.zone || 'interstitial';
    const every = Math.max(1, Number(ins.dataset.every) || 3);
    const last = Number(store.get(`simads_int_${zone}`) || 0);
    if (PVN < 2 || (last && PVN - last < every && PVN > last)) { ins.dataset.simads = 'capped'; return; }
    const ad = await serve(ins, 'interstitial', '300x250');
    mark(ins, ad);
    if (!ad || !ad.fill) return;
    store.set(`simads_int_${zone}`, String(PVN));
    const ov = el('div', 'simads-inter');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', `${ad.ad || 'Ad'} (${ad.label})`);
    const box = el('div', 'simads-inter-box');
    const head = el('div', 'simads-inter-head');
    // Close works from 0 s (Better Ads Standards: no forced countdown); the countdown only auto-closes the ad.
    const btn = el('button', 'simads-inter-x', '×');
    btn.type = 'button';
    btn.setAttribute('aria-label', ad.close || 'Close ad');
    let left = 8;
    const count = el('span', 'simads-inter-count', `${left}`);
    count.setAttribute('aria-hidden', 'true');
    head.append(label(ad), count, btn);
    const a = link(ad, 'simads-inter-a');
    const i = img(ad, 300, 250);
    a.append(i, el('b', '', ad.title), el('span', '', ad.text));
    box.append(head, a);
    ov.append(box);
    const prevFocus = document.activeElement;
    let tick = 0;
    const close = () => {
      if (!ov.isConnected) return;
      clearInterval(tick);
      beaconNow('close', ad.token);
      ov.remove();
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('simads-lock');
      prevFocus?.focus?.();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    btn.addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    tick = setInterval(() => { left--; if (left > 0) count.textContent = `${left}`; else close(); }, 1000);
    document.body.append(ov);
    document.documentElement.classList.add('simads-lock');
    btn.focus();
    impression(box, ad);
  }

  // In-page push: a notification-like toast bottom-right after a few seconds, closable, one per page.
  async function inpagePush(ins) {
    const delay = Math.max(0, Number(ins.dataset.delay ?? 4)) * 1000;
    const zone = ins.dataset.zone || 'inpage_push';
    const hours = Number(ins.dataset.capHours) || 0;
    if (hours && Date.now() - Number(store.get(`simads_push_${zone}`) || 0) < hours * 3600e3) { ins.dataset.simads = 'capped'; return; }
    await new Promise(r => setTimeout(r, delay));
    const ad = await serve(ins, 'inpage_push', '');
    mark(ins, ad);
    if (!ad || !ad.fill) return;
    if (hours) store.set(`simads_push_${zone}`, String(Date.now()));
    const toast = el('div', 'simads-push');
    toast.setAttribute('role', 'complementary');
    toast.setAttribute('aria-label', `${ad.ad || 'Ad'} (${ad.label})`);
    const a = link(ad, 'simads-push-a');
    const i = img(ad, 96, 54);
    const txt = el('span', 'simads-push-txt');
    txt.append(el('b', '', ad.title), el('span', '', ad.text), label(ad));
    a.append(i, txt);
    toast.append(a, closeBtn(ad, () => toast.remove()));
    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add('on'));
    impression(toast, ad);
  }

  // ---------- scan ----------
  async function run(ins) {
    if (ins.dataset.simads) return;
    ins.dataset.simads = 'loading';
    const format = ins.dataset.format || 'banner';
    try {
      if (format === 'popunder') return await popunder(ins);
      if (format === 'interstitial') return await interstitial(ins);
      if (format === 'inpage_push') return await inpagePush(ins);
      const size = format === 'native' ? '' : sizeOf(ins);
      const ad = await serve(ins, format, size);
      mark(ins, ad);
      if (!ad || !ad.fill) return;
      if (format === 'native') native(ins, ad);
      else if (format === 'sticky') sticky(ins, ad);
      else banner(ins, ad);
    } catch (_) { ins.dataset.simads = 'error'; }
  }
  const scan = root => (root.matches?.('ins.simads') ? [root] : [...(root.querySelectorAll?.('ins.simads') || [])]).forEach(run);

  // Inert on the age-gate page, and until the page has at least one zone (no pageview beacon either).
  let started = false;
  function startOnce() {
    if (started) return;
    started = true;
    PVN = (Number(store.get('simads_pvn')) || 0) + 1;
    store.set('simads_pvn', String(PVN));
    const css = document.createElement('link'); // the stylesheet comes with the tag, like a real network's
    css.rel = 'stylesheet';
    css.href = `${S}/simads/static/simads.css`;
    if (!document.querySelector(`link[href="${css.href}"], link[href="/simads/static/simads.css"]`)) document.head.append(css);
    beacon('pv', '');
  }
  const hasZones = root => root.matches?.('ins.simads') || !!root.querySelector?.('ins.simads');
  function boot() {
    if (document.documentElement.hasAttribute('data-age-gate')) return;
    if (hasZones(document)) { startOnce(); scan(document); }
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && hasZones(n)) { startOnce(); scan(n); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.SimAds = { version: 1, origin: S, audience: AU, scan: () => scan(document) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
