// Age gate session (audience "adult"): the av_exp / av_sig cookies last 1 h of INACTIVITY (Arcom referential: no
// "remember me", the check ends with the browser session or after 1 h idle). While the visitor is active
// (pointer, keys, scroll, video playing), the session is slid forward at most every 5 minutes via POST /age/refresh.
(() => {
  'use strict';
  const exp = () => Number((/(?:^|;\s*)av_exp=(\d+)/.exec(document.cookie) || [])[1] || 0);
  let last = 0, busy = false;
  async function slide() {
    const now = Date.now();
    if (busy || now - last < 300000 || !exp() || exp() * 1000 < now) return;
    busy = true; last = now;
    try { await fetch('/age/refresh', { method: 'POST', credentials: 'same-origin' }); } catch (_) { /* next activity retries */ }
    busy = false;
  }
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(e => addEventListener(e, slide, { passive: true }));
  document.addEventListener('timeupdate', slide, true);
  // Expired while the tab stayed open: back to the gate.
  setInterval(() => { if (exp() && exp() * 1000 < Date.now()) location.reload(); }, 60000);
  slide();
})();
