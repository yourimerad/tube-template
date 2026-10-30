// Runtime configuration.
//  - Site-level settings come from site.json (generated from site.config.json by `./tube`, baked into the image).
//  - Environment-level settings come from the environment (SITE_HOST, PRIVATE, MEDIA_BASE, ADS_MODE, SITE_SCHEME,
//    PG*, HASH_SALT): they differ between local dev and a deployed box, the site.json does not.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

const siteFile = env.SITE_JSON || join(appDir, 'site.json');
const site = existsSync(siteFile) ? JSON.parse(readFileSync(siteFile, 'utf8')) : {};
if (!existsSync(siteFile)) console.warn(`[config] ${siteFile} not found: using built-in defaults (run ./tube from the repo root)`);

const lang = ['fr', 'en'].includes(site.language) ? site.language : 'en';
const ADS_MODES = ['placeholder', 'off', 'live'];
const adsMode = ADS_MODES.includes(env.ADS_MODE) ? env.ADS_MODE : (ADS_MODES.includes(site.ads?.mode) ? site.ads.mode : 'placeholder');
const slots = { leaderboard: true, sidebar: true, inline_mobile: true, native: true, sticky: true, preroll: true, ...(site.ads?.slots || {}) };

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
  private: bool(env.PRIVATE, site.private !== false), // fail closed: private unless PRIVATE=0 / "private": false
  mediaBase: (env.MEDIA_BASE || site.media_base || '/media').replace(/\/+$/, ''),
  mediaDir: env.MEDIA_DIR || '/srv/media',
  adsMode,
  ads: {
    slots: adsMode === 'off' ? Object.fromEntries(Object.keys(slots).map(k => [k, false])) : slots,
    vastUrl: adsMode === 'off' ? '' : (env.ADS_VAST_URL || site.ads?.vast_url || ''),
    housePreroll: adsMode !== 'off' && site.ads?.house_preroll !== false,
    nativeEvery: Math.max(2, Number(site.ads?.native_every) || 8),
    cspOrigins: Array.isArray(site.ads?.csp_origins) ? site.ads.csp_origins.filter(o => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) : [],
  },
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
