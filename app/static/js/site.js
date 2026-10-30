// Site-wide behaviour: hover previews on video cards + sticky ad bar.
(() => {
  'use strict';

  // ---------- hover preview ----------
  // One preview plays at a time, globally. The <video> is created lazily (no preload until then)
  // and fully unloaded when the card loses focus/hover.
  const DELAY = 500;
  let current = null; // { card, video }

  function stop(card) {
    if (!current || (card && current.card !== card)) return;
    const { card: c, video } = current;
    current = null;
    c.classList.remove('pv-loading', 'pv-playing');
    try { video.pause(); } catch (_) { /* ignore */ }
    video.removeAttribute('src');
    try { video.load(); } catch (_) { /* ignore */ }
    video.remove();
  }

  function start(card) {
    if (current && current.card === card) return;
    stop();
    const src = card.dataset.preview;
    const thumb = card.querySelector('.thumb');
    if (!src || !thumb) return;
    const video = document.createElement('video');
    video.className = 'pv';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('aria-hidden', 'true');
    video.preload = 'auto';
    current = { card, video };
    card.classList.add('pv-loading');
    video.addEventListener('playing', () => {
      if (current?.video !== video) return;
      card.classList.remove('pv-loading');
      card.classList.add('pv-playing');
      video.classList.add('on');
    });
    video.addEventListener('error', () => { if (current?.video === video) stop(card); });
    video.src = src;
    thumb.appendChild(video);
    const p = video.play();
    if (p && p.catch) p.catch(() => { /* autoplay refused or aborted by stop() */ });
  }

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (canHover) {
    let timer = 0, pending = null;
    const cancel = () => { clearTimeout(timer); pending = null; };
    document.addEventListener('pointerover', e => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const card = e.target.closest?.('.card[data-preview]');
      if (!card || card === pending || (current && current.card === card)) return;
      cancel();
      pending = card;
      timer = setTimeout(() => { if (pending === card) { pending = null; start(card); } }, DELAY);
    });
    document.addEventListener('pointerout', e => {
      const card = e.target.closest?.('.card[data-preview]');
      if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
      if (pending === card) cancel();
      stop(card);
    });
    window.addEventListener('blur', () => { cancel(); stop(); });
  } else if ('IntersectionObserver' in window) {
    // Touch: play the card most centred in the viewport once it has been >= 60% visible
    // and the page has been still for 500 ms.
    const ratios = new Map();
    let timer = 0;
    const pick = () => {
      const mid = window.innerHeight / 2;
      let best = null, bestDist = Infinity;
      for (const [card, r] of ratios) {
        if (r < 0.6) continue;
        const b = card.getBoundingClientRect();
        const d = Math.abs(b.top + b.height / 2 - mid);
        if (d < bestDist) { bestDist = d; best = card; }
      }
      if (best) start(best); else stop();
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(pick, DELAY); };
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        ratios.set(en.target, en.intersectionRatio);
        if (current && current.card === en.target && en.intersectionRatio < 0.6) stop();
      }
      schedule();
    }, { threshold: [0, 0.3, 0.6, 0.8, 1] });
    document.querySelectorAll('.card[data-preview]').forEach(c => io.observe(c));
    window.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  }
  window.addEventListener('pagehide', () => stop());

  // ---------- sticky bottom ad bar (closable, remembered for the session) ----------
  const bar = document.getElementById('adbar');
  if (bar) {
    let closed = false;
    try { closed = sessionStorage.getItem('adbar-closed') === '1'; } catch (_) { /* storage blocked */ }
    if (!closed) { bar.hidden = false; document.body.classList.add('has-adbar'); }
    bar.querySelector('.adbar-x')?.addEventListener('click', () => {
      bar.hidden = true;
      document.body.classList.remove('has-adbar');
      try { sessionStorage.setItem('adbar-closed', '1'); } catch (_) { /* storage blocked */ }
    });
  }
})();
