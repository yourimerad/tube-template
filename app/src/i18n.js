// UI strings: locales/<lang>.json, then per-site overrides from site.json "strings" (deep-merged).
// t('watch.share'), t('page_n', { n: 2 }), tn('views', 3) -> plural form via Intl.PluralRules.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const load = lang => JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8'));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
};

export const strings = merge(merge(load('en'), load(config.lang)), config.strings);
export const locale = strings.locale || 'en-US';
const plural = new Intl.PluralRules(locale);

const get = key => key.split('.').reduce((o, k) => (o == null ? o : o[k]), strings);
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

export function t(key, vars) {
  const v = get(key);
  return v === undefined || isObj(v) ? key : fill(v, vars);
}
export function tn(key, n, vars = {}) {
  const forms = get(key) || {};
  const s = forms[plural.select(Number(n) || 0)] ?? forms.other ?? key;
  return fill(s, { n, ...vars });
}

// Content label (the "AI-generated video" disclosure): configurable text/badge, language default.
export const label = {
  enabled: config.label.enabled,
  text: config.label.text || strings.content_label_default,
  badge: config.label.badge || strings.content_badge_default,
};

// Localised paths for the sort pages (/tendances vs /trending).
export const paths = {
  trending: `/${strings.paths.trending}`,
  new: `/${strings.paths.new}`,
  top_rated: `/${strings.paths.top_rated}`,
};

// The subset the browser needs (watch.js), embedded as JSON in the page.
export const clientStrings = () => ({
  locale, watch: strings.watch, views: strings.views, comments_word: strings.comments_word, time: strings.time,
});
