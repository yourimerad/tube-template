// VAST pre-roll (IAB VAST 2.0 - 4.3, linear video ads, no VPAID / SIMID / OMID).
//   const provider = TubeAds.provider(cfg);  // cfg = player-cfg: { adsMode, preroll, vastUrl, vastNetwork, consent, skipAfter }
//   const ad = await provider.getPreroll();  // null -> no ad
//   ad = { src, skipAfter (null = not skippable), duration, clickThrough, track(event), bind(videoEl) }
// Sources: cfg.vastUrl (network preset VAST tag, sim network, or ads.vast_url) -> InLine or Wrapper chain (max 5
// hops), Impression + Error + TrackingEvents (start, quartiles, complete, skip, pause/resume, mute/unmute,
// progress offsets) + ClickTracking accumulated across wrappers; first progressive MP4 MediaFile closest to the
// player size. No fill / error -> the URLs of <Error> are pinged with [ERRORCODE] and the house pre-roll
// (MEDIA_BASE/_house/preroll.mp4, ads.house_preroll) plays instead, if enabled.
// Macros filled in the tag URL and in every tracking URL: [CACHEBUSTING] [TIMESTAMP] [PAGEURL] [DOMAIN]
// [REFERRER] [WIDTH] [HEIGHT] [UA] [ERRORCODE] [CONTENTPLAYHEAD] [ADPLAYHEAD] [MEDIAPLAYHEAD] [ASSETURI]
// [LIMITADTRACKING]. Consent: a third-party tag is only called once window.TubeConsent.state is "granted"
// (static/js/ads.js); otherwise the house pre-roll plays.
// Not supported (documented): Google IMA-only demand (AdSense for video ended 2026-05-31, Ad Exchange video
// requires the IMA SDK), VPAID/SIMID interactive creatives, OMID verification scripts.
(() => {
  'use strict';
  const WRAPPER_MAX = 5;
  const TIMEOUT_MS = 5000;

  const fmtTime = s => {
    const t = Math.max(0, s || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = (t % 60).toFixed(3);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.padStart(6, '0')}`;
  };

  function macros(url, extra = {}) {
    const player = document.getElementById('player');
    const v = {
      CACHEBUSTING: String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
      TIMESTAMP: new Date().toISOString(),
      PAGEURL: location.href, DOMAIN: location.hostname, REFERRER: document.referrer || '',
      WIDTH: String(player?.clientWidth || 640), HEIGHT: String(player?.clientHeight || 360),
      UA: navigator.userAgent, LIMITADTRACKING: '0',
      CONTENTPLAYHEAD: fmtTime(0), MEDIAPLAYHEAD: fmtTime(0), ADPLAYHEAD: fmtTime(extra.t || 0),
      ERRORCODE: extra.code ? String(extra.code) : '', ASSETURI: extra.asset || '',
    };
    return String(url).replace(/\[([A-Z_]+)\]|%%([A-Z_]+)%%/g, (m, a, b) => {
      const k = a || b;
      return k in v ? encodeURIComponent(v[k]) : m;
    });
  }

  const ping = (urls, extra) => urls.forEach(u => { try { new Image().src = macros(u, extra); } catch (_) { /* ignore */ } });

  const parseOffset = (v, duration) => {
    if (!v) return null;
    v = v.trim();
    if (v.endsWith('%')) return duration ? (parseFloat(v) / 100) * duration : null;
    const p = v.split(':').map(Number);
    if (p.length === 3 && p.every(n => !Number.isNaN(n))) return p[0] * 3600 + p[1] * 60 + p[2];
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };

  const txt = el => (el?.textContent || '').trim();
  const kids = (el, name) => [...(el?.children || [])].filter(c => c.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;

  async function fetchXml(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      // Same-origin tags (the simulated network) get the site cookies (geo / frequency caps); third parties never do.
      const u = macros(url);
      let same = false;
      try { same = new URL(u, location.href).origin === location.origin; } catch (_) { /* invalid URL: fetch fails below */ }
      const res = await fetch(u, { credentials: same ? 'same-origin' : 'omit', signal: ctl.signal });
      if (!res.ok) return { err: 301 };
      const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'VAST') return { err: 100 };
      return { doc };
    } catch (_) { return { err: 301 }; } finally { clearTimeout(timer); }
  }

  // Pick the ad to play: a standalone ad (no sequence) or the first of a pod.
  const pickAd = doc => {
    const ads = kids(doc.documentElement, 'Ad');
    return ads.find(a => !a.getAttribute('sequence')) || ads.sort((a, b) => Number(a.getAttribute('sequence')) - Number(b.getAttribute('sequence')))[0] || null;
  };

  function collect(adBody, acc) {
    kids(adBody, 'Impression').forEach(n => txt(n) && acc.impressions.push(txt(n)));
    kids(adBody, 'Error').forEach(n => txt(n) && acc.errors.push(txt(n)));
    const linear = adBody.querySelector('Creatives > Creative > Linear');
    if (!linear) return null;
    linear.querySelectorAll('TrackingEvents > Tracking').forEach(n => {
      const ev = n.getAttribute('event'), u = txt(n);
      if (!ev || !u) return;
      if (ev === 'progress') acc.progress.push({ offset: n.getAttribute('offset'), url: u });
      else (acc.tracking[ev] = acc.tracking[ev] || []).push(u);
    });
    linear.querySelectorAll('VideoClicks > ClickTracking').forEach(n => txt(n) && acc.clicks.push(txt(n)));
    return linear;
  }

  async function resolveVast(url, depth, acc) {
    if (depth > WRAPPER_MAX) { ping(acc.errors, { code: 302 }); return null; }
    const { doc, err } = await fetchXml(url);
    if (!doc) { if (depth > 0) ping(acc.errors, { code: err }); return null; }
    const ad = pickAd(doc);
    if (!ad) { // no fill: <VAST version="4.2"/> or <VAST><Error>...</Error></VAST>
      ping([...kids(doc.documentElement, 'Error').map(txt).filter(Boolean), ...acc.errors], { code: 303 });
      return null;
    }
    const wrapper = kid(ad, 'Wrapper');
    if (wrapper) {
      collect(wrapper, acc);
      const next = txt(kid(wrapper, 'VASTAdTagURI'));
      if (!next) { ping(acc.errors, { code: 301 }); return null; }
      return resolveVast(next, depth + 1, acc);
    }
    const inline = kid(ad, 'InLine');
    const linear = inline && collect(inline, acc);
    if (!linear) { ping(acc.errors, { code: 201 }); return null; }
    const duration = parseOffset(txt(linear.querySelector('Duration')));
    const want = document.getElementById('player')?.clientHeight || 720;
    const files = [...linear.querySelectorAll('MediaFiles > MediaFile')]
      .filter(m => /mp4/i.test(m.getAttribute('type') || '') && (m.getAttribute('delivery') || 'progressive') === 'progressive'
        && !/vpaid/i.test(m.getAttribute('apiFramework') || '') && txt(m))
      .sort((a, b) => Math.abs(want - Number(a.getAttribute('height') || 0)) - Math.abs(want - Number(b.getAttribute('height') || 0)));
    if (!files.length) { ping(acc.errors, { code: 403 }); return null; }
    return {
      src: txt(files[0]),
      duration,
      skipAfter: parseOffset(linear.getAttribute('skipoffset'), duration),
      clickThrough: txt(linear.querySelector('VideoClicks > ClickThrough')) || null,
      ...acc,
    };
  }

  function vastAd(v) {
    const fired = new Set();
    const once = (ev, extra) => { if (fired.has(ev)) return; fired.add(ev); ping(v.tracking[ev] || [], extra); };
    let video = null, closed = false;
    const extra = () => ({ t: video?.currentTime || 0, asset: v.src });
    const ad = {
      src: v.src, skipAfter: v.skipAfter, duration: v.duration, clickThrough: v.clickThrough,
      track(ev) {
        if (['complete', 'ended', 'skip', 'error', 'timeout'].includes(ev)) closed = true;
        if (ev === 'start') { if (!fired.has('start')) ping(v.impressions, extra()); once('creativeView', extra()); once('start', extra()); }
        else if (ev === 'complete' || ev === 'ended') once('complete', extra());
        else if (ev === 'skip') { once('skip', extra()); once('closeLinear', extra()); }
        else if (ev === 'clickThrough' || ev === 'click') ping(v.clicks, extra());
        else if (ev === 'error') ping(v.errors, { ...extra(), code: 405 });
        else if (ev === 'timeout') ping(v.errors, { ...extra(), code: 402 });
        else ping(v.tracking[ev] || [], extra());
      },
      // Quartiles, progress offsets, pause/resume, mute/unmute from the ad <video> itself.
      bind(el) {
        video = el;
        let paused = false, muted = el.muted;
        const progress = v.progress.map(p => ({ ...p, done: false }));
        el.addEventListener('timeupdate', () => {
          const d = el.duration || v.duration || 0, t = el.currentTime;
          if (d) {
            if (t >= d * 0.25) once('firstQuartile', extra());
            if (t >= d * 0.5) once('midpoint', extra());
            if (t >= d * 0.75) once('thirdQuartile', extra());
          }
          progress.forEach(p => { const o = parseOffset(p.offset, d); if (!p.done && o !== null && t >= o) { p.done = true; ping([p.url], extra()); } });
        });
        el.addEventListener('pause', () => { if (!closed && !el.ended && el.currentTime > 0) { paused = true; ping(v.tracking.pause || [], extra()); } });
        el.addEventListener('play', () => { if (paused) { paused = false; ping(v.tracking.resume || [], extra()); } });
        el.addEventListener('volumechange', () => {
          if (closed) return;
          if (el.muted !== muted) { muted = el.muted; ping(v.tracking[muted ? 'mute' : 'unmute'] || [], extra()); }
        });
      },
    };
    return ad;
  }

  const houseAd = cfg => (cfg.preroll ? { src: cfg.preroll, skipAfter: cfg.skipAfter ?? 5, clickThrough: null, track() {}, bind() {} } : null);

  // Third-party VAST tags only run with consent (static/js/ads.js): wait up to 1.5 s for a pending decision.
  function consentOk(cfg) {
    if (!cfg.consent || cfg.consent === 'none') return Promise.resolve(true);
    const c = window.TubeConsent;
    if (!c) return Promise.resolve(false);
    if (c.state !== 'pending') return Promise.resolve(c.state === 'granted');
    return new Promise(res => {
      const t = setTimeout(() => res(false), 1500);
      c.on(s => { clearTimeout(t); res(s === 'granted'); });
    });
  }

  function provider(cfg) {
    if (!cfg || cfg.adsMode === 'off') return { getPreroll: async () => null };
    return {
      async getPreroll() {
        if (cfg.vastUrl && await consentOk(cfg)) {
          try {
            const v = await resolveVast(cfg.vastUrl, 0, { impressions: [], errors: [], tracking: {}, progress: [], clicks: [] });
            if (v) return vastAd(v);
          } catch (_) { /* fall back to the house pre-roll */ }
        }
        return houseAd(cfg);
      },
    };
  }

  window.TubeAds = { provider, _test: { macros, parseOffset } };
})();
