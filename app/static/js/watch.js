// Video page: pre-roll -> HLS player (hls.js, native HLS fallback), quality menu, volume memory,
// view ping, votes, comments, share. The HTML is cached and identical for everyone; the
// visitor's own state is fetched from /api after load.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = JSON.parse($('player-cfg')?.textContent || '{}');
  const vid = cfg.id;
  if (!vid) return;

  // UI strings + locale from the server (locales/<lang>.json, see src/i18n.js clientStrings()).
  const I = JSON.parse($('i18n')?.textContent || '{}');
  const W = I.watch || {};
  const locale = I.locale || 'en-US';
  const plural = new Intl.PluralRules(locale);
  const pform = (forms, n) => (forms ? forms[plural.select(n)] ?? forms.other : '');
  const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(locale);
  const compact = n => (n >= 1e6 ? `${nf1.format(n / 1e6)} M` : n >= 1e4 ? `${nf1.format(n / 1e3)} k` : nf0.format(n));
  const viewsTxt = n => String(pform(I.views, n) || '{n}').replace('{n}', compact(n));

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* empty */ }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  // ---------------- player ----------------
  const video = $('mainvid');
  const bigplay = $('bigplay');
  const adlayer = $('adlayer');
  const advid = $('advid');
  const adskip = $('adskip');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* blocked */ } },
  };
  const savedVol = parseFloat(store.get('tp-vol'));
  const savedMuted = store.get('tp-muted') === '1';
  const applyVolume = el => {
    if (!Number.isNaN(savedVol)) el.volume = Math.min(1, Math.max(0, savedVol));
    el.muted = savedMuted;
  };

  const tryPlay = async el => {
    try { await el.play(); return true; } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        el.muted = true; // autoplay with sound refused (lost user gesture): retry muted
        try { await el.play(); return true; } catch (_) { return false; }
      }
      return false;
    }
  };

  function playPreroll(ad) {
    return new Promise(resolve => {
      let done = false, timer = 0, watchdog = 0;
      const finish = reason => {
        if (done) return;
        done = true;
        clearInterval(timer); clearTimeout(watchdog);
        ad.track?.(reason === 'ended' ? 'complete' : reason);
        advid.pause();
        advid.removeAttribute('src');
        advid.load();
        adlayer.hidden = true;
        resolve(reason);
      };
      const skipAfter = Number(ad.skipAfter) || 0;
      const label = adskip.querySelector('span');
      const tick = () => {
        const left = Math.ceil(skipAfter - advid.currentTime);
        if (left <= 0) {
          if (adskip.disabled) { adskip.disabled = false; adskip.textContent = W.skip; }
        } else if (label) label.textContent = String(left);
      };
      adskip.disabled = true;
      adlayer.hidden = false;
      advid.addEventListener('ended', () => finish('ended'), { once: true });
      advid.addEventListener('error', () => finish('error'), { once: true });
      advid.addEventListener('playing', () => { clearTimeout(watchdog); ad.track?.('start'); }, { once: true });
      adskip.addEventListener('click', () => { if (!adskip.disabled) finish('skip'); });
      if (ad.clickThrough) {
        advid.style.cursor = 'pointer';
        advid.addEventListener('click', () => { ad.track?.('clickThrough'); window.open(ad.clickThrough, '_blank', 'noopener'); });
      }
      watchdog = setTimeout(() => finish('timeout'), 8000); // ad never started: go to the video
      timer = setInterval(tick, 250);
      applyVolume(advid);
      advid.src = ad.src;
      tryPlay(advid).then(ok => { if (!ok) finish('error'); });
    });
  }

  let hls = null;
  function buildQualityMenu() {
    const box = $('qsel'), menu = $('qmenu'), btn = $('qbtn');
    if (!hls || !hls.levels || hls.levels.length < 2) return;
    const levels = hls.levels.map((l, i) => ({ i, p: Math.min(l.width || 0, l.height || 0) || l.height || 0 }))
      .sort((a, b) => b.p - a.p);
    const label = btn.querySelector('span');
    const render = () => {
      menu.textContent = '';
      const auto = W.quality_auto || 'Auto';
      const items = [{ i: -1, txt: auto }, ...levels.map(l => ({ i: l.i, txt: `${l.p}p` }))];
      for (const it of items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitemradio');
        b.textContent = it.txt;
        const on = it.i === -1 ? hls.autoLevelEnabled : !hls.autoLevelEnabled && hls.currentLevel === it.i;
        b.className = on ? 'on' : '';
        b.setAttribute('aria-checked', String(on));
        b.addEventListener('click', () => {
          hls.currentLevel = it.i;
          menu.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          render();
        });
        li.appendChild(b);
        menu.appendChild(li);
      }
      const cur = hls.levels[hls.currentLevel];
      const p = cur ? Math.min(cur.width || 0, cur.height || 0) || cur.height : null;
      label.textContent = hls.autoLevelEnabled ? (p ? `${auto} (${p}p)` : auto) : `${p}p`;
    };
    render();
    hls.on(window.Hls.Events.LEVEL_SWITCHED, render);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', e => { if (!box.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    box.hidden = false;
  }

  function startMain() {
    video.controls = true;
    applyVolume(video);
    video.addEventListener('volumechange', () => {
      store.set('tp-vol', String(video.volume));
      store.set('tp-muted', video.muted ? '1' : '0');
    });
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ capLevelToPlayerSize: true, maxBufferLength: 30, backBufferLength: 30 });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => { buildQualityMenu(); tryPlay(video); });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.destroy();
      });
      hls.loadSource(cfg.hls);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = cfg.hls; // Safari / iOS native HLS
      tryPlay(video);
    } else {
      const p = document.createElement('p'); p.className = 'empty'; p.textContent = W.cannot_play; video.after(p);
    }
  }

  // Count a view once playback actually starts (server dedupes per visitor per 6 h).
  let viewSent = false;
  video.addEventListener('playing', async () => {
    if (viewSent) return;
    viewSent = true;
    const r = await api(`/videos/${vid}/view`, { method: 'POST' });
    if (r.ok && typeof r.data.views === 'number') $('v-views').textContent = viewsTxt(r.data.views);
  });

  let started = false;
  bigplay.addEventListener('click', async () => {
    if (started) return;
    started = true;
    bigplay.hidden = true;
    const ad = await window.TubeAds?.provider(cfg).getPreroll().catch(() => null);
    if (ad && ad.src) await playPreroll(ad);
    startMain();
  });

  // ---------------- votes ----------------
  const voteBox = $('vote');
  const upBtn = voteBox.querySelector('.vbtn-up'), downBtn = voteBox.querySelector('.vbtn-down');
  let myVote = 0;
  function renderVotes(likes, dislikes, vote) {
    myVote = vote;
    $('v-likes').textContent = compact(likes);
    $('v-dislikes').textContent = compact(dislikes);
    upBtn.setAttribute('aria-pressed', String(vote === 1));
    downBtn.setAttribute('aria-pressed', String(vote === -1));
    const t = likes + dislikes;
    const pct = t ? Math.round((likes / t) * 100) : null;
    $('ratebar').style.width = `${pct ?? 0}%`;
    $('rate-pct').textContent = pct === null ? W.no_votes : `${pct}%`;
  }
  $('ratebar').style.width = `${Number($('ratebar').dataset.pct) || 0}%`;
  voteBox.addEventListener('click', async e => {
    const b = e.target.closest('.vbtn');
    if (!b) return;
    const v = Number(b.dataset.value);
    const value = myVote === v ? 0 : v;
    b.disabled = true;
    const r = await api(`/videos/${vid}/vote`, { method: 'POST', body: { value } });
    b.disabled = false;
    if (r.ok) renderVotes(r.data.likes, r.data.dislikes, r.data.vote);
  });

  // ---------------- comments ----------------
  const list = $('cmt-list');
  const form = $('cmt-form');
  const msg = $('cmt-msg');
  const countEl = $('cmt-count');
  const setCount = n => {
    countEl.textContent = String(n);
    countEl.parentElement.lastChild.textContent = ` ${pform(I.comments_word, n)}`;
  };
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  const agoTxt = d => {
    const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return I.time?.just_now || '';
    if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
    return rtf.format(-Math.floor(s / 86400), 'day');
  };
  // User content only ever goes through textContent: no HTML, links stay plain text.
  function commentEl(c) {
    const li = document.createElement('li');
    li.className = 'cmt';
    li.dataset.id = c.id;
    const head = document.createElement('div'); head.className = 'cmt-head';
    const a = document.createElement('span'); a.className = 'cmt-author'; a.textContent = c.author;
    const t = document.createElement('span'); t.className = 'cmt-age'; t.textContent = agoTxt(c.created_at);
    head.append(a, t);
    const p = document.createElement('p'); p.className = 'cmt-body'; p.textContent = c.body;
    const up = upvoteBtnTpl.cloneNode(true);
    up.dataset.id = c.id;
    up.querySelector('span').textContent = String(c.upvotes);
    li.append(head, p, up);
    return li;
  }
  const upvoteBtnTpl = (() => {
    const existing = list.querySelector('.cmt-up');
    if (existing) { const c = existing.cloneNode(true); c.classList.remove('on'); return c; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cmt-up'; b.setAttribute('aria-label', W.upvote_aria || '');
    b.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 10h4v11H2zM8 21h9.3a2 2 0 0 0 2-1.6l1.6-7.6A2 2 0 0 0 19 9.4h-5.3l.8-3.9a1.8 1.8 0 0 0-3.2-1.4L8 9z"/></svg><span>0</span>';
    return b;
  })();

  async function loadComments(sort) {
    const r = await api(`/videos/${vid}/comments?sort=${sort}`);
    if (!r.ok) return;
    list.textContent = '';
    r.data.comments.forEach(c => list.appendChild(commentEl(c)));
    setCount(r.data.count);
    $('cmt-empty')?.remove();
  }
  document.querySelectorAll('.comments .tabs .tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.comments .tabs .tab').forEach(x => x.classList.toggle('on', x === t));
    loadComments(t.dataset.sort);
  }));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const author = String(fd.get('author') || '').trim();
    const body = String(fd.get('body') || '').trim();
    msg.className = 'cmt-msg err';
    if (author.length < 2 || author.length > 40) { msg.textContent = W.author_len; return; }
    if (body.length < 2 || body.length > 1000) { msg.textContent = W.body_len; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    const r = await api(`/videos/${vid}/comments`, { method: 'POST', body: { author, body, website: String(fd.get('website') || '') } });
    btn.disabled = false;
    if (r.ok) {
      msg.className = 'cmt-msg ok';
      msg.textContent = W.posted;
      form.elements.body.value = '';
      store.set('tp-author', author);
      if (r.data.comment) {
        $('cmt-empty')?.remove();
        list.prepend(commentEl(r.data.comment));
        setCount(r.data.count);
      }
    } else {
      msg.textContent = r.data.error || W.error_retry;
    }
  });
  const savedAuthor = store.get('tp-author');
  if (savedAuthor && form.elements.author) form.elements.author.value = savedAuthor;

  list.addEventListener('click', async e => {
    const b = e.target.closest('.cmt-up');
    if (!b || b.classList.contains('on')) return;
    const r = await api(`/comments/${b.dataset.id}/upvote`, { method: 'POST' });
    if (r.ok) { b.classList.add('on'); b.querySelector('span').textContent = String(r.data.upvotes); }
  });

  // ---------------- share ----------------
  const share = $('share');
  share.addEventListener('click', async () => {
    const url = location.origin + share.dataset.url;
    const label = share.querySelector('span');
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (__) { /* ignore */ }
      ta.remove();
    }
    label.textContent = ok ? W.link_copied : url;
    share.classList.toggle('ok', ok);
    setTimeout(() => { label.textContent = W.share; share.classList.remove('ok'); }, 2200);
  });

  // ---------------- fresh counters + own vote ----------------
  api(`/videos/${vid}/state`).then(r => {
    if (!r.ok) return;
    $('v-views').textContent = viewsTxt(r.data.views);
    renderVotes(r.data.likes, r.data.dislikes, r.data.vote);
    if (r.data.comments !== Number(countEl.textContent)) loadComments('recent');
  });
})();
