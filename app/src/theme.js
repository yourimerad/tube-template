// Per-site theme: accent + content-label colours from site.json, served as /theme.css and /favicon.svg
// (CSP forbids inline styles). Both URLs carry ?v=<hash> and are cached as immutable.
import { createHash } from 'node:crypto';
import { config } from './config.js';

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = rgb => `#${rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, w) => a.map((c, i) => c * (1 - w) + b[i] * w);
const lum = rgb => {
  const [r, g, b] = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const acc = hex(config.accent);
const accent2 = toHex(mix(acc, [0, 0, 0], 0.15));
// Text drawn on the accent: a very dark shade of it on light accents, white on dark ones.
const ink = lum(acc) > 0.33 ? toHex(mix(acc, [0, 0, 0], 0.88)) : '#ffffff';
const lab = hex(config.label.color);
const labText = toHex(mix(lab, [255, 255, 255], 0.2));

export const themeCss = `:root{--accent:${config.accent};--accent-2:${accent2};--accent-ink:${ink};`
  + `--ia:${config.label.color};--ia-text:${labText};--ia-bg:rgba(${lab.join(',')},.12);--ia-border:rgba(${lab.join(',')},.55);--ia-glow:rgba(${lab.join(',')},.25)}\n`;

export const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="8" fill="${config.accent}" transform="rotate(-6 16 16)"/><path d="M12.5 9.5v13l10-6.5z" fill="${ink}"/></svg>`;

const h = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
export const themeHref = `/theme.css?v=${h(themeCss)}`;
export const faviconHref = `/favicon.svg?v=${h(faviconSvg)}`;
