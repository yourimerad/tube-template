#!/usr/bin/env node
// site.config.json loader: JSONC -> schema validation -> defaults -> derived values.
//
//   node lib/config.mjs validate            exit 1 with the list of problems if invalid
//   node lib/config.mjs json                resolved config (all defaults filled), JSON
//   node lib/config.mjs get <dotted.key>    one resolved value (JSON for objects/arrays, raw otherwise)
//   node lib/config.mjs shell               bash assignments for the infra scripts (eval "$(...)")
//   node lib/config.mjs runtime <file>      write the app's public runtime config (app/site.json)
//
// Config file: --config FILE, else $TUBE_CONFIG, else ./site.config.json. Relative paths inside the
// config are relative to the config file. Secrets are referenced by NAME (files in $TUBE_SECRETS_DIR,
// default ~/.secrets) and never read here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './jsonc.mjs';
import { validate } from './validate.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(REPO, 'site.config.schema.json');

export const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const DEFAULT_LADDER = [
  { short: 720, video_kbps: 2500, audio_kbps: 128 },
  { short: 480, video_kbps: 1200, audio_kbps: 96 },
  { short: 360, video_kbps: 700, audio_kbps: 64 },
  { short: 240, video_kbps: 400, audio_kbps: 64 },
];

const expandHome = p => (p && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const resolveFrom = (dir, p) => (p ? path.resolve(dir, expandHome(p)) : '');

export function configPath(argv = process.argv) {
  const i = argv.indexOf('--config');
  const p = i >= 0 ? argv[i + 1] : process.env.TUBE_CONFIG || 'site.config.json';
  return path.resolve(p);
}

export function readRaw(file) {
  if (!fs.existsSync(file)) throw new Error(`no config at ${file} (run ./tube init, or pass --config / TUBE_CONFIG)`);
  return parseJsonc(fs.readFileSync(file, 'utf8'), path.basename(file));
}

export function schemaErrors(raw) {
  return validate(JSON.parse(fs.readFileSync(SCHEMA, 'utf8')), raw);
}

export function locale(lang) {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'app', 'locales', `${lang}.json`), 'utf8'));
}

// Fill defaults + derive. Assumes schema-valid input.
export function resolve(raw, file) {
  const dir = path.dirname(file);
  const s = raw.site || {};
  const language = s.language || 'en';
  const loc = locale(language);
  const slug = s.slug || slugify(s.name).slice(0, 24).replace(/-+$/, '') || 'site';
  const d = raw.deploy || {};
  const prefix = d.prefix || `${slug.replace(/^[^a-z]+/, '') || 'site'}-`;
  const ovh = d.ovh || {};
  const ssh = d.ssh || {};
  const st = d.storage || {};
  const ing = raw.ingest || {};
  const ads = raw.ads || {};
  const secretsDir = process.env.TUBE_SECRETS_DIR || path.join(os.homedir(), '.secrets');
  const label = raw.content_label || {};
  const target = d.target || 'ovh';
  return {
    file, dir, repo: REPO,
    site: {
      name: s.name, slug, tagline: s.tagline || '', description: s.description || '', language,
      accent_color: s.accent_color || '#2ee6b6', logo_text: s.logo_text || s.name,
    },
    content_label: {
      enabled: label.enabled !== false,
      text: label.text || loc.content_label_default,
      badge: label.badge || loc.content_badge_default,
      color: label.color || '#ff5d6c',
    },
    footer: { text: raw.footer?.text ?? null, legal: raw.footer?.legal || '' },
    private: raw.private !== false,
    media_base: raw.media_base || '/media',
    strings: raw.strings || {},
    videos: {
      dir: resolveFrom(dir, raw.videos.dir),
      manifest: resolveFrom(dir, raw.videos.manifest || ''),
      default_category: raw.videos.default_category || (language === 'fr' ? 'Vidéos' : 'Videos'),
      extensions: raw.videos.extensions || ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'],
    },
    categories: raw.categories || {},
    ingest: {
      out_dir: resolveFrom(dir, ing.out_dir || 'out'),
      ladder: [...(ing.ladder || DEFAULT_LADDER)].sort((a, b) => b.short - a.short),
      segment_seconds: ing.segment_seconds ?? 4,
      crf: ing.crf ?? 23,
      preview_seconds: ing.preview_seconds ?? 6,
      preview_snippets: ing.preview_snippets ?? 6,
      preview_max_kb: ing.preview_max_kb ?? 400,
      poster_position: ing.poster_position ?? 0.35,
      versioned_paths: ing.versioned_paths !== false,
      jobs: ing.jobs ?? 2,
    },
    ads: {
      mode: ads.mode || 'placeholder',
      slots: { leaderboard: true, sidebar: true, inline_mobile: true, native: true, sticky: true, preroll: true, ...(ads.slots || {}) },
      vast_url: ads.vast_url || '',
      house_preroll: ads.house_preroll !== false,
      native_every: ads.native_every ?? 8,
      csp_origins: ads.csp_origins || [],
    },
    dev: { port: raw.dev?.port ?? 18190 },
    deploy: {
      target, prefix,
      domain: d.domain || '',
      tls: d.tls !== false,
      letsencrypt_email: d.letsencrypt_email || '',
      remote_root: d.remote_root || `/srv/${slug}`,
      media_origin: d.media_origin || 'bucket',
      ssh_key: resolveFrom(dir, d.ssh_key || '~/.ssh/id_ed25519'),
      basic_auth: { user: d.basic_auth?.user || 'viewer', password_secret: d.basic_auth?.password_secret || `${slug}-basic-auth` },
      ovh: {
        project_id: ovh.project_id || '',
        endpoint: (ovh.endpoint || 'https://eu.api.ovh.com/v1').replace(/\/+$/, ''),
        token_secret: ovh.token_secret || 'ovh-api-token',
        region: ovh.region || 'GRA11',
        fallback_regions: ovh.fallback_regions || ['SBG5', 'GRA9', 'DE1'],
        web_flavor: ovh.web_flavor || 'd2-4',
        loadgen_flavor: ovh.loadgen_flavor || 'd2-8',
        image: ovh.image || 'Ubuntu 24.04',
        cap_minutes: ovh.cap_minutes ?? 360,
        loadgen_cap_minutes: ovh.loadgen_cap_minutes ?? 90,
        max_instances: ovh.max_instances ?? 2,
        protected_ids: ovh.protected_ids || [],
      },
      ssh: {
        host: ssh.host || '', user: ssh.user || 'ubuntu', port: ssh.port ?? 22,
        allow_ssh_from: ssh.allow_ssh_from || 'any', harden: ssh.harden === true,
      },
      storage: {
        provider: st.provider || 'Other',
        endpoint: st.endpoint || 'https://s3.gra.io.cloud.ovh.net',
        region: st.region || 'gra',
        bucket: st.bucket || '',
        access_key_secret: st.access_key_secret || 'ovh-s3-access-key',
        secret_key_secret: st.secret_key_secret || 'ovh-s3-secret-key',
        price_gb_month: st.price_gb_month ?? 0.007,
      },
    },
    paths: {
      runs: path.join(dir, 'runs'),
      dev: path.join(dir, '.dev'),
      secrets: secretsDir,
      media: path.join(resolveFrom(dir, ing.out_dir || 'out'), 'media'),
    },
    auth_realm: loc.auth_realm || 'Private',
  };
}

// Problems the schema cannot express.
export function crossErrors(c) {
  const e = [];
  const p = c.deploy.prefix;
  if (c.deploy.storage.bucket && !c.deploy.storage.bucket.startsWith(p)) e.push(`deploy.storage.bucket "${c.deploy.storage.bucket}" must start with the prefix "${p}"`);
  if (c.ingest.ladder.length !== new Set(c.ingest.ladder.map(r => r.short)).size) e.push('ingest.ladder: duplicate "short" values');
  for (const k of Object.keys(c.categories)) if (k !== slugify(k)) e.push(`categories: key "${k}" is not a slug (use "${slugify(k)}")`);
  if (/^https?:\/\//.test(c.media_base) === false && !c.media_base.startsWith('/')) e.push('media_base: must start with / or http(s)://');
  return e;
}

export function load(file = configPath()) {
  const raw = readRaw(file);
  const errs = schemaErrors(raw);
  if (errs.length) { const err = new Error(`invalid ${file}:\n  ${errs.join('\n  ')}`); err.list = errs; throw err; }
  const c = resolve(raw, file);
  const x = crossErrors(c);
  if (x.length) { const err = new Error(`invalid ${file}:\n  ${x.join('\n  ')}`); err.list = x; throw err; }
  return c;
}

// The app's public runtime config (no secret, no host path).
export function runtime(c) {
  return {
    name: c.site.name, slug: c.site.slug, tagline: c.site.tagline, description: c.site.description,
    language: c.site.language, accent_color: c.site.accent_color, logo_text: c.site.logo_text,
    content_label: c.content_label, footer: c.footer, private: c.private, media_base: c.media_base,
    ads: c.ads, categories: c.categories, strings: c.strings,
  };
}

const q = v => `'${String(v).replace(/'/g, `'\\''`)}'`;
const arr = a => `(${a.map(q).join(' ')})`;

export function shell(c) {
  const d = c.deploy;
  const sec = n => path.join(c.paths.secrets, n);
  const v = {
    CFG_FILE: c.file, CFG_DIR: c.dir, REPO_DIR: c.repo,
    SITE_NAME: c.site.name, SITE_SLUG: c.site.slug, SITE_LANG: c.site.language, SITE_PRIVATE: c.private ? 1 : 0,
    MEDIA_BASE: c.media_base, AUTH_REALM: c.auth_realm, LABEL_TEXT: c.content_label.enabled ? c.content_label.text : '',
    VIDEOS_DIR: c.videos.dir, OUT_DIR: c.ingest.out_dir, MEDIA_OUT: c.paths.media,
    RUNS_DIR: c.paths.runs, DEV_DIR: c.paths.dev, SECRETS_DIR: c.paths.secrets, DEV_PORT: c.dev.port,
    TARGET: d.target, TUBE_PREFIX: d.prefix, PARK_PREFIX: `${d.prefix}park-`, WEB_NAME: `${d.prefix}web-1`,
    LOADGEN_NAME: `${d.prefix}loadgen`, KEY_NAME: `${d.prefix}key`, WATCHDOG_UNIT: `${d.prefix}watchdog`,
    DOMAIN: d.domain, TLS: d.tls ? 1 : 0, LE_EMAIL: d.letsencrypt_email, REMOTE_ROOT: d.remote_root,
    MEDIA_ORIGIN: d.media_origin, SSH_KEY: d.ssh_key, BASIC_USER: d.basic_auth.user, BASIC_FILE: sec(d.basic_auth.password_secret),
    OVH_PROJECT: d.ovh.project_id, OVH_API: d.ovh.endpoint, OVH_TOKEN_FILE: sec(d.ovh.token_secret),
    OVH_REGION_CFG: d.ovh.region, WEB_FLAVOR: d.ovh.web_flavor, LOADGEN_FLAVOR: d.ovh.loadgen_flavor,
    OVH_IMAGE: d.ovh.image, CAP_WEB: d.ovh.cap_minutes, CAP_LOADGEN: d.ovh.loadgen_cap_minutes, MAX_INSTANCES: d.ovh.max_instances,
    SSH_HOST: d.ssh.host, SSH_USER: d.ssh.user, SSH_PORT: d.ssh.port, SSH_ALLOW_FROM: d.ssh.allow_ssh_from, SSH_HARDEN: d.ssh.harden ? 1 : 0,
    S3_PROVIDER: d.storage.provider, S3_ENDPOINT: d.storage.endpoint, S3_REGION: d.storage.region, S3_BUCKET_CFG: d.storage.bucket,
    S3_ACCESS_FILE: sec(d.storage.access_key_secret), S3_SECRET_FILE: sec(d.storage.secret_key_secret), STORAGE_PRICE: d.storage.price_gb_month,
  };
  const lines = Object.entries(v).map(([k, val]) => `${k}=${q(val)}`);
  lines.push(`OVH_FALLBACK_REGIONS=${arr(d.ovh.fallback_regions)}`, `PROTECTED_IDS=${arr(d.ovh.protected_ids)}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2).filter((a, i, all) => a !== '--config' && all[i - 1] !== '--config');
  const [cmd, arg] = args;
  const file = configPath();
  try {
    if (cmd === 'validate') {
      const c = load(file);
      console.log(`ok: ${file} (site "${c.site.name}", slug ${c.site.slug}, ${c.site.language}, target ${c.deploy.target}, prefix ${c.deploy.prefix})`);
      return;
    }
    const c = load(file);
    if (cmd === 'json') process.stdout.write(`${JSON.stringify(c, null, 2)}\n`);
    else if (cmd === 'get') {
      const v = String(arg || '').split('.').reduce((o, k) => (o == null ? o : o[k]), c);
      if (v === undefined) { console.error(`no key ${arg}`); process.exit(2); }
      process.stdout.write(typeof v === 'object' ? `${JSON.stringify(v)}\n` : `${v}\n`);
    } else if (cmd === 'shell') process.stdout.write(shell(c));
    else if (cmd === 'runtime') {
      const out = arg || path.join(REPO, 'app', 'site.json');
      fs.writeFileSync(`${out}.tmp`, `${JSON.stringify(runtime(c), null, 2)}\n`);
      fs.renameSync(`${out}.tmp`, out);
      console.error(`wrote ${path.relative(process.cwd(), out) || out}`);
    } else {
      console.error('usage: node lib/config.mjs [--config FILE] validate|json|get <key>|shell|runtime [out]');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
