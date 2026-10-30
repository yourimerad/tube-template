import { html } from '../html.js';
import { config } from '../config.js';
import * as f from '../format.js';
import { label } from '../i18n.js';
import { icons } from './icons.js';
import { nativeAdCard } from './ads.js';

export const videoUrl = v => `/v/${v.id}/${v.slug}`;
// Media URLs: MEDIA_BASE/<media_path>/<file>, media_path = "<id>" or "<id>/<version>" (see docs/ARCHITECTURE.md).
export const media = (mediaPath, file) => `${config.mediaBase}/${mediaPath}/${file}`;
const mp = v => v.media_path || v.id;

export function poster(mediaPath, { eager = false, cls = '' } = {}) {
  return html`<picture class="${cls}">
    <source type="image/webp" srcset="${media(mediaPath, 'poster.webp')}">
    <img src="${media(mediaPath, 'poster.jpg')}" alt="" width="640" height="360"
      ${eager ? html`fetchpriority="high"` : html`loading="lazy"`} decoding="async">
  </picture>`;
}

function metaLine(v) {
  const pct = f.ratingPct(v.likes, v.dislikes);
  return html`<div class="meta">
    <span class="m-views">${f.views(v.views)}</span>
    ${pct !== null ? html`<span class="m-rate">${icons.thumbUp}${pct}%</span>` : ''}
    <span class="m-age">${f.ago(v.published_at)}</span>
  </div>`;
}

function thumb(v, eager) {
  return html`<a class="thumb" href="${videoUrl(v)}" tabindex="-1" aria-hidden="true">
    ${poster(mp(v), { eager })}
    <span class="badges">${f.isHd(v) ? html`<span class="b b-hd">HD</span>` : ''}${label.enabled ? html`<span class="b b-ia" title="${label.text}">${label.badge}</span>` : ''}</span>
    <span class="b-dur">${f.duration(v.duration_s)}</span>
    <span class="pbar" aria-hidden="true"></span>
  </a>`;
}

export function videoCard(v, i = 99, cls = '') {
  return html`<article class="card ${cls}" data-preview="${media(mp(v), 'preview.mp4')}">
    ${thumb(v, i < 4)}
    <h3 class="title"><a href="${videoUrl(v)}" title="${v.title}">${v.title}</a></h3>
    ${metaLine(v)}
  </article>`;
}

// Compact horizontal card for the related-videos side list.
export function compactCard(v) {
  return html`<article class="card card-compact" data-preview="${media(mp(v), 'preview.mp4')}">
    ${thumb(v, false)}
    <div class="cc-body">
      <h3 class="title"><a href="${videoUrl(v)}" title="${v.title}">${v.title}</a></h3>
      ${metaLine(v)}
    </div>
  </article>`;
}

// Grid with a native ad card after every N video cards. `extraCls(v, i)` lets callers tag cards.
export function videoGrid(videos, { ads = true, extraCls = null, empty = '' } = {}) {
  if (!videos.length) return html`<p class="empty">${empty}</p>`;
  const every = config.ads.native_every;
  const items = [];
  videos.forEach((v, i) => {
    items.push(videoCard(v, i, extraCls ? extraCls(v, i) : ''));
    if (ads && (i + 1) % every === 0) items.push(nativeAdCard((i + 1) / every));
  });
  return html`<div class="grid">${items}</div>`;
}
