#!/usr/bin/env node
// Synthetic demo library: 8 clips of 20-40 s generated with ffmpeg lavfi sources, in 3 category folders,
// landscape and vertical, some without an audio track. Nothing is downloaded; nothing is committed.
//   node lib/demo.mjs [out-dir] [--force]        (default examples/demo-videos)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './config.mjs';

const FF = process.env.FFMPEG_BIN_DIR ? path.join(process.env.FFMPEG_BIN_DIR, 'ffmpeg') : 'ffmpeg';
const args = process.argv.slice(2);
const force = args.includes('--force');
const OUT = path.resolve(args.find(a => !a.startsWith('--')) || path.join(REPO, 'examples', 'demo-videos'));

// [folder, file, seconds, WxH, video source, audio frequency or null]
const L = '1280x720'; const LS = '854x480'; const V = '480x854';
const CLIPS = [
  ['Fractals', 'mandelbrot_deep-zoom.mp4', 32, LS, s => `mandelbrot=s=${s}:rate=30:maxiter=600:start_scale=3:end_scale=0.02:end_pts=1200`, 220],
  ['Fractals', 'mandelbrot-vertical_dive.mp4', 24, V, s => `mandelbrot=s=${s}:rate=30:maxiter=400:start_x=-0.743643887037158704752191506114774:start_y=-0.131825904205311970493132056385139:start_scale=2:end_scale=0.001:end_pts=900`, null],
  ['Fractals', 'julia_colour_cycle.mp4', 28, LS, s => `mandelbrot=s=${s}:rate=30:maxiter=200:inner=period:outer=normalized_iteration_count:bailout=8:start_scale=1.5:end_scale=0.4:end_pts=900,hue=H=t*0.6`, 330],
  ['Game of life', 'gosper_glider-gun.mp4', 22, L, s => `life=s=320x180:rate=30:mold=10:ratio=0.1:death_color=#1b2a3a:life_color=#2ee6b6,scale=${s.replace('x', ':')}:flags=neighbor`, null],
  ['Game of life', 'random_soup_vertical.mp4', 26, V, s => `life=s=180x320:rate=30:ratio=0.35:mold=25:life_color=#ffd166:death_color=#222034:random_seed=7,scale=${s.replace('x', ':')}:flags=neighbor`, 180],
  ['Game of life', 'rule-110_automaton.mp4', 30, LS, s => `cellauto=s=427x240:rule=110:rate=30:random_fill_ratio=0.5:scroll=1:random_seed=3,scale=${s.replace('x', ':')}:flags=neighbor,negate`, 440],
  ['Test patterns', 'smpte_bars__countdown.mp4', 20, L, s => `smptehdbars=s=${s}:rate=30,drawbox=x=(iw-200)/2:y=(ih-200)/2:w=200:h=200:color=black@0.6:t=fill`, 1000],
  ['Test patterns', 'testsrc2-vertical_sweep.mp4', 36, V, s => `testsrc2=s=${s}:rate=30,hue=H=t*0.4`, null],
];

const run = argv => new Promise((resolve, reject) => {
  const p = spawn('nice', ['-n', '10', FF, ...argv], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('error', e => reject(e.code === 'ENOENT' ? new Error('ffmpeg not found (install it or set FFMPEG_BIN_DIR)') : e));
  p.on('close', c => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-5).join('\n')))));
});

let made = 0;
for (const [folder, file, secs, size, vsrc, freq] of CLIPS) {
  const dir = path.join(OUT, folder);
  const out = path.join(dir, file);
  if (!force && fs.existsSync(out)) { console.log(`[demo] ${folder}/${file} exists, skip`); continue; }
  fs.mkdirSync(dir, { recursive: true });
  const a = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', vsrc(size)];
  if (freq) a.push('-f', 'lavfi', '-i', `sine=frequency=${freq}:beep_factor=4:sample_rate=48000`);
  a.push('-t', String(secs), '-map', '0:v');
  if (freq) a.push('-map', '1:a', '-c:a', 'aac', '-b:a', '96k');
  a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${out}.tmp.mp4`);
  const t0 = Date.now();
  await run(a);
  fs.renameSync(`${out}.tmp.mp4`, out);
  made++;
  console.log(`[demo] ${folder}/${file} ${size} ${secs}s ${freq ? 'audio' : 'no audio'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`[demo] ${made} clip(s) written to ${path.relative(process.cwd(), OUT) || OUT}`);
