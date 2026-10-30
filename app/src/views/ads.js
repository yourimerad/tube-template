// THE ad partial. Every ad slot on the site is rendered from here, from site.config.json "ads"
// (normalized by ads/normalize.js; old boolean slots keep working) and the network presets of
// src/ads/presets/:
//   ads.mode off          -> nothing
//   ads.mode placeholder  -> clearly labelled house boxes (no third party is ever contacted)
//   ads.mode sim          -> EVERY enabled slot uses the simulated network (simads preset), whatever network
//                            is configured, so the owner rehearses the exact layout (private sites only)
//   ads.mode live         -> the exact tag of the slot's network preset (or "custom" pasted HTML); a slot set to
//                            plain `true` without a network stays an empty <div data-ad-slot> container
// Live tags sit in <template data-ad-tpl> (one per device when a mobile zone is set) and loaders are made inert
// (type="text/plain" data-consent="ads") while consent is required: static/js/ads.js mounts / activates them
// after consent, on the right device. HTML stays identical for everyone (cacheable). Every slot is labelled.
import { html, raw, jsonScript } from '../html.js';
import { config } from '../config.js';
import { t } from '../i18n.js';
import { slotMarkup, pageAssets, preroll, inertScripts, BEHAVIOURS } from '../ads/render.js';

const A = config.ads;
const base = { audience: config.audience, simOrigin: A.sim.origin };
const served = () => A.mode === 'live' || A.mode === 'sim';
// Consent required before any ad script runs (built-in banner or a pasted CMP).
export const consentGated = served() && A.consent.effective !== 'none';
// US-style opt-out ("Do Not Sell or Share My Personal Information" + Global Privacy Control), also next to the
// consent banner: opting out (or a GPC signal) keeps every ad script off, house placeholders stay.
const usOptout = served() && A.consent.us_optout;

const KINDS = {
  leaderboard: { cls: 'ad-leaderboard', labels: [['728x90', 'ad-desk'], ['320x50', 'ad-mob']] },
  rect: { cls: 'ad-rect', labels: [['300x250', '']] },
  sticky: { cls: 'ad-sticky', labels: [['728x90', 'ad-desk'], ['320x50', 'ad-mob']] },
  footer: { cls: 'ad-footer', labels: [['900x250', 'ad-desk'], ['300x250', 'ad-mob']] },
};

export const slotOn = name => A.mode !== 'off' && !!A.slots[name]?.on;

const house = s => html`${s.labels.map(([size, cls]) => html`<span class="ad-ph ${cls}"><span class="ad-tag">${t('ad.label')}</span> ${size}</span>`)}`;
const tpl = m => m.variants.map(v => raw(`<template data-ad-tpl data-media="${v.media}">${v.html}</template>`));

// Live/sim markup of a slot (null when the slot has no network in this mode).
function served_(name) {
  const m = slotMarkup(A, name, base);
  if (!m) return null;
  if (m.network === 'simads') return raw(m.variants.map(v => v.html).join(''));
  return tpl(m);
}

// kind: leaderboard | rect | sticky | footer ; slot: the config switch (leaderboard | sidebar | inline_mobile | sticky | footer)
export function adSlot(kind, id = kind, slot = kind) {
  if (!slotOn(slot)) return '';
  const s = KINDS[kind];
  const aria = t('ad.label');
  if (served()) {
    const inner = served_(slot);
    if (!inner) return html`<div class="ad ad-live ${s.cls}" data-ad-slot="${id}" role="complementary" aria-label="${aria}"></div>`;
    return html`<div class="ad ad-live ad-net ${s.cls}" data-ad-slot="${id}" data-ad-mode="${A.mode}" role="complementary" aria-label="${aria}">
      ${A.mode === 'live' ? html`<span class="ad-label">${aria}</span>` : ''}${consentGated || usOptout ? html`<span class="ad-house">${house(s)}</span>` : ''}${inner}</div>`;
  }
  return html`<div class="ad ${s.cls}" data-ad-slot="${id}" role="complementary" aria-label="${aria}">${house(s)}</div>`;
}

// Native ad shaped like a video card, inserted in grids.
export function nativeAdCard(n) {
  if (!slotOn('native')) return '';
  if (served()) {
    const inner = served_('native');
    if (!inner) return html`<article class="card card-ad" data-ad-slot="native-${n}" aria-label="${t('ad.label')}"></article>`;
    return html`<article class="card card-ad ad-net" data-ad-slot="native-${n}" data-ad-mode="${A.mode}" aria-label="${t('ad.sponsored')}">
      ${A.mode === 'live' ? html`<span class="ad-label">${t('ad.sponsored')}</span>` : ''}${consentGated || usOptout ? html`<span class="ad-house"><span class="ad-ph"><span class="ad-tag">${t('ad.label')}</span> native</span></span>` : ''}${inner}</article>`;
  }
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

// Sponsored links in the main navigation (rel="sponsored nofollow", labelled).
export function sponsoredLinks() {
  if (!slotOn('sponsored_links') || !A.sponsored_links.length) return '';
  return html`${A.sponsored_links.map(l => html`<a class="nav-spons" href="${l.url}" rel="sponsored nofollow noopener" target="_blank"><span class="ad-tag">${t('ad.sponsored')}</span> ${l.label}</a>`)}`;
}

// Popunder / interstitial / in-page push: behaviours, rendered once per page before </body>.
function behaviours() {
  if (!served()) return '';
  return BEHAVIOURS.filter(slotOn).map(n => {
    const inner = served_(n);
    return inner ? html`<div class="ad-behaviour" data-ad-slot="${n}" data-ad-mode="${A.mode}">${inner}</div>` : '';
  });
}

const gate = s => (consentGated ? inertScripts(s) : s);
const assets = served() ? pageAssets(A, base) : { head: [], bodyEnd: [], cmp: [] };

// <head>: network loaders (inert until consent), pasted CMP, client config of static/js/ads.js.
export function adsHead() {
  if (!served()) return '';
  const cfg = { mode: A.mode, consent: consentGated ? A.consent.effective : 'none', usOptout: usOptout, mobileMax: 760 };
  return html`${A.consent.effective === 'cmp' && A.consent.cmp_html ? raw(A.consent.cmp_html) : ''}${raw(assets.cmp.join('\n'))}
<script type="application/json" id="ads-cfg">${jsonScript(cfg)}</script>
${raw(gate(assets.head.join('\n')))}`;
}

export function adsBodyEnd() {
  if (!served()) return '';
  return html`${behaviours()}${raw(gate(assets.bodyEnd.join('\n')))}`;
}

export const adsScript = () => (served() ? '/static/js/ads.js' : null);

// Built-in EU consent banner (CNIL style: accept and refuse side by side, same look, no pre-ticked box).
export function consentBanner() {
  if (!consentGated || A.consent.effective !== 'banner') return '';
  return html`<div class="consent" id="consent" role="dialog" aria-modal="false" aria-labelledby="consent-h" hidden>
    <div class="consent-in">
      <p class="consent-h" id="consent-h">${t('consent.title')}</p>
      <p class="consent-txt">${t('consent.text')}${A.consent.policy_url ? html` <a href="${A.consent.policy_url}">${t('consent.policy')}</a>` : ''}</p>
      <div class="consent-btns">
        <button type="button" class="btn consent-btn" data-consent-choice="0">${t('consent.refuse')}</button>
        <button type="button" class="btn consent-btn" data-consent-choice="1">${t('consent.accept')}</button>
      </div>
    </div>
  </div>`;
}

export const consentLink = () => html`${consentGated && A.consent.effective === 'banner' ? html`<button type="button" class="ftr-link" data-consent-open>${t('consent.settings')}</button>` : ''}${usOptout ? html`<button type="button" class="ftr-link" data-optout data-on="${t('consent.optout_on')}">${t('consent.optout')}</button>` : ''}`;

// Pre-roll config for the player (static/js/ads-vast.js).
export function prerollCfg() {
  const pr = slotOn('preroll') ? preroll(A, base) : null;
  return {
    adsMode: pr ? A.mode : 'off',
    preroll: pr && A.house_preroll ? `${config.mediaBase}/_house/preroll.mp4` : null,
    vastUrl: pr && pr.kind === 'vast' ? pr.url : null,
    vastNetwork: pr && pr.kind === 'vast' ? pr.network : null,
    consent: consentGated || usOptout ? 'ask' : 'none',
  };
}
