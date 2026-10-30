import { html, jsonScript } from '../html.js';
import { config, siteOrigin } from '../config.js';
import * as f from '../format.js';
import { t, tn, label, clientStrings } from '../i18n.js';
import { icons } from './icons.js';
import { layout, pagination } from './layout.js';
import { videoGrid, compactCard, media, poster, videoUrl } from './cards.js';
import { adSlot, slotOn } from './ads.js';
import { SORT_TABS, sortLabel } from '../repo.js';

function chips(cats, active) {
  return html`<div class="chips" role="list">
    <a role="listitem" class="chip${active ? '' : ' on'}" href="/">${t('all')}</a>
    ${cats.map(c => html`<a role="listitem" class="chip${c.slug === active ? ' on' : ''}" href="/c/${c.slug}">${c.name}<span class="chip-n">${c.n}</span></a>`)}
  </div>`;
}

const qs = params => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 1)).toString();
  return s ? `?${s}` : '';
};

// Generic listing page (home, category, tag, search, nav sorts).
export function listingPage({ heading, sub = '', nav = '', path, sort, tabs = true, cats, activeCat = null,
  rows, total, page, q = '', extraParams = {}, title, empty }) {
  const href = p => `${path}${qs({ ...extraParams, sort: tabs && sort !== 'recommended' ? sort : undefined, page: p })}`;
  const body = html`
    ${chips(cats, activeCat)}
    <div class="list-head">
      <h1>${heading}${total ? html` <span class="count">${tn('videos_count', total, { n: f.compact(total) })}</span>` : ''}</h1>
      ${tabs ? html`<nav class="tabs" aria-label="${t('sort_aria')}">${SORT_TABS.map(k =>
        html`<a class="tab${k === sort ? ' on' : ''}" href="${path}${qs({ ...extraParams, sort: k === 'recommended' ? undefined : k })}">${sortLabel(k)}</a>`)}</nav>` : ''}
    </div>
    ${sub ? html`<p class="sub">${sub}</p>` : ''}
    ${videoGrid(rows, { empty: empty || t('empty_videos') })}
    ${pagination(page, total, config.pageSize, href)}`;
  return layout({ title, body, nav, q, canonical: href(page) });
}

export function categoriesPage(cats) {
  const body = html`
    <div class="list-head"><h1>${t('categories_title')}</h1></div>
    <div class="grid grid-cats">
      ${cats.map(c => html`<a class="cat-tile" href="/c/${c.slug}">
        <span class="thumb">${c.top_media ? poster(c.top_media) : html`<span class="thumb-empty"></span>`}</span>
        <span class="cat-name">${c.name}</span>
        <span class="cat-n">${tn('videos_count', c.n)}</span>
      </a>`)}
    </div>`;
  return layout({ title: t('categories_title'), body, nav: 'categories', canonical: '/categories' });
}

function commentItem(c) {
  return html`<li class="cmt" data-id="${c.id}">
    <div class="cmt-head"><span class="cmt-author">${c.author}</span><span class="cmt-age" title="${f.longDate(c.created_at)}">${f.ago(c.created_at)}</span></div>
    <p class="cmt-body">${c.body}</p>
    <button type="button" class="cmt-up" data-id="${c.id}" aria-label="${t('watch.upvote_aria')}">${icons.thumbUp}<span>${c.upvotes}</span></button>
  </li>`;
}

export function watchPage({ v, related, comments }) {
  const pct = f.ratingPct(v.likes, v.dislikes);
  const side = related.slice(0, 8);
  const url = videoUrl(v);
  const mp = v.media_path || v.id;
  const prerollOn = slotOn('preroll');
  const player = {
    id: v.id,
    hls: media(mp, 'hls/master.m3u8'),
    adsMode: prerollOn ? config.adsMode : 'off',
    preroll: prerollOn && config.ads.housePreroll ? `${config.mediaBase}/_house/preroll.mp4` : null,
    vastUrl: prerollOn ? config.ads.vastUrl || null : null,
    skipAfter: 5,
  };
  const posterJpg = media(mp, 'poster.jpg');
  const body = html`
  <div class="watch">
    <div class="watch-main">
      <div class="player" id="player">
        <video id="mainvid" playsinline preload="none" poster="${posterJpg}"></video>
        <button type="button" class="bigplay" id="bigplay" aria-label="${t('watch.play')}">${icons.play}</button>
        <div class="adlayer" id="adlayer" hidden>
          <video class="advid" id="advid" playsinline preload="none"></video>
          <span class="adlayer-tag">${t('ad.label')}</span>
          <button type="button" class="adskip" id="adskip" disabled>${t('watch.skip_in')} <span>5</span></button>
        </div>
        <div class="qsel" id="qsel" hidden>
          <button type="button" class="qbtn" id="qbtn" aria-haspopup="true" aria-expanded="false">${icons.gear}<span>${t('watch.quality_auto')}</span></button>
          <ul class="qmenu" id="qmenu" role="menu" hidden></ul>
        </div>
      </div>
      <script type="application/json" id="player-cfg">${jsonScript(player)}</script>
      <script type="application/json" id="i18n">${jsonScript(clientStrings())}</script>

      <h1 class="v-title">${v.title}</h1>
      <div class="v-bar">
        <div class="v-stats">
          <span class="v-views">${icons.eye}<span id="v-views">${f.views(v.views)}</span></span>
          <span class="v-date" title="${f.longDate(v.published_at)}">${f.ago(v.published_at)}</span>
        </div>
        <div class="v-actions">
          <div class="vote" id="vote" data-id="${v.id}">
            <div class="vote-btns">
              <button type="button" class="vbtn vbtn-up" data-value="1" aria-pressed="false" aria-label="${t('watch.like')}">${icons.thumbUp}<span id="v-likes">${f.compact(v.likes)}</span></button>
              <button type="button" class="vbtn vbtn-down" data-value="-1" aria-pressed="false" aria-label="${t('watch.dislike')}">${icons.thumbDown}<span id="v-dislikes">${f.compact(v.dislikes)}</span></button>
            </div>
            <div class="ratebar" title="${pct === null ? t('watch.no_votes_title') : t('watch.pct_positive', { pct })}"><span id="ratebar" data-pct="${pct ?? 0}"></span></div>
            <span class="rate-pct" id="rate-pct">${pct === null ? t('watch.no_votes') : `${pct}%`}</span>
          </div>
          <button type="button" class="btn-ghost" id="share" data-url="${url}">${icons.share}<span>${t('watch.share')}</span></button>
        </div>
      </div>
      ${label.enabled ? html`<p class="ia-label" role="note"><span class="ia-dot"></span>${label.text}</p>` : ''}
      <div class="v-chips">
        <a class="chip chip-cat" href="/c/${v.category_slug}">${v.category_name}</a>
        ${v.tags.map(tag => html`<a class="chip" href="/tag/${encodeURIComponent(tag)}">#${tag}</a>`)}
      </div>
      ${v.description ? html`<div class="v-desc"><p>${v.description}</p></div>` : ''}
      <div class="ad-inline-mob">${adSlot('rect', 'rect-mobile', 'inline_mobile')}</div>

      <section class="comments" id="comments" data-id="${v.id}">
        <div class="cmts-head">
          <h2><span id="cmt-count">${v.comments_count}</span> ${tn('comments_word', v.comments_count)}</h2>
          <div class="tabs tabs-sm" role="tablist">
            <button type="button" class="tab on" data-sort="recent">${t('watch.recent')}</button>
            <button type="button" class="tab" data-sort="popular">${t('watch.popular')}</button>
          </div>
        </div>
        <form class="cmt-form" id="cmt-form" novalidate>
          <input name="author" maxlength="40" placeholder="${t('watch.author_ph')}" required aria-label="${t('watch.author_ph')}">
          <textarea name="body" minlength="2" maxlength="1000" rows="3" placeholder="${t('watch.comment_ph')}" required aria-label="${t('watch.comment_aria')}"></textarea>
          <div class="hp" aria-hidden="true"><label>${t('watch.website')} <input name="website" tabindex="-1" autocomplete="off"></label></div>
          <div class="cmt-form-row"><span class="cmt-msg" id="cmt-msg" role="status"></span><button type="submit" class="btn">${t('watch.publish')}</button></div>
        </form>
        <ul class="cmt-list" id="cmt-list">${comments.map(commentItem)}</ul>
        ${comments.length ? '' : html`<p class="empty" id="cmt-empty">${t('watch.first_comment')}</p>`}
      </section>
    </div>
    <aside class="watch-side">
      ${adSlot('rect', 'rect-side-1', 'sidebar')}
      <h2 class="side-h">${t('watch.related')}</h2>
      <div class="side-list">${side.map(compactCard)}</div>
      ${adSlot('rect', 'rect-side-2', 'sidebar')}
    </aside>
  </div>
  <section class="more">
    <h2 class="more-h">${t('watch.more')}</h2>
    ${videoGrid(related, { extraCls: (_, i) => (related.length > side.length + 4 && i < side.length ? 'mob-only' : ''), empty: t('watch.no_more') })}
  </section>`;
  return layout({
    title: v.title, body, description: v.description?.slice(0, 160), canonical: url,
    ogImage: posterJpg.startsWith('http') ? posterJpg : `${siteOrigin()}${posterJpg}`,
    scripts: ['/static/vendor/hls-1.7.3.min.js', '/static/js/ads-vast.js', '/static/js/watch.js'],
  });
}

export function errorPage(status, message) {
  const title = status === 404 ? t('errors.not_found_title') : t('errors.error_title');
  const body = html`<div class="errpage"><h1>${title}</h1>
    <p>${message}</p><p><a class="btn" href="/">${t('errors.back_home')}</a></p></div>`;
  return layout({ title, body });
}
