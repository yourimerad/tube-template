import { html, raw } from '../html.js';
import { config, siteOrigin } from '../config.js';
import { asset } from '../assets.js';
import { t, label, paths, strings } from '../i18n.js';
import { themeHref, faviconHref } from '../theme.js';
import { icons } from './icons.js';
import { adSlot, stickyBar, adsHead, adsBodyEnd, adsScript, sponsoredLinks, consentBanner, consentLink } from './ads.js';
import { legalLinks, rtaMeta } from './legal.js';

// "ClipFlow" -> Clip + <b>Flow</b>: accent on the last capitalised word, if any.
function logo(name) {
  const m = name.match(/^(.+?)([A-ZÀ-Ý][^A-ZÀ-Ý]*)$/);
  return m ? html`${m[1]}<b>${m[2]}</b>` : html`<b>${name}</b>`;
}

const NAV = [
  ['/', 'nav.home', 'home'],
  ['/categories', 'nav.categories', 'categories'],
  [paths.trending, 'nav.trending', 'trending'],
  [paths.new, 'nav.new', 'new'],
  [paths.top_rated, 'nav.top_rated', 'top_rated'],
];

const tagline = () => config.tagline || '';
const fullTitle = title => (title ? `${title} - ${config.siteName}` : (tagline() ? `${config.siteName} - ${tagline()}` : config.siteName));

function footerText() {
  if (config.footer.text !== null) return config.footer.text;
  return label.enabled ? t('footer_labelled', { label: label.text }) : '';
}

export function layout({ title, body, nav = '', q = '', description = '', canonical = '', head = '', scripts = [], ogImage = '' }) {
  const full = fullTitle(title);
  const desc = description || config.description || (tagline() ? `${config.siteName} : ${tagline()}` : config.siteName);
  const ft = footerText();
  return html`<!doctype html>
<html lang="${strings.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${full}</title>
<meta name="description" content="${desc}">
${config.private ? html`<meta name="robots" content="noindex, nofollow">` : ''}
${canonical ? html`<link rel="canonical" href="${siteOrigin()}${canonical}">` : ''}
<meta property="og:site_name" content="${config.siteName}">
<meta property="og:title" content="${full}">
${ogImage ? html`<meta property="og:image" content="${ogImage}">` : ''}
<meta name="theme-color" content="#101218">
<link rel="icon" href="${faviconHref}" type="image/svg+xml">
<link rel="stylesheet" href="${asset('/static/css/site.css')}">
<link rel="stylesheet" href="${themeHref}">
${rtaMeta()}
${adsHead()}
${head}
</head>
<body>
<a class="skip" href="#main">${t('skip')}</a>
<header class="hdr">
  <div class="hdr-row wrap">
    <a class="logo" href="/" aria-label="${t('home_aria', { site: config.siteName })}"><span class="logo-mark">${icons.play}</span><span class="logo-txt">${logo(config.logoText)}</span></a>
    <form class="search" action="/search" method="get" role="search">
      <input type="search" name="q" value="${q}" placeholder="${t('search_placeholder')}" aria-label="${t('search_aria')}" maxlength="100" autocomplete="off">
      <button type="submit" aria-label="${t('search_submit')}">${icons.search}</button>
    </form>
  </div>
  <nav class="mainnav" aria-label="${t('main_nav')}">
    <div class="wrap">${NAV.map(([href, key, id]) => html`<a href="${href}"${id === nav ? raw(' class="on" aria-current="page"') : ''}>${t(key)}</a>`)}${sponsoredLinks()}</div>
  </nav>
</header>
<div class="wrap lb-wrap">${adSlot('leaderboard')}</div>
<main id="main" class="wrap">
${body}
</main>
<footer class="ftr">
  <div class="wrap">
    <p class="ftr-brand"><span class="logo-txt">${logo(config.logoText)}</span></p>
    ${ft ? html`<p>${ft}</p>` : ''}
    <p class="ftr-small">${t('copyright', { year: new Date().getFullYear(), site: config.siteName })}${config.footer.legal ? html` ${config.footer.legal}` : ''}</p>
    ${legalLinks(consentLink())}
  </div>
</footer>
${stickyBar()}
${consentBanner()}
${adsBodyEnd()}
${adsScript() ? html`<script src="${asset(adsScript())}" defer></script>` : ''}
${config.ageGate.mode !== 'off' ? html`<script src="${asset('/static/js/age.js')}" defer></script>` : ''}
<script src="${asset('/static/js/site.js')}" defer></script>
${scripts.map(s => html`<script src="${asset(s)}" defer></script>`)}
</body>
</html>`;
}

export function pagination(page, total, size, makeHref) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return '';
  const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(n => n >= 1 && n <= pages));
  const sorted = [...nums].sort((a, b) => a - b);
  const items = [];
  if (page > 1) items.push(html`<a class="pg pg-prev" href="${makeHref(page - 1)}" rel="prev">${t('pagination.prev')}</a>`);
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) items.push(html`<span class="pg pg-gap">…</span>`);
    items.push(n === page ? html`<span class="pg on" aria-current="page">${n}</span>` : html`<a class="pg" href="${makeHref(n)}">${n}</a>`);
  });
  if (page < pages) items.push(html`<a class="pg pg-next" href="${makeHref(page + 1)}" rel="next">${t('pagination.next')}</a>`);
  return html`<nav class="pager" aria-label="${t('pagination.aria')}">${items}</nav>`;
}
