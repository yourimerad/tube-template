// Minimal VAST-like pre-roll abstraction.
//   const provider = TubeAds.provider(cfg);   // cfg = { adsMode, preroll, vastUrl, skipAfter }
//   const ad = await provider.getPreroll();   // null -> no ad
//   ad = { src, skipAfter, clickThrough, track(event) }
// house pre-roll (ads.house_preroll): MEDIA_BASE/_house/preroll.mp4 when no VAST tag is set.
// ads.vast_url set: fetch a VAST 2/3/4 tag (InLine or Wrapper, up to 3 hops) and play its
// first progressive MP4 MediaFile (server.js adds the tag's origin to connect-src; list the
// creative CDN origins in site.config.json ads.csp_origins).
(() => {
  'use strict';

  const fire = urls => urls.forEach(u => { try { new Image().src = u; } catch (_) { /* ignore */ } });

  const parseOffset = (v, duration) => {
    if (!v) return null;
    if (v.endsWith('%')) return duration ? (parseFloat(v) / 100) * duration : null;
    const p = v.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : Number(v);
  };

  async function fetchVast(url, depth = 0, acc = { impressions: [], tracking: {} }) {
    if (depth > 3) return null;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const text = (el, sel) => (el?.querySelector(sel)?.textContent || '').trim();
    const ad = doc.querySelector('Ad');
    if (!ad) return null;
    ad.querySelectorAll('Impression').forEach(n => n.textContent.trim() && acc.impressions.push(n.textContent.trim()));
    ad.querySelectorAll('Tracking').forEach(n => {
      const ev = n.getAttribute('event');
      (acc.tracking[ev] = acc.tracking[ev] || []).push(n.textContent.trim());
    });
    const wrapperUri = text(ad, 'Wrapper VASTAdTagURI');
    if (wrapperUri) return fetchVast(wrapperUri, depth + 1, acc);
    const linear = ad.querySelector('InLine Linear');
    if (!linear) return null;
    const files = [...linear.querySelectorAll('MediaFile')]
      .filter(m => /mp4/.test(m.getAttribute('type') || '') && (m.getAttribute('delivery') || 'progressive') === 'progressive')
      .sort((a, b) => Math.abs(720 - Number(a.getAttribute('height') || 0)) - Math.abs(720 - Number(b.getAttribute('height') || 0)));
    if (!files.length) return null;
    const duration = parseOffset(text(linear, 'Duration'));
    return {
      src: files[0].textContent.trim(),
      skipAfter: parseOffset(linear.getAttribute('skipoffset'), duration),
      clickThrough: text(linear, 'VideoClicks ClickThrough') || null,
      impressions: acc.impressions,
      tracking: acc.tracking,
    };
  }

  function provider(cfg) {
    if (!cfg || cfg.adsMode === 'off') return { getPreroll: async () => null };
    if (cfg.vastUrl) {
      return {
        async getPreroll() {
          try {
            const ad = await fetchVast(cfg.vastUrl);
            if (!ad) return null;
            let started = false;
            return {
              src: ad.src, skipAfter: ad.skipAfter ?? cfg.skipAfter, clickThrough: ad.clickThrough,
              track(ev) {
                if (ev === 'start' && !started) { started = true; fire(ad.impressions); }
                fire(ad.tracking[ev] || []);
              },
            };
          } catch (_) { return null; }
        },
      };
    }
    // house pre-roll (or nothing when ads.house_preroll is off)
    return {
      getPreroll: async () => (cfg.preroll ? { src: cfg.preroll, skipAfter: cfg.skipAfter ?? 5, clickThrough: null, track() {} } : null),
    };
  }

  window.TubeAds = { provider };
})();
