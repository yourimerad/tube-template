// SimAds demo page: plays the sim VAST tag through the site's own pre-roll provider (window.TubeAds,
// app/static/js/ads-vast.js), so the demo checks the real parser end to end.
(() => {
  'use strict';
  const vid = document.getElementById('sa-vid');
  const skip = document.getElementById('sa-skip');
  const state = document.getElementById('sa-vstate');
  if (!vid) return;
  const set = s => { state.textContent = s; document.body.dataset.vast = s; };
  let ad = null, tick = 0;

  function finish(reason) {
    if (!ad) return;
    clearInterval(tick);
    if (reason === 'complete' || reason === 'skip') ad.track?.(reason);
    vid.pause();
    vid.removeAttribute('src');
    vid.load();
    skip.hidden = true;
    ad = null;
    set(reason);
  }

  async function play(url) {
    if (ad) finish('stopped');
    if (!window.TubeAds) { set('no ads-vast.js'); return; }
    set('loading');
    // the player fetches the tag without cookies: forward the demo's GEO / fill switches in the URL
    const ck = k => (document.cookie.match(new RegExp(`(?:^|; )${k}=([^;]*)`)) || [])[1] || '';
    const extra = new URLSearchParams();
    if (ck('simads_geo')) extra.set('geo', ck('simads_geo'));
    if (ck('simads_force')) extra.set('force', ck('simads_force'));
    const tag = extra.toString() ? `${url}&${extra}` : url;
    const provider = window.TubeAds.provider({ adsMode: 'sim', vastUrl: tag, preroll: '', skipAfter: 5 });
    const a = await provider.getPreroll().catch(() => null);
    if (!a || !a.src) { set('no-fill'); return; }
    ad = a;
    const quart = { q1: 0.25, mid: 0.5, q3: 0.75 };
    const fired = new Set();
    const skipAfter = Number(a.skipAfter) || 0;
    skip.hidden = false;
    skip.disabled = true;
    const bound = typeof a.bind === 'function'; // ads-vast.js fires quartiles / progress itself once bound
    if (bound) a.bind(vid);
    vid.src = a.src;
    vid.addEventListener('playing', () => { if (!fired.has('start')) { fired.add('start'); a.track?.('start'); set('playing'); } }, { once: true });
    vid.addEventListener('ended', () => finish('complete'), { once: true });
    vid.addEventListener('error', () => finish('error'), { once: true });
    tick = setInterval(() => {
      const d = vid.duration || 0, t = vid.currentTime;
      if (d && !bound) for (const [ev, f] of Object.entries(quart)) if (t >= d * f && !fired.has(ev)) { fired.add(ev); a.track?.(ev === 'q1' ? 'firstQuartile' : ev === 'mid' ? 'midpoint' : 'thirdQuartile'); }
      if (!bound && t >= 2 && !fired.has('progress')) { fired.add('progress'); a.track?.('progress'); }
      const left = Math.ceil(skipAfter - t);
      if (left > 0) skip.textContent = `Skip in ${left}`;
      else if (skip.disabled) { skip.disabled = false; skip.textContent = 'Skip ›'; }
    }, 250);
    vid.play().catch(() => finish('error'));
  }

  skip.addEventListener('click', () => { if (!skip.disabled) finish('skip'); });
  vid.addEventListener('click', () => { if (ad?.clickThrough) { ad.track?.('clickThrough'); window.open(ad.clickThrough, '_blank', 'noopener'); } });
  for (const id of ['sa-play', 'sa-play-w']) {
    const b = document.getElementById(id);
    b?.addEventListener('click', () => play(b.dataset.vast));
  }
})();
