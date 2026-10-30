#!/usr/bin/env node
// Media ingest: a folder of videos -> HLS ladder (fMP4), posters, hover previews, catalog.json.
// Node 24, no npm deps, shells out to ffmpeg/ffprobe (from PATH, or $FFMPEG_BIN_DIR).
//
//   node pipeline/ingest.mjs [--config site.config.json] [--only <id|slug|path>] [--force] [--jobs N]
//                            [--prune] [--dry-run]
//
// Input (site.config.json "videos"):
//   <dir>/<Category folder>/<file>.mp4   each first-level subfolder is a category (deeper folders join it);
//                                        files directly in <dir> go to videos.default_category
//   title = file name cleaned up ("my_best-clip_02.mp4" -> "My best clip 02")
//   optional manifest (CSV or JSON) keyed by relative path or file name, overriding
//   title / description / tags / category / hidden / slug per video (see docs/ARCHITECTURE.md).
//
// Output (ingest.out_dir, default out/):
//   media/<id>/<v>/hls/master.m3u8 + hls/<rung>/{index.m3u8,init.mp4,seg_NNN.m4s}
//   media/<id>/<v>/poster.jpg, poster.webp, preview.mp4
//   media/<id>/.ingest.json                (idempotency state)
//   media/_house/preroll.mp4               (house pre-roll ad, text from the site language)
//   catalog.json and media/catalog.json    (same content; the app seeds its database from it)
// <id> = 8 chars of sha256(relative path): stable while the file keeps its path.
// <v>  = 6 hex of sha256(encoding settings + source size/mtime): a re-encode gets NEW urls, so immutable
//        caches (browser, nginx, CDN) never serve a mix of old and new segments. ingest.versioned_paths=false
//        writes straight into media/<id>/ instead.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { load, configPath, locale, slugify as slugifyBase } from '../lib/config.mjs';

const FF_DIR = process.env.FFMPEG_BIN_DIR || '';
const FFMPEG = FF_DIR ? path.join(FF_DIR, 'ffmpeg') : 'ffmpeg';
const FFPROBE = FF_DIR ? path.join(FF_DIR, 'ffprobe') : 'ffprobe';

// Bump when the encoding code changes: every video gets a new <v> and is re-encoded on the next run.
const PIPELINE_VERSION = 2;
const POSTER = { w: 640, h: 360 };
const PREVIEW = { w: 426, h: 240 };
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const o = { only: null, force: false, jobs: null, prune: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') o.force = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--only') o.only = argv[++i];
    else if (a === '--jobs') o.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--config') i++; // read by lib/config.mjs
    else if (a === '-h' || a === '--help') {
      console.log('usage: node pipeline/ingest.mjs [--config FILE] [--only <id|slug|path>] [--force] [--jobs N] [--prune] [--dry-run]');
      process.exit(0);
    } else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  if (argv.includes('--only') && !o.only) { console.error('--only needs a value'); process.exit(2); }
  return o;
}

// ---------------------------------------------------------------- helpers
const even = n => Math.max(2, Math.round(n / 2) * 2);
const fmt1 = s => s.toFixed(1);
const slugify = s => slugifyBase(s).slice(0, 80);
const sha = s => createHash('sha256').update(s).digest('hex');

function run(bin, args, { nice = true, capture = false, cwd } = {}) {
  const cmd = nice ? 'nice' : bin;
  const argv = nice ? ['-n', '10', bin, ...args] : args;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let out = '';
    let err = '';
    p.stdout.on('data', d => { if (capture) out += d; });
    p.stderr.on('data', d => { err += d; if (err.length > 64_000) err = err.slice(-32_000); });
    p.on('error', e => reject(e.code === 'ENOENT' ? new Error(`${bin} not found (install ffmpeg or set FFMPEG_BIN_DIR)`) : e));
    p.on('close', code => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${err.trim().split('\n').slice(-8).join('\n')}`));
    });
  });
}

function idFor(relPath) {
  const h = createHash('sha256').update(relPath).digest();
  return h.readBigUInt64BE(0).toString(36).padStart(13, '0').slice(0, 8);
}

// "my_best-clip__02" -> "My best clip 02"; "The.Big.Day" -> "The Big Day"
export function cleanName(base) {
  const t = base.replace(/[_]+/g, ' ').replace(/(?<=\S)\.(?=\S)/g, ' ').replace(/\s+-+\s+|(?<=\S)-+(?=\S)|^-+|-+$/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t ? t[0].toLocaleUpperCase() + t.slice(1) : base;
}
export const titleFromName = name => cleanName(name.replace(/\.[A-Za-z0-9]{2,5}$/, ''));

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function dirSize(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p)).size;
  }
  return total;
}

function parseRate(r) {
  if (!r || typeof r !== 'string') return 0;
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : a || 0;
}

const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(a?.[k] || {}, v) : v;
  return out;
};

// ---------------------------------------------------------------- manifest (CSV / JSON)
// RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes, BOM; delimiter , ; or tab (auto-detected).
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  let delim = ',';
  let best = -1;
  for (const d of [',', ';', '\t']) {
    let n = 0; let q = false;
    for (const c of first) { if (c === '"') q = !q; else if (c === d && !q) n++; }
    if (n > best) { best = n; delim = d; }
  }
  const rows = [];
  let row = []; let field = ''; let i = 0; let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') i++;
    if (c === '\n' || c === '\r') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(f => f.trim() !== ''));
  if (!nonEmpty.length) return [];
  const head = nonEmpty[0].map(h => h.trim().toLowerCase());
  return nonEmpty.slice(1).map(r => Object.fromEntries(head.map((h, k) => [h, (r[k] ?? '').trim()])));
}

const truthy = v => (typeof v === 'boolean' ? v : /^(1|true|yes|oui|y|x)$/i.test(String(v ?? '').trim()));

function normalizeEntry(e, where) {
  const key = String(e.path ?? e.file ?? e.filename ?? e.key ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!key) throw new Error(`${where}: missing "path" (or "file")`);
  const o = { key };
  if (e.title) o.title = String(e.title).trim();
  if (e.description !== undefined && e.description !== '') o.description = String(e.description).trim();
  if (e.tags !== undefined && e.tags !== '') {
    o.tags = (Array.isArray(e.tags) ? e.tags : String(e.tags).split(/[|,;]/)).map(t => String(t).trim().toLowerCase()).filter(Boolean);
  }
  if (e.category) o.category = String(e.category).trim();
  if (e.slug) o.slug = slugify(e.slug);
  if (e.hidden !== undefined && e.hidden !== '') o.hidden = truthy(e.hidden);
  return o;
}

async function loadManifest(file) {
  if (!file) return [];
  const text = await fsp.readFile(file, 'utf8');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(text.replace(/^﻿/, ''));
    const list = Array.isArray(j) ? j : Array.isArray(j.videos) ? j.videos : Object.entries(j).map(([k, v]) => ({ path: k, ...v }));
    return list.map((e, i) => normalizeEntry(e, `${path.basename(file)}[${i}]`));
  }
  return parseCsv(text).map((e, i) => normalizeEntry(e, `${path.basename(file)} row ${i + 2}`));
}

// ---------------------------------------------------------------- scan
async function walk(dir, rel = '') {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { throw new Error(`cannot read videos.dir ${dir}: ${e.code || e.message}`); }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('@')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(path.join(dir, e.name), r));
    else if (e.isFile() || e.isSymbolicLink()) out.push(r);
  }
  return out;
}

const folderName = name => cleanName(name); // same clean-up as titles, no extension stripping

async function scan(cfg) {
  const exts = new Set(cfg.videos.extensions.map(e => e.toLowerCase()));
  const files = (await walk(cfg.videos.dir)).filter(r => exts.has(path.extname(r).slice(1).toLowerCase()));
  const manifest = await loadManifest(cfg.videos.manifest);
  const byPath = new Map(); const byName = new Map();
  for (const f of files) { byPath.set(f, f); const b = path.posix.basename(f); byName.set(b, [...(byName.get(b) || []), f]); }
  const over = new Map(); const warnings = [];
  for (const m of manifest) {
    let target = byPath.get(m.key);
    if (!target) {
      const hits = m.key.includes('/') ? null : byName.get(m.key);
      if (hits?.length === 1) [target] = hits;
      else if (hits?.length > 1) { warnings.push(`manifest: "${m.key}" matches ${hits.length} files, use the relative path`); continue; }
    }
    if (!target) { warnings.push(`manifest: "${m.key}" matches no video file`); continue; }
    over.set(target, { ...(over.get(target) || {}), ...m });
  }

  const defCat = { slug: slugify(cfg.videos.default_category) || 'videos', name: cfg.videos.default_category };
  const usedSlugs = new Map();
  const seenId = new Map();
  const videos = files.map(rel => {
    const parts = rel.split('/');
    let cat = parts.length > 1 ? { slug: slugify(parts[0]), name: folderName(parts[0]) } : { ...defCat };
    if (!cat.slug) cat = { ...defCat };
    const m = over.get(rel) || {};
    if (m.category) cat = { slug: slugify(m.category) || defCat.slug, name: m.category };
    const title = (m.title || titleFromName(parts[parts.length - 1])).slice(0, 200);
    const id = idFor(rel);
    if (seenId.has(id)) throw new Error(`id collision ${id}: ${seenId.get(id)} / ${rel} (rename one file)`);
    seenId.set(id, rel);
    let slug = m.slug || slugify(title) || id;
    if (usedSlugs.has(slug)) { let k = 2; while (usedSlugs.has(`${slug}-${k}`)) k++; slug = `${slug}-${k}`; }
    usedSlugs.set(slug, rel);
    return {
      rel, id, slug, title, description: m.description || '', tags: m.tags || [], hidden: !!m.hidden,
      category: cat.slug, category_name: cat.name, abs: path.join(cfg.videos.dir, rel), root: path.join(cfg.paths.media, id),
    };
  });
  // A category folder's display name wins over a manifest spelling of the same slug only if no manifest named it.
  const names = new Map();
  for (const v of videos) if (!names.has(v.category)) names.set(v.category, v.category_name);
  for (const v of videos) v.category_name = names.get(v.category);
  return { videos, warnings, manifestRows: manifest.length };
}

// ---------------------------------------------------------------- probe
async function probe(src) {
  const { out } = await run(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', src], { nice: false, capture: true });
  const j = JSON.parse(out);
  const v = j.streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (!v) throw new Error('no video stream');
  const a = j.streams.find(s => s.codec_type === 'audio');
  let rot = 0;
  for (const sd of v.side_data_list || []) if (typeof sd.rotation === 'number') rot = sd.rotation;
  if (!rot && v.tags && v.tags.rotate) rot = Number(v.tags.rotate) || 0;
  const swap = Math.abs(rot) % 180 === 90;
  // Display dimensions (ffmpeg auto-rotates while decoding), with sample aspect ratio applied.
  let w = v.width; let h = v.height;
  const sar = parseRate((v.sample_aspect_ratio || '1:1').replace(':', '/'));
  if (sar && Math.abs(sar - 1) > 0.01) w = even(w * sar);
  if (swap) [w, h] = [h, w];
  let fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 30;
  if (!(fps > 1 && fps < 241)) fps = 30;
  const duration = Number(j.format.duration) || Number(v.duration) || 0;
  if (!(duration > 0)) throw new Error('unknown duration');
  return { width: w, height: h, fps, duration, hasAudio: !!a };
}

function ladderFor(ladder, w, h) {
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const landscape = w >= h;
  let rungs = ladder.filter(r => r.short <= short);
  if (!rungs.length) rungs = [{ ...ladder[ladder.length - 1], short: even(short) }];
  return rungs.map(r => {
    const s = r.short;
    const l = even((s * long) / short);
    return { ...r, profile: s >= 480 ? 'high' : 'main', name: String(s), width: landscape ? l : s, height: landscape ? s : l };
  });
}

// ---------------------------------------------------------------- HLS
function parseMediaPlaylist(text) {
  const segs = [];
  let init = null;
  let dur = null;
  for (const line of text.split('\n').map(l => l.trim())) {
    if (line.startsWith('#EXT-X-MAP:')) init = /URI="([^"]+)"/.exec(line)[1];
    else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) { segs.push({ uri: line, dur }); dur = null; }
  }
  return { init, segs };
}

function avcCodecString(initBuf) {
  const i = initBuf.indexOf('avcC');
  if (i < 0) return 'avc1.640028';
  const hex = n => n.toString(16).padStart(2, '0');
  return `avc1.${hex(initBuf[i + 5])}${hex(initBuf[i + 6])}${hex(initBuf[i + 7])}`;
}

async function encodeHls(src, info, dir, threads, ing, log) {
  const SEG_S = ing.segment_seconds;
  const tmp = path.join(dir, 'hls.tmp');
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const rungs = ladderFor(ing.ladder, info.width, info.height);
  const outFps = info.fps > 30.5 ? 30 : info.fps;
  const fpsFilter = info.fps > 30.5 ? 'fps=30,' : '';
  const gop = Math.max(1, Math.round(outFps * SEG_S));
  const n = rungs.length;

  let fc = `[0:v]${fpsFilter}split=${n}${rungs.map((_, i) => `[s${i}]`).join('')}`;
  rungs.forEach((r, i) => { fc += `;[s${i}]scale=${r.width}:${r.height}:flags=bicubic,setsar=1,format=yuv420p[v${i}]`; });

  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', src, '-filter_complex', fc, '-filter_threads', '2'];
  rungs.forEach((_, i) => { args.push('-map', `[v${i}]`); if (info.hasAudio) args.push('-map', '0:a:0'); });
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-threads', String(threads), '-crf', String(ing.crf),
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-flags', '+cgop',
    '-force_key_frames', `expr:gte(t,n_forced*${SEG_S})`);
  rungs.forEach((r, i) => {
    args.push(`-maxrate:v:${i}`, `${r.video_kbps}k`, `-bufsize:v:${i}`, `${r.video_kbps * 2}k`, `-profile:v:${i}`, r.profile);
  });
  if (info.hasAudio) {
    args.push('-c:a', 'aac', '-ac', '2', '-ar', '48000');
    rungs.forEach((r, i) => args.push(`-b:a:${i}`, `${r.audio_kbps}k`));
  }
  const vsm = rungs.map((r, i) => (info.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)).join(' ');
  args.push('-max_muxing_queue_size', '2048', '-f', 'hls', '-hls_time', String(SEG_S), '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4', '-hls_flags', 'independent_segments', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(tmp, '%v', 'seg_%03d.m4s'), '-var_stream_map', vsm,
    path.join(tmp, '%v', 'index.m3u8'));
  log(`hls: ${n} rung${n > 1 ? 's' : ''} ${rungs.map(r => `${r.width}x${r.height}`).join(' ')}${info.hasAudio ? '' : ' (no audio)'}`);
  await run(FFMPEG, args);

  // Measure each rung and write the master playlist ourselves (exact BANDWIDTH / CODECS).
  const renditions = [];
  let master = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n';
  for (const r of rungs) {
    const rdir = path.join(tmp, r.name);
    const pl = parseMediaPlaylist(await fsp.readFile(path.join(rdir, 'index.m3u8'), 'utf8'));
    if (!pl.init || !pl.segs.length) throw new Error(`rung ${r.name}: empty playlist`);
    let totalBytes = 0; let totalDur = 0; let peak = 0;
    for (const s of pl.segs) {
      const size = (await fsp.stat(path.join(rdir, s.uri))).size;
      totalBytes += size; totalDur += s.dur;
      // Tiny tail segments give meaningless rates; ignore them unless they are all there is.
      if (s.dur >= 1 || pl.segs.length === 1) peak = Math.max(peak, (size * 8) / s.dur);
    }
    const avg = Math.ceil((totalBytes * 8) / totalDur);
    const bandwidth = Math.ceil(Math.max(peak, avg));
    const codecs = [avcCodecString(await fsp.readFile(path.join(rdir, pl.init)))];
    if (info.hasAudio) codecs.push('mp4a.40.2');
    master += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${r.width}x${r.height},`
      + `FRAME-RATE=${outFps.toFixed(3)},CODECS="${codecs.join(',')}"\n${r.name}/index.m3u8\n`;
    renditions.push({ name: r.name, width: r.width, height: r.height, bandwidth, codecs: codecs.join(',') });
  }
  await fsp.writeFile(path.join(tmp, 'master.m3u8'), master);
  const final = path.join(dir, 'hls');
  await fsp.rm(final, { recursive: true, force: true });
  await fsp.rename(tmp, final);
  return renditions;
}

// ---------------------------------------------------------------- posters & previews
// Frame centred on a blurred, darkened copy of itself filling W x H.
function blurFill(W, H, inLabel, outLabel, k) {
  const bw = even(W / 4); const bh = even(H / 4);
  return `${inLabel}split=2[bgi${k}][fgi${k}];`
    + `[bgi${k}]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=5,`
    + `eq=brightness=-0.16:saturation=0.85,scale=${W}:${H}:flags=bicubic[bg${k}];`
    + `[fgi${k}]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg${k}];`
    + `[bg${k}][fg${k}]overlay=(W-w)/2:(H-h)/2,setsar=1${outLabel}`;
}

async function pickPosterTime(src, duration, pos) {
  const cands = [pos, pos + 0.1, pos - 0.1, pos + 0.2, pos + 0.3, pos - 0.2, pos + 0.4].filter(f => f > 0.02 && f < 0.98);
  for (const f of cands) {
    const t = duration * f;
    try {
      const { out } = await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-ss', t.toFixed(3), '-i', src,
        '-frames:v', '1', '-vf', 'scale=96:-2,signalstats,metadata=mode=print:file=-', '-f', 'null', '-'], { capture: true });
      const g = k => Number((new RegExp(`signalstats\\.${k}=([\\d.]+)`).exec(out) || [])[1]);
      const yavg = g('YAVG'); const ylow = g('YLOW'); const yhigh = g('YHIGH');
      // Reject near-black or flat (fade / blank) frames.
      if (yavg >= 28 && yhigh - ylow >= 48) return t;
    } catch { /* try next candidate */ }
  }
  return duration * pos;
}

async function makePoster(src, info, dir, ing) {
  const t = await pickPosterTime(src, info.duration, ing.poster_position);
  const jpg = path.join(dir, 'poster.jpg'); const webp = path.join(dir, 'poster.webp');
  const fc = `${blurFill(POSTER.w, POSTER.h, '[0:v]', '[p]', 'p')};[p]split=2[o1][o2]`;
  await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', t.toFixed(3), '-i', src, '-filter_complex', fc,
    '-map', '[o1]', '-frames:v', '1', '-q:v', '3', '-f', 'image2', `${jpg}.tmp`,
    '-map', '[o2]', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', '-f', 'webp', `${webp}.tmp`]);
  await fsp.rename(`${jpg}.tmp`, jpg);
  await fsp.rename(`${webp}.tmp`, webp);
  return t;
}

async function makePreview(src, info, dir, ing) {
  const { duration } = info;
  const n = ing.preview_snippets;
  const len = Math.min(ing.preview_seconds / n, (duration * 0.8) / n);
  const starts = [];
  for (let i = 0; i < n; i++) {
    const t = duration * (0.1 + (0.8 * i) / (n - 1));
    starts.push(Math.max(0, Math.min(t, duration - len - 0.05)));
  }
  const inputs = [];
  starts.forEach(t => inputs.push('-ss', t.toFixed(3), '-t', len.toFixed(3), '-i', src));
  const parts = starts.map((_, i) => blurFill(PREVIEW.w, PREVIEW.h, `[${i}:v]fps=30,`, `[c${i}]`, `s${i}`));
  const fc = `${parts.join(';')};${starts.map((_, i) => `[c${i}]`).join('')}concat=n=${n}:v=1:a=0,format=yuv420p[out]`;
  const out = path.join(dir, 'preview.mp4');
  const maxBytes = ing.preview_max_kb * 1000;
  // bitrate caps scale with the byte budget and the preview length
  const kbps = Math.max(60, Math.floor((maxBytes * 8) / 1000 / Math.max(1, n * len)));
  const tries = [{ crf: 28, max: Math.round(kbps * 1.1) }, { crf: 31, max: Math.round(kbps * 0.85) },
    { crf: 34, max: Math.round(kbps * 0.62) }, { crf: 38, max: Math.round(kbps * 0.42) }];
  let size = 0;
  for (const q of tries) {
    await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', fc, '-map', '[out]',
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-threads', '2', '-crf', String(q.crf),
      '-maxrate', `${q.max}k`, '-bufsize', `${q.max * 2}k`, '-g', '60', '-movflags', '+faststart', '-f', 'mp4', `${out}.tmp`]);
    size = (await fsp.stat(`${out}.tmp`)).size;
    if (size < maxBytes) break;
  }
  await fsp.rename(`${out}.tmp`, out);
  return size;
}

// ---------------------------------------------------------------- house ad
async function findFont() {
  const hit = FONT_CANDIDATES.find(f => fs.existsSync(f));
  if (hit) return hit;
  try {
    const { out } = await run('fc-match', ['-f', '%{file}', 'sans:bold'], { nice: false, capture: true });
    if (out && fs.existsSync(out.trim()) && /\.(ttf|otf)$/i.test(out.trim())) return out.trim();
  } catch { /* no fontconfig */ }
  return null;
}

async function makePreroll(cfg, force) {
  const dir = path.join(cfg.paths.media, '_house');
  const out = path.join(dir, 'preroll.mp4');
  const strings = deepMerge(deepMerge(locale('en'), locale(cfg.site.language)), cfg.strings);
  const title = String(strings.ad?.preroll_title || '').replace(/[\r\n]+/g, ' ');
  const sub = String(strings.ad?.preroll_sub || '').replace(/[\r\n]+/g, ' ');
  const font = await findFont();
  const key = sha(JSON.stringify({ PIPELINE_VERSION, title, sub, font: !!font }));
  const stateFile = path.join(dir, '.preroll.json');
  let prev = null;
  try { prev = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { /* none */ }
  if (!force && prev?.key === key && await exists(out)) { console.log('[house] preroll.mp4 up to date, skip'); return; }
  await fsp.mkdir(dir, { recursive: true });
  const t0 = Date.now();
  let fc = '[0:v]format=yuv420p,';
  if (font) {
    // textfile= (relative, ffmpeg runs in dir) avoids every drawtext escaping problem with the localized text.
    await fsp.writeFile(path.join(dir, '.t1.txt'), title);
    await fsp.writeFile(path.join(dir, '.t2.txt'), sub);
    const ff = `'${font.replace(/'/g, '')}'`;
    fc += `drawtext=fontfile=${ff}:textfile=.t1.txt:fontsize=88:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40:alpha='0.85+0.15*sin(2*PI*t/2)',`
      + `drawtext=fontfile=${ff}:textfile=.t2.txt:fontsize=38:fontcolor=0xC8CCD8:x=(w-text_w)/2:y=(h/2)+50,`;
  } else {
    console.warn('[house] no TTF font found: pre-roll without text (install fonts-dejavu-core for the text)');
  }
  fc += 'drawbox=x=0:y=ih-6:w=iw*t/10:h=6:color=0x8A9BFF@0.9:t=fill[v]';
  await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:r=30:d=10:n=3:c0=0x0E1220:c1=0x1F1633:c2=0x0C2630:speed=0.012:type=linear',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', fc, '-map', '[v]', '-map', '1:a', '-t', '10',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-crf', '24', '-maxrate', '1500k', '-bufsize', '3000k',
    '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', 'preroll.mp4.tmp'], { cwd: dir });
  await fsp.rename(`${out}.tmp`, out);
  await fsp.rm(path.join(dir, '.t1.txt'), { force: true });
  await fsp.rm(path.join(dir, '.t2.txt'), { force: true });
  await writeAtomic(stateFile, `${JSON.stringify({ key, title, sub, at: new Date().toISOString() })}\n`);
  console.log(`[house] preroll.mp4 written (${Math.round((await fsp.stat(out)).size / 1024)} KB, ${fmt1((Date.now() - t0) / 1000)}s)`);
}

// ---------------------------------------------------------------- per video
const REQUIRED = ['hls/master.m3u8', 'poster.jpg', 'poster.webp', 'preview.mp4'];

async function readState(root) {
  try { return JSON.parse(await fsp.readFile(path.join(root, '.ingest.json'), 'utf8')); } catch { return null; }
}

function settingsKey(ing) {
  const { ladder, segment_seconds, crf, preview_seconds, preview_snippets, preview_max_kb, poster_position } = ing;
  return JSON.stringify({ PIPELINE_VERSION, ladder, segment_seconds, crf, preview_seconds, preview_snippets, preview_max_kb, poster_position });
}

function versionFor(ing, st) {
  return sha(`${settingsKey(ing)}|${st.size}|${Math.round(st.mtimeMs)}`).slice(0, 6);
}

const outDir = (cfg, v, ver) => (cfg.ingest.versioned_paths ? path.join(v.root, ver) : v.root);
const mediaPath = (cfg, v, ver) => (cfg.ingest.versioned_paths ? `${v.id}/${ver}` : v.id);

async function isUpToDate(cfg, v, state, ver) {
  if (!state || state.v !== ver || state.media_path !== mediaPath(cfg, v, ver)) return false;
  const dir = outDir(cfg, v, ver);
  for (const f of REQUIRED) if (!(await exists(path.join(dir, f)))) return false;
  for (const r of state.renditions || []) if (!(await exists(path.join(dir, 'hls', r.name, 'index.m3u8')))) return false;
  return true;
}

// Remove outputs of other versions (and of the other layout) under media/<id>/.
async function cleanOld(cfg, v, ver) {
  const keep = new Set(['.ingest.json']);
  if (cfg.ingest.versioned_paths) keep.add(ver);
  else for (const f of ['hls', 'poster.jpg', 'poster.webp', 'preview.mp4']) keep.add(f);
  for (const e of await fsp.readdir(v.root)) if (!keep.has(e)) await fsp.rm(path.join(v.root, e), { recursive: true, force: true });
}

async function ingestOne(cfg, v, idx, total, opts, threads) {
  const tag = `[${String(idx + 1).padStart(String(total).length, '0')}/${total} ${v.id} ${v.slug}]`;
  const log = m => console.log(`${tag} ${m}`);
  const st = await fsp.stat(v.abs);
  const ver = versionFor(cfg.ingest, st);
  const prev = await readState(v.root);
  if (!opts.force && await isUpToDate(cfg, v, prev, ver)) { log('up to date, skip'); return prev; }
  const dir = outDir(cfg, v, ver);
  await fsp.mkdir(dir, { recursive: true });
  const t0 = Date.now();
  let t = Date.now();
  const lap = () => { const s = fmt1((Date.now() - t) / 1000); t = Date.now(); return `${s}s`; };

  const info = await probe(v.abs);
  log(`probe: ${info.width}x${info.height} ${info.fps.toFixed(2)}fps ${info.duration.toFixed(2)}s audio=${info.hasAudio ? 'yes' : 'no'}`);
  lap();
  const renditions = await encodeHls(v.abs, info, dir, threads, cfg.ingest, log);
  log(`hls: done ${lap()} (${renditions.map(r => `${r.name}:${Math.round(r.bandwidth / 1000)}k`).join(' ')})`);
  const posterT = await makePoster(v.abs, info, dir, cfg.ingest);
  log(`poster: frame @${posterT.toFixed(1)}s ${lap()}`);
  const pvSize = await makePreview(v.abs, info, dir, cfg.ingest);
  log(`preview: ${Math.round(pvSize / 1024)} KB ${lap()}${pvSize >= cfg.ingest.preview_max_kb * 1000 ? ' WARNING over budget' : ''}`);

  const state = {
    pipeline: PIPELINE_VERSION,
    v: ver,
    media_path: mediaPath(cfg, v, ver),
    id: v.id,
    source: v.rel,
    source_size: st.size,
    source_mtime_ms: Math.round(st.mtimeMs),
    duration_s: Math.round(info.duration * 100) / 100,
    width: info.width,
    height: info.height,
    has_audio: info.hasAudio,
    renditions,
    poster_time_s: Math.round(posterT * 100) / 100,
    preview_bytes: pvSize,
    created_at: (prev && prev.created_at) || new Date().toISOString(),
    encoded_at: new Date().toISOString(),
  };
  await writeAtomic(path.join(v.root, '.ingest.json'), `${JSON.stringify(state, null, 2)}\n`);
  await cleanOld(cfg, v, ver);
  log(`done in ${fmt1((Date.now() - t0) / 1000)}s, ${(await dirSize(dir) / 1048576).toFixed(1)} MB -> ${state.media_path}`);
  return state;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await fn(items[i], i) }; } catch (e) { results[i] = { ok: false, error: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------- main
async function writeCatalog(cfg, videos) {
  const catalog = [];
  const missing = [];
  for (const v of videos) {
    const st = await readState(v.root);
    if (!st || st.pipeline !== PIPELINE_VERSION || !st.media_path) { missing.push(v.slug); continue; }
    catalog.push({
      id: v.id, slug: v.slug, title: v.title, description: v.description,
      category: v.category, category_name: v.category_name, tags: v.tags,
      duration_s: st.duration_s, width: st.width, height: st.height,
      renditions: st.renditions.map(({ name, width, height, bandwidth }) => ({ name, width, height, bandwidth })),
      source: v.rel, created_at: st.created_at, media_path: st.media_path, hidden: v.hidden,
    });
  }
  const body = `${JSON.stringify(catalog, null, 2)}\n`;
  await fsp.mkdir(cfg.paths.media, { recursive: true });
  await writeAtomic(path.join(cfg.ingest.out_dir, 'catalog.json'), body);
  await writeAtomic(path.join(cfg.paths.media, 'catalog.json'), body);
  const cats = [...new Set(catalog.map(v => `${v.category} (${v.category_name})`))];
  console.log(`[catalog] ${catalog.length} videos, ${cats.length} categories: ${cats.join(', ')}`
    + (missing.length ? `\n[catalog] ${missing.length} not ingested yet: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' ...' : ''}` : ''));
}

async function prune(cfg, videos, dryRun) {
  const keep = new Set(videos.map(v => v.id));
  let n = 0;
  for (const e of await fsp.readdir(cfg.paths.media, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('_') || keep.has(e.name) || !/^[a-z0-9]{4,32}$/.test(e.name)) continue;
    if (!(await exists(path.join(cfg.paths.media, e.name, '.ingest.json')))) continue; // not ours
    n++;
    if (dryRun) console.log(`[prune] would remove media/${e.name}`);
    else { await fsp.rm(path.join(cfg.paths.media, e.name), { recursive: true, force: true }); console.log(`[prune] removed media/${e.name}`); }
  }
  console.log(`[prune] ${n} orphan video dir(s)${dryRun ? ' (dry run)' : ''}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = load(configPath());
  const { videos, warnings, manifestRows } = await scan(cfg);
  for (const w of warnings) console.warn(`[scan] WARNING ${w}`);
  const cats = new Map();
  for (const v of videos) cats.set(v.category, (cats.get(v.category) || 0) + 1);
  console.log(`[scan] ${videos.length} videos in ${cats.size} categories from ${cfg.videos.dir}`
    + `${cfg.videos.manifest ? ` (+ manifest ${path.basename(cfg.videos.manifest)}: ${manifestRows} rows)` : ''}`);
  if (!videos.length) console.warn(`[scan] WARNING no video files (${cfg.videos.extensions.join(', ')}) under ${cfg.videos.dir}`);
  if (opts.dryRun) {
    for (const v of videos) console.log(`  ${v.id}  ${v.category.padEnd(18)} ${v.slug.padEnd(32)} ${v.title}${v.hidden ? '  [hidden]' : ''}  <- ${v.rel}`);
    if (opts.prune) await prune(cfg, videos, true);
    return;
  }
  for (const [name, args] of [[FFMPEG, ['-version']], [FFPROBE, ['-version']]]) await run(name, args, { nice: false });
  const todo = opts.only ? videos.filter(v => v.id === opts.only || v.slug === opts.only || v.rel === opts.only) : videos;
  if (opts.only && !todo.length) throw new Error(`--only ${opts.only}: no video with that id, slug or path`);
  const jobs = opts.jobs || cfg.ingest.jobs;
  const threads = Math.max(2, Math.floor(os.availableParallelism() / (jobs * 2)));
  console.log(`[ingest] ${todo.length}/${videos.length} videos, jobs=${jobs}, x264 threads/encoder=${threads}`
    + `${cfg.ingest.versioned_paths ? ', versioned paths' : ''}${opts.force ? ', force' : ''}`);
  await fsp.mkdir(cfg.paths.media, { recursive: true });

  let failed = 0;
  const preroll = cfg.ads.mode !== 'off' && cfg.ads.slots.preroll && cfg.ads.house_preroll;
  if (!opts.only && preroll) {
    try { await makePreroll(cfg, opts.force); } catch (e) { failed++; console.error(`[house] FAILED: ${e.message}`); }
  }
  const t0 = Date.now();
  const res = await pool(todo, jobs, v => ingestOne(cfg, v, videos.indexOf(v), videos.length, opts, threads));
  res.forEach((r, i) => {
    if (!r.ok) { failed++; console.error(`[${todo[i].id} ${todo[i].slug}] FAILED: ${r.error.message}`); }
  });
  await writeCatalog(cfg, videos);
  if (opts.prune) await prune(cfg, videos, false);
  console.log(`[ingest] finished in ${fmt1((Date.now() - t0) / 1000)}s, ${failed ? `${failed} failure(s)` : 'no failures'}`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(`[ingest] fatal: ${e.message}`); process.exit(1); });
