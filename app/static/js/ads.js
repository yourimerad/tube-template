// Ad activator + consent (ads.mode live / sim). The server HTML is identical for everyone (cached), so
// every per-visitor decision happens here:
//   - consent: "none" -> activate at once; "banner" -> built-in EU banner (accept / refuse, same prominence,
//     choice kept 6 months in the tube_consent cookie); "cmp" -> wait for the pasted TCF CMP (__tcfapi):
//     activate when GDPR does not apply or purpose 1 (store/access information) is consented.
//   - activation: loaders emitted inert (<script type="text/plain" data-consent="ads">) are re-created as real
//     scripts; slot tags in <template data-ad-tpl data-media="all|desk|mob"> are mounted for this device only.
//   - refusal: no ad script ever runs; the labelled house placeholders (.ad-house) stay.
//   - US opt-out (usOptout): the footer "Do Not Sell or Share My Personal Information" button (tube_optout
//     cookie) or a Global Privacy Control signal (navigator.globalPrivacyControl) keeps every ad script off, like
//     a refusal, whatever the consent mode (an opt-out always wins).
// window.TubeConsent = { state: 'pending'|'granted'|'denied', on(fn) } (ads-vast.js asks before a VAST call).
(() => {
  'use strict';
  const cfg = JSON.parse(document.getElementById('ads-cfg')?.textContent || '{}');
  const COOKIE = 'tube_consent';
  const listeners = [];
  const api = { state: 'pending', on(fn) { listeners.push(fn); } };
  window.TubeConsent = api;
  const setState = s => { api.state = s; document.documentElement.dataset.adsConsent = s; listeners.forEach(fn => { try { fn(s); } catch (_) { /* ignore */ } }); };

  // Re-create a script so the browser runs it (inert copies and template clones never run by themselves).
  // Resolves when an external, non-async script has loaded: tags run one after the other in document order, so
  // a snippet's inline config (atOptions = {...}) is read by ITS loader before the next snippet overwrites it.
  function revive(old) {
    const s = document.createElement('script');
    for (const a of old.attributes) {
      if (a.name === 'type' || a.name === 'data-consent' || a.name === 'data-type') continue;
      s.setAttribute(a.name, a.value);
    }
    const type = old.getAttribute('data-type') || (old.getAttribute('type') === 'text/plain' ? '' : old.getAttribute('type'));
    if (type) s.type = type;
    const wait = !!old.getAttribute('src') && !old.hasAttribute('async');
    if (wait) s.async = false;
    s.text = old.text;
    const done = wait ? new Promise(r => { s.onload = s.onerror = r; setTimeout(r, 4000); }) : null;
    old.replaceWith(s);
    return done;
  }
  async function reviveAll(list) { for (const el of list) { const p = revive(el); if (p) await p; } }

  const mobile = () => window.matchMedia(`(max-width: ${cfg.mobileMax || 760}px)`).matches;
  let active = false;
  async function activate() {
    if (active) return;
    active = true;
    await reviveAll([...document.head.querySelectorAll('script[data-consent="ads"]')]);
    const mob = mobile();
    for (const tpl of [...document.querySelectorAll('template[data-ad-tpl]')]) {
      const m = tpl.dataset.media || 'all';
      if ((m === 'mob' && !mob) || (m === 'desk' && mob)) { tpl.remove(); continue; }
      const box = tpl.parentNode;
      const frag = tpl.content.cloneNode(true);
      const scripts = [...frag.querySelectorAll('script')];
      tpl.replaceWith(frag);
      box?.querySelectorAll?.(':scope > .ad-house').forEach(h => h.remove());
      await reviveAll(scripts);
    }
    document.querySelectorAll('.ad-net > .ad-house').forEach(h => h.remove());
    await reviveAll([...document.querySelectorAll('script[data-consent="ads"]')]);
  }

  const readChoice = () => (/(?:^|;\s*)tube_consent=([01])/.exec(document.cookie) || [])[1] || null;
  function saveChoice(v) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${182 * 86400}; SameSite=Lax${secure}`;
  }

  function banner() {
    const el = document.getElementById('consent');
    const show = () => { if (el) el.hidden = false; };
    const choice = readChoice();
    if (choice === '1') { setState('granted'); activate(); } else if (choice === '0') setState('denied'); else show();
    el?.addEventListener('click', e => {
      const b = e.target.closest('[data-consent-choice]');
      if (!b) return;
      const v = b.dataset.consentChoice;
      const before = readChoice();
      saveChoice(v);
      el.hidden = true;
      if (v === '1') { setState('granted'); activate(); } else {
        setState('denied');
        if (before === '1' || active) location.reload(); // scripts already ran: start from a clean page
      }
    });
    document.querySelectorAll('[data-consent-open]').forEach(b => b.addEventListener('click', show));
  }

  function cmp() {
    let tries = 0;
    const wait = () => {
      if (typeof window.__tcfapi !== 'function') {
        if (++tries < 100) setTimeout(wait, 100); else setState('denied'); // no CMP after 10 s
        return;
      }
      window.__tcfapi('addEventListener', 2, (tc, ok) => {
        if (!ok || !tc || (tc.eventStatus !== 'tcloaded' && tc.eventStatus !== 'useractioncomplete')) return;
        if (tc.gdprApplies === false || tc.purpose?.consents?.[1]) { setState('granted'); activate(); } else setState('denied');
      });
    };
    wait();
  }

  // US opt-out: the footer button toggles tube_optout; a Global Privacy Control signal counts as an opt-out.
  const optedOut = () => /(?:^|;\s*)tube_optout=1/.test(document.cookie) || navigator.globalPrivacyControl === true;
  function optoutButton() {
    const btn = document.querySelector('[data-optout]');
    if (!btn) return;
    const out = optedOut();
    if (out) { btn.textContent = btn.dataset.on; btn.setAttribute('aria-pressed', 'true'); }
    btn.addEventListener('click', () => {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `tube_optout=${out ? '0' : '1'}; Path=/; Max-Age=${out ? 0 : 365 * 86400}; SameSite=Lax${secure}`;
      location.reload();
    });
  }

  optoutButton();
  if (cfg.usOptout && optedOut()) setState('denied');
  else if (cfg.consent === 'banner') banner();
  else if (cfg.consent === 'cmp') cmp();
  else { setState('granted'); activate(); }
})();
