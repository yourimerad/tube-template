import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { strings } from './i18n.js';

// Postgres text-search configuration for the site language ('french' / 'english'), whitelisted.
export const TS_CONFIG = ['french', 'english', 'simple'].includes(strings.ts_config) ? strings.ts_config : 'simple';

const here = dirname(fileURLToPath(import.meta.url));
export const pool = new pg.Pool(config.db);
export const q = (text, params) => pool.query(text, params);

export async function waitForDb(log, tries = 60) {
  for (let i = 1; ; i++) {
    try { await q('SELECT 1'); return; } catch (err) {
      if (i >= tries) throw err;
      log.info({ attempt: i }, 'waiting for database');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Plain SQL files in migrations/, applied once each, in name order, under an advisory lock
// so several app replicas can start at the same time.
export async function migrate(log) {
  const dir = join(here, '..', 'migrations');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map(r => r.version));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
        await client.query('COMMIT');
        log.info({ migration: f }, 'migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

// Salt for visitor/IP hashes: HASH_SALT env if set, otherwise a random value persisted in the DB
// on first boot (so hashes stay stable across restarts).
export async function loadSalt(log) {
  if (config.hashSalt) return config.hashSalt;
  const fresh = randomBytes(32).toString('base64url');
  await q(`INSERT INTO settings (key, value) VALUES ('hash_salt', $1) ON CONFLICT (key) DO NOTHING`, [fresh]);
  const { rows } = await q(`SELECT value FROM settings WHERE key = 'hash_salt'`);
  log.warn('HASH_SALT not set: using a random salt stored in the database');
  return rows[0].value;
}

const slugify = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'video';
const humanize = slug => slug.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

// Idempotent seed from <media>/catalog.json (pipeline output) + the "categories" overrides of site.json.
//  - categories: slug + display name from the catalog (derived from the video folder names), then renamed /
//    re-ordered / hidden by site.json; categories that left the catalog are hidden
//  - videos: upserted (counters never touched); videos that left the catalog, or whose category is hidden,
//    are hidden (their rows and counters stay, so re-adding a video restores it)
export async function seed(log) {
  const path = join(config.mediaDir, 'catalog.json');
  let catalog;
  try {
    catalog = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    log.warn({ path, err: err.code || err.message }, 'no catalog.json: skipping video seed');
    return 0;
  }
  if (!Array.isArray(catalog)) throw new Error('catalog.json must be an array');

  const cats = new Map(); // slug -> { name, position, hidden }
  for (const v of catalog) {
    const slug = slugify(v?.category || 'videos');
    if (!cats.has(slug)) cats.set(slug, { name: String(v.category_name || humanize(slug)).slice(0, 80), position: 1000 + cats.size, hidden: false });
  }
  for (const [slug, o] of Object.entries(config.categories || {})) {
    const c = cats.get(slug);
    if (!c) continue; // only categories that exist in the catalog
    if (o.name) c.name = String(o.name).slice(0, 80);
    if (Number.isFinite(Number(o.position))) c.position = Number(o.position);
    if (o.hidden) c.hidden = true;
  }
  for (const [slug, c] of cats) {
    await q(`INSERT INTO categories (slug, name, position, hidden) VALUES ($1, $2, $3, $4)
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position, hidden = EXCLUDED.hidden`,
      [slug, c.name, c.position, c.hidden]);
  }
  await q('UPDATE categories SET hidden = true WHERE NOT (slug = ANY($1::text[]))', [[...cats.keys()]]);

  const ts = TS_CONFIG;
  const ids = [];
  let n = 0;
  for (const v of catalog) {
    if (!v || !/^[a-z0-9]{4,32}$/.test(String(v.id))) { log.warn({ id: v?.id }, 'skipping catalog entry with bad id'); continue; }
    const cat = slugify(v.category || 'videos');
    const mediaPath = /^[a-z0-9]{4,32}(\/[a-z0-9]{1,16})?$/.test(String(v.media_path || '')) ? v.media_path : v.id;
    const tags = [...new Set((Array.isArray(v.tags) ? v.tags : []).map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
    const title = String(v.title || v.slug || v.id).slice(0, 200);
    const desc = String(v.description || '').slice(0, 5000);
    const created = v.created_at && !Number.isNaN(Date.parse(v.created_at)) ? v.created_at : null;
    const hidden = !!v.hidden || !!cats.get(cat)?.hidden;
    await q(`INSERT INTO videos (id, slug, title, description, category_slug, tags, duration_s, width, height,
                                 renditions, source, published_at, tsv, media_path, hidden)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()),
                     setweight(to_tsvector('${ts}', f_unaccent($3)), 'A') || setweight(to_tsvector('${ts}', f_unaccent(array_to_string($6::text[], ' '))), 'B')
                     || setweight(to_tsvector('${ts}', f_unaccent($4)), 'C'), $13, $14)
             ON CONFLICT (id) DO UPDATE SET
               slug = EXCLUDED.slug, title = EXCLUDED.title, description = EXCLUDED.description,
               category_slug = EXCLUDED.category_slug, tags = EXCLUDED.tags, duration_s = EXCLUDED.duration_s,
               width = EXCLUDED.width, height = EXCLUDED.height, renditions = EXCLUDED.renditions,
               source = EXCLUDED.source, tsv = EXCLUDED.tsv, media_path = EXCLUDED.media_path, hidden = EXCLUDED.hidden,
               published_at = COALESCE($12::timestamptz, videos.published_at)`,
      [v.id, slugify(v.slug || title), title, desc, cat, tags, Number(v.duration_s) || 0,
       Number(v.width) || 0, Number(v.height) || 0, JSON.stringify(v.renditions || []), v.source ? String(v.source) : null, created,
       mediaPath, hidden]);
    ids.push(String(v.id));
    n++;
  }
  const gone = await q('UPDATE videos SET hidden = true WHERE NOT hidden AND NOT (id = ANY($1::text[]))', [ids]);
  log.info({ videos: n, categories: cats.size, hidden_gone: gone.rowCount }, 'catalog seeded');
  return n;
}
