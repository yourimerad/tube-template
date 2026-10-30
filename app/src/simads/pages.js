// SimAds HTML pages: demo (every format at once), fake advertiser landing, GEO switch, revenue report.
// Same rules as the site views: no inline script or style (strict CSP), everything escaped by html``.
import { html } from '../html.js';
import { asset } from '../assets.js';
import { themeHref } from '../theme.js';
import { config } from '../config.js';
import { FORMATS } from './auction.js';

const shell = ({ title, body, scripts = [], loader = '' }) => html`<!doctype html>
<html lang="${config.lang || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} - SimAds</title>
<link rel="stylesheet" href="${asset('/static/css/site.css')}">
<link rel="stylesheet" href="${themeHref}">
<link rel="stylesheet" href="/simads/static/simads.css">
${loader ? html`<script async src="/simads/static/loader.js" data-audience="${loader}"></script>` : ''}
</head>
<body class="sa-page">
<header class="sa-top"><div class="wrap">
  <a class="sa-brand" href="/simads/demo">SimAds <span class="sa-pill">simulated ad network</span></a>
  <nav class="sa-nav"><a href="/simads/demo">Demo</a><a href="/simads/report">Report</a><a href="/">${config.siteName}</a></nav>
</div></header>
<main class="wrap sa-main">
${body}
</main>
${scripts.map(s => html`<script src="${s}" defer></script>`)}
</body>
</html>`;

const GEOS = [['US', 'T1'], ['GB', 'T1'], ['FR', 'T1'], ['DE', 'T1'], ['ES', 'T2'], ['BR', 'T2'], ['IN', 'T3'], ['NG', 'T3']];
const ins = (zone, format, extra = {}) => html`<ins class="simads" data-zone="${zone}" data-format="${format}"${
  Object.entries(extra).map(([k, v]) => html` data-${k}="${v}"`)}></ins>`;

export function demoPage({ audience }) {
  const body = html`
<section class="sa-intro">
  <h1>SimAds demo <small>(${audience} audience)</small></h1>
  <p>Every ad format of the simulated network at once. Nothing on this page is a real ad and nobody is paid:
    creatives are drawn by the site itself and clicks land on <a href="/simads/landing">a labelled fake advertiser page</a>.
    The popunder opens a tab on your first click (then is capped), the interstitial shows from the 2nd pageview,
    the in-page push slides in after 3 seconds.</p>
  <p class="sa-geos">GEO: ${GEOS.map(([c, tier]) => html`<a href="/simads/geo?c=${c}&amp;r=/simads/demo">${c} <small>${tier}</small></a>`)}
    <a href="/simads/geo?c=auto&amp;r=/simads/demo">auto</a>
    · fill: <a href="/simads/geo?force=fill&amp;r=/simads/demo">always</a> <a href="/simads/geo?force=nofill&amp;r=/simads/demo">never</a>
    <a href="/simads/geo?force=&amp;r=/simads/demo">real</a></p>
</section>

<h2 class="sa-h">Leaderboard <small>728x90 / mobile 320x50</small></h2>
<div class="sa-slot">${ins('leaderboard', 'banner', { size: '728x90', 'mobile-size': '320x50' })}</div>

<div class="sa-row">
  <div><h2 class="sa-h">Sidebar <small>300x250</small></h2>${ins('sidebar', 'banner', { size: '300x250' })}</div>
  <div><h2 class="sa-h">Skyscraper <small>160x600</small></h2>${ins('skyscraper', 'banner', { size: '160x600' })}</div>
  <div class="sa-col">
    <h2 class="sa-h">Mobile banner <small>300x100</small></h2>${ins('inline_mobile', 'banner', { size: '300x100' })}
    <h2 class="sa-h">Banner <small>468x60</small></h2>${ins('banner_468', 'banner', { size: '468x60' })}
  </div>
</div>

<h2 class="sa-h">Native <small>(in a video grid, shaped like a card)</small></h2>
<div class="grid sa-grid">
  ${[1, 2, 3].map(i => html`<article class="card"><span class="thumb"><span class="thumb-empty"></span></span>
    <h3 class="title"><a href="/">Video card ${i}</a></h3><div class="meta"><span>1.2K views</span></div></article>`)}
  ${ins('native', 'native')}
  ${ins('native_2', 'native')}
</div>

<h2 class="sa-h">Pre-roll <small>VAST 4.2 played by the site's ads-vast.js</small></h2>
<div class="sa-player">
  <div class="sa-video"><video id="sa-vid" playsinline muted preload="none"></video>
    <span class="adlayer-tag">Ad</span>
    <button type="button" class="adskip" id="sa-skip" hidden disabled>Skip</button>
    <p class="sa-vstate" id="sa-vstate">idle</p>
  </div>
  <p><button type="button" class="sa-btn" id="sa-play" data-vast="/simads/vast?zone=preroll">Play pre-roll (InLine)</button>
     <button type="button" class="sa-btn" id="sa-play-w" data-vast="/simads/vast?zone=preroll&amp;wrapper=1">Play pre-roll (Wrapper)</button>
     <a href="/simads/vast?zone=preroll">view VAST XML</a></p>
</div>

<h2 class="sa-h">Footer row <small>900x250 / mobile 300x250</small></h2>
<div class="sa-slot">${ins('footer', 'banner', { size: '900x250', 'mobile-size': '300x250' })}</div>

${ins('popunder', 'popunder', { 'cap-hours': '24' })}
${ins('interstitial', 'interstitial', { every: '2' })}
${ins('inpage_push', 'inpage_push', { delay: '3' })}
${ins('sticky', 'sticky', { size: '728x90', 'mobile-size': '320x50' })}
<div class="sa-spacer"></div>`;
  return shell({ title: 'Demo', body, loader: audience, scripts: [asset('/static/js/ads-vast.js'), '/simads/static/demo.js'] });
}

export function landingPage({ c, partner, format, zone }) {
  return shell({ title: 'Fake advertiser', body: html`
<section class="sa-landing">
  <p class="sa-pill sa-pill-big">Simulated ad · fake advertiser page</p>
  <h1>${c ? c.advertiser : 'SimAds advertiser'}</h1>
  ${c ? html`<p class="sa-lead">${c.headline}. ${c.sub}.</p>` : ''}
  <p>This page stands in for an advertiser's landing page. It belongs to the <b>SimAds</b> simulated ad network
    that runs on this site while it is private: no real company, no product, nothing to buy, nobody was paid.</p>
  <dl class="sa-dl">
    <dt>Demand partner</dt><dd>${partner || '-'}</dd>
    <dt>Format</dt><dd>${format || '-'}</dd>
    <dt>Zone</dt><dd>${zone || '-'}</dd>
  </dl>
  <p><a class="sa-btn" href="/">Back to ${config.siteName}</a></p>
</section>` });
}

export function geoPage({ geo, tier }) {
  return shell({ title: 'GEO', body: html`<section class="sa-landing">
    <h1>${geo ? html`GEO set to ${geo} <small>(${tier})</small>` : 'GEO back to automatic'}</h1>
    <p>SimAds now prices requests from this browser as ${geo || 'detected from headers / language'}.</p>
    <p><a class="sa-btn" href="/simads/demo">Demo</a> <a class="sa-btn" href="/simads/report">Report</a></p></section>` });
}

const usd = n => `$${Number(n).toFixed(Number(n) !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
const pct = n => `${(Number(n) * 100).toFixed(1)}%`;
const int = n => Number(n).toLocaleString('en-US');

function table(title, rows, own) {
  if (!rows.length) return html`<h2 class="sa-h">${title}</h2><p class="sa-empty">No data in this window.</p>`;
  return html`<h2 class="sa-h">${title}</h2>
<div class="sa-tablewrap"><table class="sa-table">
<thead><tr><th></th>${own ? html`<th>Pageviews</th>` : ''}<th>Requests</th><th>Fill</th><th>Impr.</th><th>Viewable</th><th>Clicks</th><th>CTR</th><th>Revenue</th><th>eCPM</th><th>RPM / 1k pv</th></tr></thead>
<tbody>${rows.map(r => html`<tr><th>${r.key}</th>${own ? html`<td>${int(r.pageviews)}</td>` : ''}<td>${int(r.requests)}</td><td>${pct(r.fill_rate)}</td>
<td>${int(r.impressions)}</td><td>${pct(r.viewability)}</td><td>${int(r.clicks)}</td><td>${pct(r.ctr)}</td><td>${usd(r.revenue)}</td>
<td>${usd(r.ecpm)}</td><td>${usd(r.rpm_pageviews)}</td></tr>`)}</tbody></table></div>`;
}

export function reportPage({ r, audience, rates, defaults }) {
  const T = r.totals;
  const tiles = [
    ['Simulated revenue', usd(T.revenue)], ['Pageviews', int(T.pageviews)], ['Visits', int(T.visits)],
    ['Impressions', int(T.impressions)], ['Fill rate', pct(T.fill_rate)], ['Viewability', pct(T.viewability)],
    ['Clicks', int(T.clicks)], ['CTR', pct(T.ctr)], ['eCPM', usd(T.ecpm)],
    ['RPM / 1,000 pageviews', usd(T.rpm_pageviews)], ['RPM / 1,000 visits', usd(T.rpm_visits)],
    ['Video completion', pct(T.video.completion_rate)],
  ];
  const tierRow = (fmt, tier) => {
    const c = rates.audiences[audience][fmt][tier];
    return html`<td>${usd(c.desktop[0])}-${usd(c.desktop[1])}<br><small>mob ${usd(c.mobile[0])}-${usd(c.mobile[1])} · fill ${pct(c.fill)}</small></td>`;
  };
  const body = html`
<section class="sa-intro">
  <h1>SimAds report <small>(${audience} audience, simulated)</small></h1>
  <p>Revenue is what the simulated network would pay: each impression is priced by an auction among fictional demand
    partners drawn from the public net eCPM ranges in <code>app/src/simads/rates.json</code> (by format, GEO tier and device).
    It is an estimate of order of magnitude, not a promise.</p>
  <p class="sa-tabs">${Object.keys({ '1h': 1, '24h': 1, '7d': 1, all: 1 }).map(w => html`<a href="/simads/report?window=${w}"${w === r.window ? html` class="on" aria-current="page"` : ''}>${w}</a>`)}
    <a href="/simads/report.json?window=${r.window}">JSON</a></p>
</section>
<div class="sa-tiles">${tiles.map(([k, v]) => html`<div class="sa-tile"><span>${k}</span><b>${v}</b></div>`)}</div>
${table('By zone', r.by_zone, false)}
${table('By format', r.by_format, false)}
${table('By GEO', r.by_geo, true)}
${table('By device', r.by_device, true)}
${table('By demand partner', r.by_partner, false)}
<h2 class="sa-h">Pre-roll funnel</h2>
<p class="sa-funnel">start ${int(T.video.start)} → 25% ${int(T.video.q1)} → 50% ${int(T.video.mid)} → 75% ${int(T.video.q3)} → complete ${int(T.video.complete)} · skipped ${int(T.video.skip)}</p>
<p class="sa-small">Dropped events: rate limit ${int(r.drops.dropped_rate)}, buffer ${int(r.drops.dropped_buffer)}, bad token ${int(r.drops.rejected_token)}.</p>

<h2 class="sa-h">Projection</h2>
<form class="sa-proj" id="sa-proj" action="/simads/projection" method="get">
  <label>Audience <select name="audience">${['general', 'adult'].map(a => html`<option value="${a}"${a === audience ? html` selected` : ''}>${a}</option>`)}</select></label>
  <label>Daily visitors <input name="visitors" type="number" min="0" step="100" value="1000"></label>
  <label>Pages per visit <input name="pages" type="number" min="1" max="100" step="0.1" value="4"></label>
  <label>Mobile share <input name="mobile" type="number" min="0" max="1" step="0.05" value="0.6"></label>
  <label>Ad-block share <input name="adblock" type="number" min="0" max="1" step="0.05" value="0.25"></label>
  <fieldset><legend>GEO mix (shares, normalized; T1 = other T1 countries at the generic multiplier)</legend>
  ${Object.entries({ US: 0, GB: 0, CA: 0, DE: 0, FR: 0, T1: 0, T2: 0, T3: 0, ...defaults.geo }).map(([k, v]) => html`<label>${k} <input name="g_${k}" type="number" min="0" max="1" step="0.05" value="${v}"></label>`)}</fieldset>
  <fieldset><legend>Ads per page (popunder: per visitor per day, interstitial: 1 per N pageviews, push: per visit, pre-roll: per pageview)</legend>
  ${FORMATS.map(f => html`<label>${f} <input name="m_${f}" type="number" min="0" max="20" step="0.5" value="${defaults.mix[f]}"></label>`)}</fieldset>
  <button type="submit" class="sa-btn">Compute</button>
</form>
<div id="sa-proj-out" class="sa-proj-out" aria-live="polite"></div>

<h2 class="sa-h">Rate table (net eCPM, desktop range; ${audience})</h2>
<div class="sa-tablewrap"><table class="sa-table sa-rates"><thead><tr><th></th><th>T1</th><th>T2</th><th>T3</th></tr></thead>
<tbody>${FORMATS.map(f => html`<tr><th>${f}</th>${tierRow(f, 'T1')}${tierRow(f, 'T2')}${tierRow(f, 'T3')}</tr>`)}</tbody></table></div>
<p class="sa-small">T1 ranges are US-level; per-country multipliers: ${Object.entries(rates.country_multipliers || {}).filter(([k]) => !k.startsWith('_c')).map(([k, v]) => `${k.replace('_T1_other', 'other T1')} ${v}`).join(', ')}.</p>
<p class="sa-small">Assumed rev share for advertiser-side figures: ${pct(rates.rev_share_assumed)}. ${rates.notes.join(' ')}</p>
<ul class="sa-sources">${rates.sources.map(s => html`<li><a href="${s.url}" rel="noreferrer nofollow">${s.url}</a> (${s.published ? `published ${s.published}, ` : ''}read ${s.date}): ${s.took}</li>`)}</ul>

<h2 class="sa-h">Reset</h2>
<form method="post" action="/simads/reset" class="sa-reset"><input type="hidden" name="confirm" value="1">
  <button type="submit" class="sa-btn sa-danger">Delete every SimAds event</button></form>`;
  return shell({ title: 'Report', body, scripts: ['/simads/static/report.js'] });
}
