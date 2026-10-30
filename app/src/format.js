// Display helpers, localised through Intl + locales/<lang>.json.
import { locale, t, tn } from './i18n.js';

const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat(locale);
const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });

export function compact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${nf1.format(n / 1e6)} M`;
  if (n >= 1e4) return `${nf1.format(n / 1e3)} k`;
  return nf0.format(n);
}

export const views = n => tn('views', Number(n) || 0, { n: compact(n) });

export function duration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function ago(date, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000));
  if (s < 60) return t('time.just_now');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 86400 * 30) return rtf.format(-Math.floor(s / 86400), 'day');
  if (s < 86400 * 365) return rtf.format(-Math.floor(s / (86400 * 30)), 'month');
  return rtf.format(-Math.floor(s / (86400 * 365)), 'year');
}

export const longDate = d => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));

// Rating % or null when nobody voted.
export const ratingPct = (likes, dislikes) => {
  const t2 = Number(likes) + Number(dislikes);
  return t2 > 0 ? Math.round((Number(likes) / t2) * 100) : null;
};

export const isHd = v => Math.min(Number(v.width) || 0, Number(v.height) || 0) >= 720;
