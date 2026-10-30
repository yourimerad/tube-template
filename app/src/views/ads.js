// THE ad partial. Every ad slot on the site is rendered from here, so dropping a real network
// snippet in later means editing only this file (and listing its origins in site.config.json
// "ads.csp_origins", which server.js adds to the CSP).
//   ads.mode placeholder -> clearly labelled placeholder boxes
//   ads.mode live        -> empty <div data-ad-slot> containers for your network's tag (no placeholder art)
//   ads.mode off         -> nothing
// Each slot can be switched off in site.config.json "ads.slots". No popups / popunders, ever.
import { html } from '../html.js';
import { config } from '../config.js';
import { t } from '../i18n.js';

const SLOTS = {
  leaderboard: { cls: 'ad-leaderboard', labels: [['728x90', 'ad-desk'], ['320x50', 'ad-mob']] },
  rect: { cls: 'ad-rect', labels: [['300x250', '']] },
  sticky: { cls: 'ad-sticky', labels: [['728x90', 'ad-desk'], ['320x50', 'ad-mob']] },
};

export const slotOn = name => config.adsMode !== 'off' && config.ads.slots[name] !== false;
const live = () => config.adsMode === 'live';

// kind: leaderboard | rect | sticky ; slot: the config switch (leaderboard | sidebar | inline_mobile | sticky)
export function adSlot(kind, id = kind, slot = kind) {
  if (!slotOn(slot)) return '';
  const s = SLOTS[kind];
  if (live()) return html`<div class="ad ad-live ${s.cls}" data-ad-slot="${id}" role="complementary" aria-label="${t('ad.label')}"></div>`;
  return html`<div class="ad ${s.cls}" data-ad-slot="${id}" role="complementary" aria-label="${t('ad.label')}">
    ${s.labels.map(([size, cls]) => html`<span class="ad-ph ${cls}"><span class="ad-tag">${t('ad.label')}</span> ${size}</span>`)}
  </div>`;
}

// Native ad shaped like a video card, inserted in grids.
export function nativeAdCard(n) {
  if (!slotOn('native')) return '';
  if (live()) return html`<article class="card card-ad" data-ad-slot="native-${n}" aria-label="${t('ad.label')}"></article>`;
  return html`<article class="card card-ad" data-ad-slot="native-${n}" aria-label="${t('ad.label')}">
    <div class="thumb thumb-ad"><span class="ad-ph"><span class="ad-tag">${t('ad.label')}</span> native</span></div>
    <h3 class="title">${t('ad.native_title')}</h3>
    <div class="meta"><span class="ad-spons">${t('ad.sponsored')}</span></div>
  </article>`;
}

// Sticky closable bottom bar.
export function stickyBar() {
  if (!slotOn('sticky')) return '';
  return html`<div class="adbar" id="adbar" hidden>
    ${adSlot('sticky')}
    <button type="button" class="adbar-x" aria-label="${t('ad.close')}">×</button>
  </div>`;
}
