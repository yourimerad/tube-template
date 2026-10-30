#!/usr/bin/env node
// SimAds video creatives (ads.mode "sim"): a few short pre-roll clips for the simulated network's VAST tag.
// The app image has no ffmpeg, so they are made here, next to the other media, and the app only links them:
//   <media>/_simads/video-<n>.mp4      1280x720 H.264/AAC, faststart, "Ad" tag + "Simulated ad" burned in
//   <media>/_simads/manifest.json      [{ file, duration, width, height, bitrate, title }] read by app/src/simads
// Without them the sim VAST falls back to <media>/_house/preroll.mp4.
//
//   node pipeline/simads-creatives.mjs [--config site.config.json] [--force]
//   import { makeSimCreatives } from './simads-creatives.mjs';
//   await makeSimCreatives(cfg.paths.media, { audience: cfg.audience, force })
// Node 24, no npm deps; ffmpeg from PATH or $FFMPEG_BIN_DIR. Idempotent (skips when up to date).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = 1;
const FF_DIR = process.env.FFMPEG_BIN_DIR || '';
const FFMPEG = FF_DIR ? path.join(FF_DIR, 'ffmpeg') : 'ffmpeg';
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];

// Fictional advertisers (same names as the SVG creatives of app/src/simads/creatives.js). Non-explicit text.
const VIDEOS = {
  general: [
    { title: 'Sunbrew Coffee', line: 'Fresh roast, every morning', seconds: 10, c: ['0x3A1A0A', '0x7A3A12', '0x1A0E08'] },
    { title: 'Volta VPN', line: 'Browse privately anywhere', seconds: 15, c: ['0x0A1A3A', '0x12307A', '0x08101A'] },
    { title: 'Pixelforge Games', line: 'A new world awaits', seconds: 12, c: ['0x1E0A3A', '0x45127A', '0x0E081A'] },
  ],
  adult: [
    { title: 'VelvetCam', line: 'Live models online now (18+)', seconds: 10, c: ['0x3A0A1A', '0x7A1240', '0x1A0810'] },
    { title: 'MatchNight', line: 'Singles near you tonight (18+)', seconds: 15, c: ['0x3A140A', '0x7A2E12', '0x1A0C08'] },
    { title: 'VR Nights', line: 'Premium VR scenes (18+)', seconds: 12, c: ['0x0A2A3A', '0x12587A', '0x08141A'] },
  ],
};

function run(bin, args, { cwd, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '10', bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let out = '', err = '';
    p.stdout.on('data', d => { if (capture) out += d; });
    p.stderr.on('data', d => { err += d; if (err.length > 64_000) err = err.slice(-32_000); });
    p.on('error', e => reject(e.code === 'ENOENT' ? new Error(`${bin} not found (install ffmpeg or set FFMPEG_BIN_DIR)`) : e));
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}: ${err.trim().split('\n').slice(-6).join('\n')}`))));
  });
}

async function findFont() {
  const hit = FONT_CANDIDATES.find(f => fs.existsSync(f));
  if (hit) return hit;
  try {
    const out = (await run('fc-match', ['-f', '%{file}', 'sans:bold'], { capture: true })).trim();
    if (out && fs.existsSync(out) && /\.(ttf|otf)$/i.test(out)) return out;
  } catch { /* no fontconfig */ }
  return null;
}

export async function makeSimCreatives(mediaDir, { audience = 'general', force = false, log = console.log } = {}) {
  const list = VIDEOS[audience === 'adult' ? 'adult' : 'general'];
  const dir = path.join(mediaDir, '_simads');
  const font = await findFont();
  const key = createHash('sha256').update(JSON.stringify({ VERSION, list, font: !!font })).digest('hex');
  const manifestFile = path.join(dir, 'manifest.json');
  let prev = null;
  try { prev = JSON.parse(await fsp.readFile(manifestFile, 'utf8')); } catch { /* none */ }
  if (!force && prev?.key === key && prev.videos?.every(v => fs.existsSync(path.join(dir, v.file)))) {
    log(`[simads] ${prev.videos.length} video creatives up to date, skip`);
    return prev;
  }
  await fsp.mkdir(dir, { recursive: true });
  if (!font) console.warn('[simads] no TTF font found: creatives without text (install fonts-dejavu-core)');
  const videos = [];
  for (const [i, v] of list.entries()) {
    const file = `video-${i + 1}.mp4`;
    const t0 = Date.now();
    let fc = '[0:v]format=yuv420p,';
    if (font) {
      // textfile= (relative, ffmpeg runs in dir) avoids drawtext escaping problems.
      await fsp.writeFile(path.join(dir, '.t1.txt'), v.title);
      await fsp.writeFile(path.join(dir, '.t2.txt'), v.line);
      await fsp.writeFile(path.join(dir, '.t3.txt'), 'Simulated ad - SimAds test creative, nobody is paid');
      await fsp.writeFile(path.join(dir, '.t4.txt'), 'Ad');
      const ff = `'${font.replace(/'/g, '')}'`;
      fc += `drawtext=fontfile=${ff}:textfile=.t1.txt:fontsize=84:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-50,`
        + `drawtext=fontfile=${ff}:textfile=.t2.txt:fontsize=40:fontcolor=0xD8DCE8:x=(w-text_w)/2:y=(h/2)+40,`
        + `drawtext=fontfile=${ff}:textfile=.t3.txt:fontsize=26:fontcolor=0xFFCF3D:x=(w-text_w)/2:y=h-80,`
        + `drawbox=x=24:y=24:w=70:h=40:color=0xFFCF3D@1:t=fill,`
        + `drawtext=fontfile=${ff}:textfile=.t4.txt:fontsize=26:fontcolor=0x241A00:x=24+(70-text_w)/2:y=24+(40-text_h)/2,`;
    }
    fc += `drawbox=x=0:y=ih-6:w=iw*t/${v.seconds}:h=6:color=0xFFCF3D@0.9:t=fill[v]`;
    await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `gradients=s=1280x720:r=30:d=${v.seconds}:n=3:c0=${v.c[0]}:c1=${v.c[1]}:c2=${v.c[2]}:speed=0.015:type=radial`,
      '-f', 'lavfi', '-i', `sine=frequency=${330 + i * 110}:sample_rate=48000:duration=${v.seconds}`,
      '-filter_complex', `${fc};[1:a]volume=0.05,aformat=channel_layouts=stereo[a]`, '-map', '[v]', '-map', '[a]', '-t', String(v.seconds),
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-crf', '25', '-maxrate', '1500k', '-bufsize', '3000k',
      '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', `${file}.tmp`], { cwd: dir });
    await fsp.rename(path.join(dir, `${file}.tmp`), path.join(dir, file));
    videos.push({ file, duration: v.seconds, width: 1280, height: 720, bitrate: 1500, title: v.title });
    log(`[simads] ${file} written (${v.title}, ${v.seconds}s, ${Math.round((await fsp.stat(path.join(dir, file))).size / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  for (const f of ['.t1.txt', '.t2.txt', '.t3.txt', '.t4.txt']) await fsp.rm(path.join(dir, f), { force: true });
  const manifest = { key, audience, at: new Date().toISOString(), videos };
  await fsp.writeFile(`${manifestFile}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await fsp.rename(`${manifestFile}.tmp`, manifestFile);
  return manifest;
}

// CLI
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const { load, configPath } = await import('../lib/config.mjs');
  const cfg = load(configPath());
  makeSimCreatives(cfg.paths.media, { audience: cfg.audience, force })
    .catch(e => { console.error(`[simads] FAILED: ${e.message}`); process.exit(1); });
}
