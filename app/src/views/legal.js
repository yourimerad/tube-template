// Adult-audience extras: RTA label (meta + "Rating" header in server.js), footer legal links, /legal/2257
// /legal/dmca /legal/report /legal/ncii pages (template text from locales "legal", placeholders filled from
// site.config.json "legal"; legal.synthetic true -> the "all content is synthetic" 2257 statement), the age gate
// (no ads, no loader, nothing explicit: logo + warning + buttons only) and the simulated age verifier
// (age_gate.mode "sim", tests only).
import { html, raw } from '../html.js';
import { config } from '../config.js';
import { asset } from '../assets.js';
import { t, strings } from '../i18n.js';
import { themeHref, faviconHref } from '../theme.js';

const adult = config.audience === 'adult';
export const LEGAL_PAGES = ['2257', 'dmca', 'report', 'ncii'];
export const RTA = 'RTA-5042-1996-1400-1577-RTA';

// RTA "Restricted To Adults" label (rtalabel.org): lets parental filters block the site.
export const rtaMeta = () => (adult ? raw(`<meta name="RATING" content="${RTA}">`) : '');

export function legalLinks(extra = '') {
  const links = adult ? LEGAL_PAGES.map(k => html`<a href="/legal/${k}">${t(`legal.links.${k}`)}</a>`) : [];
  if (!links.length && !extra) return '';
  return html`<p class="ftr-links">${links}${extra}</p>`;
}

const fill = s => String(s).replace(/\{(\w+)\}/g, (m, k) => {
  if (k === 'site') return config.siteName;
  const v = config.legal?.[k];
  return v ? String(v) : `[${t('legal.missing', { key: `legal.${k}` })}]`;
});

// gate: the age-gate pages carry <html data-age-gate> (the SimAds loader and any ad script stay inert there).
function bare({ title, body, robots = config.private, gate = false }) {
  return html`<!doctype html>
<html lang="${strings.lang}"${gate ? html` data-age-gate` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - ${config.siteName}</title>
${robots ? html`<meta name="robots" content="noindex, nofollow">` : ''}
${rtaMeta()}
<link rel="icon" href="${faviconHref}" type="image/svg+xml">
<link rel="stylesheet" href="${asset('/static/css/site.css')}">
<link rel="stylesheet" href="${themeHref}">
</head>
<body class="bare">
<main id="main" class="wrap bare-main">
${body}
</main>
<footer class="ftr"><div class="wrap">
  <p class="ftr-small">${t('copyright', { year: new Date().getFullYear(), site: config.siteName })}${config.footer.legal ? html` ${config.footer.legal}` : ''}</p>
  ${legalLinks()}
</div></footer>
</body>
</html>`;
}

// NCII removal request (TAKE IT DOWN Act, 48 h): a mailto form (no data stored by the site).
function nciiForm() {
  const to = config.legal?.report_email || config.legal?.email || '';
  if (!to) return '';
  const f = k => t(`legal.ncii.${k}`);
  return html`<form class="legal-form" method="post" action="mailto:${to}?subject=${encodeURIComponent(`NCII removal request - ${config.siteName}`)}" enctype="text/plain">
    <label>${f('form_urls')}<textarea name="urls" rows="3" required></textarea></label>
    <label>${f('form_desc')}<textarea name="description" rows="4" required></textarea></label>
    <label>${f('form_contact')}<input type="email" name="contact" required></label>
    <label>${f('form_sign')}<input type="text" name="signature" required></label>
    <label class="legal-check"><input type="checkbox" name="good_faith" value="yes" required> ${f('form_good_faith')}</label>
    <button type="submit" class="btn">${f('form_send')}</button>
  </form>`;
}

export function legalPage(kind) {
  const key = kind === '2257' && config.legal?.synthetic === true ? '2257_synthetic' : kind;
  const d = strings.legal?.[key] || {};
  const paras = Array.isArray(d.body) ? d.body : [];
  const body = html`<article class="legal">
    <h1>${d.title || kind}</h1>
    ${paras.map(p => html`<p>${fill(p)}</p>`)}
    ${kind === 'ncii' ? nciiForm() : ''}
    ${kind === 'report' ? html`<p><a href="/legal/ncii">${t('legal.links.ncii')}</a></p>` : ''}
    <p><a class="btn" href="/">${t('errors.back_home')}</a></p>
  </article>`;
  return bare({ title: d.title || kind, body, robots: config.private });
}

// The age gate, served in place of any page until the visitor passes it. Identical for every visitor of the same
// geo rule (nginx keys its cache on it). rule: 'verify' (provider / sim) | 'click' (18+ button) | 'block'.
export function gatePage({ next = '/', error = '', rule = 'verify' } = {}) {
  const g = config.ageGate;
  if (rule === 'block') {
    return bare({ title: t('age.blocked_title'), gate: true, body: html`<section class="gate" role="dialog" aria-labelledby="gate-h">
      <p class="gate-logo">${config.siteName}</p><h1 id="gate-h">${t('age.blocked_title')}</h1><p>${t('age.blocked_text')}</p></section>` });
  }
  const provider = g.mode === 'sim' ? t('age.sim_provider') : (g.provider.name || t('age.provider_default'));
  const action = g.mode === 'click' || rule === 'click'
    ? html`<form method="post" action="/age/confirm" class="gate-form">
        <input type="hidden" name="next" value="${next}">
        <button type="submit" class="btn gate-enter">${t('age.enter')}</button>
        <a class="btn btn-ghost gate-leave" href="${g.exit_url}" rel="nofollow">${t('age.leave')}</a>
      </form>`
    : html`<div class="gate-form">
        <a class="btn gate-enter" href="/age/start?next=${encodeURIComponent(next)}" rel="nofollow">${t('age.verify_with', { provider })}</a>
        <a class="btn btn-ghost gate-leave" href="${g.exit_url}" rel="nofollow">${t('age.leave')}</a>
      </div>
      <p class="gate-small">${t('age.verify_note')}</p>`;
  const body = html`<section class="gate" role="dialog" aria-labelledby="gate-h">
    <p class="gate-logo">${config.siteName}</p>
    <h1 id="gate-h">${t('age.title')}</h1>
    <p>${t('age.warning')}</p>
    ${error ? html`<p class="gate-err" role="alert">${error}</p>` : ''}
    ${action}
  </section>`;
  return bare({ title: t('age.title'), gate: true, body });
}

// Fake verifier for age_gate.mode "sim" (never on a public site: lib/config.mjs refuses it).
export function simVerifierPage({ returnUrl, state }) {
  const form = (ok, label) => html`<form method="post" action="/age/sim">
    <input type="hidden" name="return_url" value="${returnUrl}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="result" value="${ok ? '1' : '0'}">
    <button type="submit" class="btn${ok ? '' : ' btn-ghost'}" data-sim-result="${ok ? '1' : '0'}">${label}</button>
  </form>`;
  const body = html`<section class="gate gate-sim">
    <p class="gate-logo">${t('age.sim_provider')}</p>
    <h1>${t('age.sim_title')}</h1>
    <p>${t('age.sim_text')}</p>
    <div class="gate-form">${form(true, t('age.sim_ok'))}${form(false, t('age.sim_fail'))}</div>
  </section>`;
  return bare({ title: t('age.sim_title'), gate: true, body });
}
