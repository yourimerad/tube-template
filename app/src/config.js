// Runtime configuration.
//  - Site-level settings come from site.json (generated from site.config.json by `./tube`, baked into the image).
//  - Environment-level settings come from the environment (SITE_HOST, PRIVATE, MEDIA_BASE, ADS_MODE, SITE_SCHEME,
//    PG*, HASH_SALT, AGE_GATE_SECRET, AGE_COOKIE_SECRET): they differ between local dev and a deployed box, the site.json does not.
//  - Ads: site.json "ads" is normalized by ads/normalize.js (old boolean slots keep working); ADS_MODE
//    (off | placeholder | sim | live, `./tube dev --ads X`) overrides ads.mode.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { normalizeAds } from './ads/normalize.js';

const env = process.env;
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

const siteFile = env.SITE_JSON || join(appDir, 'site.json');
const site = existsSync(siteFile) ? JSON.parse(readFileSync(siteFile, 'utf8')) : {};
if (!existsSync(siteFile)) console.warn(`[config] ${siteFile} not found: using built-in defaults (run ./tube from the repo root)`);

const lang = ['fr', 'en'].includes(site.language) ? site.language : 'en';
const isPrivate = bool(env.PRIVATE, site.private !== false); // fail closed: private unless PRIVATE=0 / "private": false
// ADS_MODE=sim is refused on a public site (the simulated network is for rehearsals only).
const modeOverride = env.ADS_MODE === 'sim' && !isPrivate ? '' : env.ADS_MODE;
const ads = normalizeAds(env.ADS_VAST_URL ? { ...site.ads, vast_url: env.ADS_VAST_URL } : site.ads, { language: lang, modeOverride });
if (ads.mode === 'sim' && !isPrivate) ads.mode = 'placeholder';
const adsMode = ads.mode;
const audience = site.audience === 'adult' ? 'adult' : 'general';
const gate = site.age_gate || {};

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  siteName: site.name || 'My Tube',
  siteSlug: site.slug || 'site',
  tagline: site.tagline || '',
  description: site.description || '',
  logoText: site.logo_text || site.name || 'My Tube',
  accent: /^#[0-9a-fA-F]{6}$/.test(site.accent_color || '') ? site.accent_color : '#2ee6b6',
  lang,
  label: {
    enabled: site.content_label?.enabled !== false,
    text: site.content_label?.text || '',
    badge: site.content_label?.badge || '',
    color: /^#[0-9a-fA-F]{6}$/.test(site.content_label?.color || '') ? site.content_label.color : '#ff5d6c',
  },
  footer: { text: site.footer?.text ?? null, legal: site.footer?.legal || '' },
  categories: site.categories || {},
  strings: site.strings || {},
  siteHost: env.SITE_HOST || 'localhost',
  private: isPrivate,
  mediaBase: (env.MEDIA_BASE || site.media_base || '/media').replace(/\/+$/, ''),
  mediaDir: env.MEDIA_DIR || '/srv/media',
  adsMode,
  ads, // normalized: see ads/normalize.js
  audience,
  ageGate: {
    mode: audience === 'adult' ? (['provider', 'click', 'sim', 'off'].includes(gate.mode) ? gate.mode : 'click') : 'off',
    provider: {
      name: gate.provider?.name || '', start_url: gate.provider?.start_url || '',
      verify: { type: gate.provider?.verify?.type || 'hmac', public_key: gate.provider?.verify?.public_key || '', jwks_url: gate.provider?.verify?.jwks_url || '' },
    },
    geo_rules: gate.geo_rules || {},
    exit_url: gate.exit_url || 'https://www.google.com/',
  },
  ageGateSecret: env.AGE_GATE_SECRET || '', // provider HMAC secret (verify.type "hmac")
  // av_sig cookie key, shared with nginx (secure_link_md5); falls back to a key derived from HASH_SALT (then
  // nginx cannot check /media: ./tube dev and deploy always set AGE_COOKIE_SECRET).
  ageCookieSecret: env.AGE_COOKIE_SECRET || (env.HASH_SALT ? createHmac('sha256', env.HASH_SALT).update('age-cookie').digest('hex') : ''),
  legal: site.legal || {},
  hashSalt: env.HASH_SALT || '',
  pageSize: 36,
  db: {
    host: env.PGHOST || 'db',
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || 'tube',
    database: env.PGDATABASE || 'tube',
    password: env.PGPASSWORD || env.POSTGRES_PASSWORD || '',
    max: Number(env.PG_POOL_MAX || 10),
  },
  commentRatePerMin: Number(env.COMMENT_RATE_PER_MIN || 3),
};

// Absolute origin used for canonical links / sitemap / og:image.
export const siteOrigin = () => `${env.SITE_SCHEME || 'https'}://${config.siteHost}`;
