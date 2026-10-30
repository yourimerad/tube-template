#!/usr/bin/env node
// `./tube init`: writes site.config.json (validated against site.config.schema.json).
//   interactive:      node lib/init.mjs
//   non-interactive:  node lib/init.mjs --yes --name "My Site" --videos ~/videos [options]
// Options (all optional with --yes except --name):
//   --name --tagline --lang fr|en --accent '#rrggbb' --videos DIR --manifest FILE --label on|off
//   --target ovh|ssh --prefix p- --project <ovh project id> --region GRA11 --ssh-host H --ssh-user U --ssh-port N
//   --media-origin bucket|rsync --s3-endpoint URL --s3-region R --domain D --port N
//   --out FILE (default ./site.config.json)  --force (overwrite)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { schemaErrors, resolve, crossErrors, slugify } from './config.mjs';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { console.error(`unexpected argument ${a}`); process.exit(2); }
  const k = a.slice(2);
  if (['yes', 'force'].includes(k)) flags[k] = true;
  else { flags[k] = argv[++i]; if (flags[k] === undefined) { console.error(`${a} needs a value`); process.exit(2); } }
}
const known = ['yes', 'force', 'name', 'tagline', 'lang', 'accent', 'videos', 'manifest', 'label', 'target', 'prefix', 'project',
  'region', 'ssh-host', 'ssh-user', 'ssh-port', 'media-origin', 's3-endpoint', 's3-region', 'domain', 'port', 'out'];
for (const k of Object.keys(flags)) if (!known.includes(k)) { console.error(`unknown option --${k}`); process.exit(2); }

const out = path.resolve(flags.out || 'site.config.json');
if (fs.existsSync(out) && !flags.force) {
  console.error(`${out} already exists (use --force to overwrite, or edit it by hand)`);
  process.exit(1);
}

const checks = {
  name: v => (v.trim().length >= 1 && v.length <= 40) || '1 to 40 characters',
  lang: v => ['fr', 'en'].includes(v) || 'fr or en',
  accent: v => /^#[0-9a-fA-F]{6}$/.test(v) || 'a #rrggbb colour',
  videos: v => v.trim().length > 0 || 'a folder path',
  manifest: v => v === '' || /\.(csv|json)$/i.test(v) || '.csv or .json (or empty)',
  label: v => ['on', 'off'].includes(v) || 'on or off',
  target: v => ['ovh', 'ssh'].includes(v) || 'ovh or ssh',
  prefix: v => /^[a-z][a-z0-9-]{0,24}-$/.test(v) || 'lowercase, ends with "-", e.g. mysite-',
  project: v => v === '' || /^[0-9a-f]{32}$/.test(v) || '32 hex characters (or empty for later)',
  region: v => /^[A-Z0-9-]{2,20}$/.test(v) || 'e.g. GRA11',
  'ssh-host': v => v === '' || /^[A-Za-z0-9.:-]+$/.test(v) || 'hostname or IP',
  'ssh-user': v => /^[a-z_][a-z0-9_-]{0,31}$/.test(v) || 'a unix user name',
  'ssh-port': v => (/^\d+$/.test(v) && +v >= 1 && +v <= 65535) || '1-65535',
  'media-origin': v => ['bucket', 'rsync'].includes(v) || 'bucket or rsync',
  's3-endpoint': v => /^https?:\/\/.+/.test(v) || 'https://...',
  domain: v => v === '' || /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v) || 'a hostname (or empty for <ip>.sslip.io)',
  port: v => (/^\d+$/.test(v) && +v >= 1024 && +v <= 65535) || '1024-65535',
};

const rl = flags.yes ? null : readline.createInterface({ input: stdin, output: stdout });
async function ask(key, question, def) {
  if (flags[key] !== undefined) {
    const v = String(flags[key]);
    const ok = checks[key] ? checks[key](v) : true;
    if (ok !== true) { console.error(`--${key}: ${ok}`); process.exit(2); }
    return v;
  }
  if (flags.yes) return def;
  for (;;) {
    const a = (await rl.question(`${question}${def !== '' ? ` [${def}]` : ''}: `)).trim();
    const v = a === '' ? def : a;
    const ok = checks[key] ? checks[key](v) : true;
    if (ok === true) return v;
    console.log(`  -> ${ok}`);
  }
}

if (flags.yes && !flags.name) { console.error('--yes needs at least --name'); process.exit(2); }
if (!flags.yes) console.log('New site configuration (Enter keeps the [default]; everything can be edited later in site.config.json)\n');

const name = await ask('name', 'Site name', 'My Tube');
const lang = await ask('lang', 'Language (fr|en)', 'en');
const tagline = await ask('tagline', 'Tagline / niche', lang === 'fr' ? 'Des vidéos courtes, chaque jour' : 'Short videos, every day');
const accent = await ask('accent', 'Accent colour', '#2ee6b6');
const videos = await ask('videos', 'Video folder (one subfolder per category)', 'videos');
const manifest = await ask('manifest', 'Manifest CSV/JSON (optional)', '');
const label = await ask('label', 'Show the "AI-generated" content label (on|off)', 'on');
const slug = slugify(name).slice(0, 24).replace(/-+$/, '') || 'site';
const prefix = await ask('prefix', 'Cloud resource prefix (every destructive action is limited to it)', `${slug.replace(/^[^a-z]+/, '') || 'site'}-`);
const target = await ask('target', 'Hosting target (ovh|ssh)', 'ovh');
const deploy = { target, prefix };
if (target === 'ovh') {
  const project = await ask('project', 'OVH Public Cloud project id', '');
  const region = await ask('region', 'OVH region', 'GRA11');
  deploy.ovh = { project_id: project, region, fallback_regions: ['SBG5', 'GRA9', 'DE1'].filter(r => r !== region) };
} else {
  const host = await ask('ssh-host', 'SSH host (Ubuntu 22.04/24.04)', '');
  const user = await ask('ssh-user', 'SSH user (root or passwordless sudo)', 'ubuntu');
  const port = Number(await ask('ssh-port', 'SSH port', '22'));
  deploy.ssh = { host, user, port };
}
deploy.media_origin = await ask('media-origin', 'Media origin (bucket = S3 pull, rsync = push from this machine)', target === 'ovh' ? 'bucket' : 'rsync');
if (deploy.media_origin === 'bucket') {
  deploy.storage = {
    endpoint: await ask('s3-endpoint', 'S3 endpoint', 'https://s3.gra.io.cloud.ovh.net'),
    region: flags['s3-region'] || (flags.yes ? 'gra' : (await rl.question('S3 region [gra]: ')).trim() || 'gra'),
    bucket: '',
    access_key_secret: 'ovh-s3-access-key',
    secret_key_secret: 'ovh-s3-secret-key',
  };
}
const domain = await ask('domain', 'Domain (empty = <ip>.sslip.io)', '');
if (domain) deploy.domain = domain;
const port = Number(await ask('port', 'Local dev port', '18190'));
rl?.close();

const rel = p => {
  if (!p) return p;
  const abs = path.resolve(p.replace(/^~(?=\/)/, process.env.HOME || '~'));
  const r = path.relative(path.dirname(out), abs);
  return r.startsWith('..') && path.isAbsolute(p) ? p : r || '.';
};

const cfg = {
  $schema: './site.config.schema.json',
  site: { name, slug, tagline, language: lang, accent_color: accent },
  content_label: { enabled: label === 'on' },
  private: true,
  videos: { dir: rel(videos), ...(manifest ? { manifest: rel(manifest) } : {}) },
  categories: {},
  ads: { mode: 'placeholder' },
  dev: { port },
  deploy,
};

const errs = schemaErrors(cfg);
const x = errs.length ? [] : crossErrors(resolve(cfg, out));
if (errs.length || x.length) { console.error(`config would be invalid:\n  ${[...errs, ...x].join('\n  ')}`); process.exit(1); }
const schemaRel = path.relative(path.dirname(out), path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'site.config.schema.json'));
cfg.$schema = schemaRel.startsWith('.') ? schemaRel : `./${schemaRel}`;
fs.writeFileSync(out, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`\nwrote ${path.relative(process.cwd(), out) || out} (site "${name}", slug ${slug}, ${lang}, target ${target}, prefix ${prefix})`);
if (!fs.existsSync(path.resolve(path.dirname(out), cfg.videos.dir))) console.log(`note: ${cfg.videos.dir} does not exist yet (./tube demo makes a synthetic one)`);
console.log('next: ./tube ingest && ./tube dev');
