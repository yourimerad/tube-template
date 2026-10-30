#!/usr/bin/env node
// ./tube ads : set up, check and measure the ads of a site (see docs/ADS-general.md, docs/ADS-adult.md).
//
//   node lib/ads.mjs [--config FILE] setup                 interactive wizard: audience -> networks -> per slot
//   node lib/ads.mjs [--config FILE] setup --yes [flags]   non-interactive:
//        --audience general|adult  --mode off|placeholder|sim|live  --consent auto|banner|cmp|none
//        --region eu|us|other  --net <id>[:key=value,...]  --slot <name>=<network>:<zone>[:<mobile_zone>]
//        --slot <name>=off|on
//   node lib/ads.mjs [--config FILE] check                 validate + enabled slots, CSP, ads.txt, unverified presets
//   node lib/ads.mjs [--config FILE] report [URL] [--window 1h|24h|7d|all]
//                                                          simulated-network report (/simads/report.json) as a table
//   node lib/ads.mjs [--config FILE] expect [--mode M]     test expectations (used by ./tube test)
//
// setup rewrites ONLY the "ads" block and the top-level "audience" / "age_gate" keys of site.config.json (comments
// elsewhere are kept; a copy of the previous file goes to <config>.bak).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { load, readRaw, configPath, schemaErrors, resolve, crossErrors, adsWarnings } from './config.mjs';
import { normalizeAds, SLOT_NAMES, SLOTS } from '../app/src/ads/normalize.js';
import { PRESETS } from '../app/src/ads/presets/index.js';
import { slotMarkup, pickFormat, allMarkup, preroll as prerollOf } from '../app/src/ads/render.js';
import { buildCsp, inlineScriptHashes } from '../app/src/ads/csp.js';
import { adsTxt, adsTxtRedirect } from '../app/src/ads/adstxt.js';

const argv = process.argv.slice(2).filter((a, i, all) => a !== '--config' && all[i - 1] !== '--config');
const flag = (name, def = '') => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flags = name => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, Math.max(n, String(s ?? '').length));

// ---------- JSONC surgery: find the value span of a top-level key ----------
function topLevelSpan(text, key) {
  let i = 0, depth = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 2; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const str = text.slice(i + 1, j);
      i = j + 1;
      if (depth === 1 && str === key) {
        let k = i; while (/\s/.test(text[k])) k++;
        if (text[k] !== ':') continue;
        k++; while (/\s/.test(text[k])) k++;
        const start = k;
        let d = 0;
        for (; k < n; k++) {
          const ch = text[k];
          if (ch === '"') { k++; while (k < n && text[k] !== '"') k += text[k] === '\\' ? 2 : 1; continue; }
          if (ch === '/' && text[k + 1] === '/') { k = text.indexOf('\n', k); continue; }
          if (ch === '{' || ch === '[') d++;
          else if (ch === '}' || ch === ']') { if (d === 0) break; d--; if (d === 0) { k++; break; } }
          else if (d === 0 && (ch === ',' || ch === '\n')) break;
        }
        let end = k;
        while (end > start && /[\s,]/.test(text[end - 1])) end--;
        return [start, end];
      }
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    i++;
  }
  return null;
}

function setTopLevel(text, key, value) {
  const json = JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
  const span = topLevelSpan(text, key);
  if (span) return text.slice(0, span[0]) + json + text.slice(span[1]);
  const last = text.lastIndexOf('}');
  const before = text.slice(0, last).replace(/\s*$/, '');
  const comma = /[{,]$/.test(before) ? '' : ',';
  return `${before}${comma}\n  "${key}": ${json},\n}\n`;
}

// ---------- setup ----------
function presetsFor(audience) {
  return Object.values(PRESETS).filter(p => !p.closed && p.id !== 'simads' && p.id !== 'vast' && p.audiences.includes(audience));
}

function applySlot(ads, spec) {
  const [name, rest = ''] = spec.split('=');
  if (!SLOTS[name]) throw new Error(`unknown slot "${name}" (slots: ${SLOT_NAMES.join(', ')})`);
  ads.slots = ads.slots || {};
  if (rest === 'off' || rest === 'on') { ads.slots[name] = rest === 'on'; return; }
  const [network, zone = '', mobile = ''] = rest.split(':');
  const p = PRESETS[network];
  if (!p) throw new Error(`unknown network "${network}"`);
  const o = { network };
  if (SLOTS[name].format === 'vast' && (network === 'vast' || network === 'custom' || network === 'hilltopads' || network === 'clickadu')) o.vast_url = rest.slice(network.length + 1);
  else if (zone) o.zone = zone;
  if (mobile) o.mobile_zone = mobile;
  ads.slots[name] = o;
}

function applyNet(ads, spec) {
  const [id, kv = ''] = spec.split(/:(.*)/s);
  if (!PRESETS[id]) throw new Error(`unknown network "${id}"`);
  ads.networks = ads.networks || {};
  const net = ads.networks[id] || {};
  for (const pair of kv.split(',').filter(Boolean)) {
    const [k, v] = pair.split('=');
    net[k] = v === 'true' ? true : v === 'false' ? false : v;
  }
  ads.networks[id] = net;
}

async function wizard(raw) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def = '') => (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim() || def;
  try {
    const audience = await ask('Audience (general | adult)', raw.audience || 'general');
    const ads = { ...(raw.ads || {}) };
    ads.mode = await ask('Ads mode (off | placeholder | sim | live)', ads.mode || 'placeholder');
    const list = presetsFor(audience);
    console.log(`\nNetworks for a ${audience} site:`);
    list.forEach(p => console.log(`  ${pad(p.id, 15)} ${pad(p.name, 34)} ${p.verified ? 'verified' : 'UNVERIFIED tags'}  ${p.signup || ''}`));
    const ids = (await ask('\nNetworks you have an account with (comma-separated ids, empty = none)')).split(',').map(s => s.trim()).filter(Boolean);
    ads.networks = ads.networks || {};
    for (const id of ids) {
      const p = PRESETS[id];
      if (!p || !list.includes(p)) { console.log(`  skipping "${id}" (not available for ${audience})`); continue; }
      const net = ads.networks[id] || {};
      for (const [k, f] of Object.entries(p.fields || {})) {
        if (f.type === 'object') continue;
        const v = await ask(`  ${p.name} ${f.label}${f.required ? '' : ' (optional)'}`, net[k] === undefined ? '' : String(net[k]));
        if (v) net[k] = f.type === 'boolean' ? v === 'true' : v;
      }
      ads.networks[id] = net;
    }
    ads.slots = ads.slots || {};
    console.log('\nSlots: for each, a network id (or "off", "on" = house placeholder / empty container, "custom" = paste HTML later).');
    for (const n of SLOT_NAMES) {
      if (n === 'sponsored_links') continue;
      const cur = ads.slots[n];
      const curTxt = cur && typeof cur === 'object' ? cur.network : cur === false ? 'off' : 'on';
      const fmt = SLOTS[n].format;
      const ok = ids.filter(id => PRESETS[id] && (fmt === 'vast' ? PRESETS[id].vast : pickFormat(PRESETS[id], fmt)));
      const v = await ask(`  ${pad(n, 15)} (${fmt}${ok.length ? `; can serve it: ${ok.join(', ')}` : ''})`, curTxt || (SLOTS[n].default ? 'on' : 'off'));
      if (v === 'off' || v === 'on') { ads.slots[n] = v === 'on'; continue; }
      const p = PRESETS[v];
      if (!p) { console.log(`    unknown network "${v}", slot left as is`); continue; }
      const o = { network: v };
      if (fmt === 'vast' && !p.zone) o.vast_url = await ask('    VAST tag URL (https)');
      else if (v === 'custom') console.log('    paste the dashboard snippet into ads.slots.' + n + '.html afterwards');
      else {
        o.zone = await ask(`    ${p.zone?.label || 'zone'}`, cur?.zone || '');
        if (fmt !== 'vast' && SLOTS[n].mobile_size) { const m = await ask('    mobile zone (optional, for the mobile size)', cur?.mobile_zone || ''); if (m) o.mobile_zone = m; }
      }
      ads.slots[n] = o;
    }
    const google = Object.keys(ads.networks).some(id => PRESETS[id]?.google);
    ads.consent = ads.consent || {};
    ads.consent.mode = await ask('Consent (auto = built-in EU banner | cmp = paste a certified TCF CMP | none)', ads.consent.mode || (google ? 'cmp' : 'auto'));
    let age_gate = raw.age_gate;
    if (audience === 'adult') {
      const m = await ask('Age gate (provider | click | sim | off)', raw.age_gate?.mode || (raw.private === false ? 'provider' : 'sim'));
      age_gate = { ...(raw.age_gate || {}), mode: m };
    }
    return { audience, ads, age_gate };
  } finally { rl.close(); }
}

async function setup(file) {
  const text = fs.readFileSync(file, 'utf8');
  const raw = readRaw(file);
  let next;
  if (argv.includes('--yes')) {
    const ads = JSON.parse(JSON.stringify(raw.ads || {}));
    const audience = flag('--audience', raw.audience || 'general');
    if (flag('--mode')) ads.mode = flag('--mode');
    if (flag('--consent') || flag('--region')) ads.consent = { ...(ads.consent || {}), ...(flag('--consent') ? { mode: flag('--consent') } : {}), ...(flag('--region') ? { region: flag('--region') } : {}) };
    for (const n of flags('--net')) applyNet(ads, n);
    for (const s of flags('--slot')) applySlot(ads, s);
    let age_gate = raw.age_gate;
    if (flag('--age-gate')) age_gate = { ...(raw.age_gate || {}), mode: flag('--age-gate') };
    next = { audience, ads, age_gate };
  } else {
    next = await wizard(raw);
  }
  let out = setTopLevel(text, 'ads', next.ads);
  if (next.audience !== (raw.audience || 'general') || raw.audience) out = setTopLevel(out, 'audience', next.audience);
  if (next.age_gate) out = setTopLevel(out, 'age_gate', next.age_gate);
  // validate before writing
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, out);
  try {
    const r = readRaw(tmp);
    const errs = schemaErrors(r);
    if (!errs.length) errs.push(...crossErrors(resolve(r, file)));
    if (errs.length) { console.error(`not written, the result would be invalid:\n  ${errs.join('\n  ')}`); process.exitCode = 1; return; }
  } finally { fs.rmSync(tmp, { force: true }); }
  fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, out);
  console.log(`wrote ${file} (previous version: ${path.basename(file)}.bak). Next: ./tube ads check`);
}

// ---------- check ----------
function check(file, modeOverride) {
  const c = load(file);
  const A = normalizeAds(c.ads, { language: c.site.language, modeOverride });
  const base = { audience: c.audience, simOrigin: A.sim.origin };
  console.log(`site "${c.site.name}"  audience ${c.audience}  private ${c.private}  ads.mode ${A.mode}  consent ${A.consent.effective} (region ${A.consent.region}${A.consent.us_optout ? ', US opt-out link + GPC' : ''})`);
  if (c.audience === 'adult') console.log(`age gate: ${c.age_gate.mode}${Object.keys(c.age_gate.geo_rules).length ? `, geo rules ${JSON.stringify(c.age_gate.geo_rules)}` : ''}`);
  console.log('\nslot             on   network         format        zone / source                verified');
  for (const n of SLOT_NAMES) {
    const s = A.slots[n];
    const p = s.network && PRESETS[s.network];
    const m = slotMarkup(A, n, base);
    const fmt = n === 'preroll' ? (prerollOf(A, base)?.kind || '-') : m ? m.format : (p ? pickFormat(p, s.format) || 'n/a' : s.format);
    const src = n === 'preroll' ? (prerollOf(A, base)?.url || (A.house_preroll ? 'house pre-roll' : '')) : s.zone || (s.html ? '(pasted html)' : '');
    const ver = p ? (p.verified ? (p.unverifiedFormats?.includes(s.format) ? 'NO (format)' : 'yes') : 'NO') : '';
    console.log(`${pad(n, 16)} ${pad(s.on ? 'yes' : 'no', 4)} ${pad(s.on ? (A.mode === 'sim' ? 'simads' : s.network || (A.mode === 'live' ? '(container)' : 'house')) : '', 15)} ${pad(s.on ? fmt : '', 13)} ${pad(s.on ? src : '', 28)} ${s.on ? ver : ''}`);
  }
  const markup = allMarkup(A, base);
  console.log(`\nContent-Security-Policy (${A.mode} mode, ad snippets only; the page adds its own inline hashes):\n  ${buildCsp(A, { simOrigin: A.sim.origin }, inlineScriptHashes(markup)).split('; ').join(';\n  ')}`);
  const redirect = adsTxtRedirect(A, c.deploy.domain || 'example.com');
  console.log(`\n/ads.txt:${redirect ? ` 301 -> ${redirect}` : `\n${adsTxt(A, c.site.name).replace(/^/gm, '  ')}`}`);
  const used = new Set(SLOT_NAMES.map(n => A.slots[n]).filter(s => s.on && s.network && PRESETS[s.network]).map(s => s.network));
  if (used.size) {
    console.log('presets in use:');
    for (const id of used) { const p = PRESETS[id]; console.log(`  ${pad(id, 15)} ${p.verified ? 'verified' : 'UNVERIFIED'} ${p.verify.date}  ${p.verify.url}`); }
  }
  const w = adsWarnings(c);
  if (w.length) console.log(`\nwarnings:\n  ${w.join('\n  ')}`);
  console.log('\nok');
}

// ---------- report ----------
async function report(file, url) {
  const c = load(file);
  let auth = '';
  if (!url) {
    const port = fs.readFileSync(path.join(c.paths.dev, 'port'), 'utf8').trim();
    url = `http://127.0.0.1:${port}`;
    if (c.private) auth = `${c.deploy.basic_auth.user}:${fs.readFileSync(path.join(c.paths.dev, 'password'), 'utf8').trim()}`;
  } else if (c.private && fs.existsSync(path.join(c.paths.secrets, c.deploy.basic_auth.password_secret))) {
    auth = `${c.deploy.basic_auth.user}:${fs.readFileSync(path.join(c.paths.secrets, c.deploy.basic_auth.password_secret), 'utf8').trim()}`;
  }
  const win = flag('--window', '24h');
  const res = await fetch(`${url.replace(/\/+$/, '')}/simads/report.json?window=${encodeURIComponent(win)}`, {
    headers: auth ? { authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {},
  });
  if (!res.ok) throw new Error(`GET /simads/report.json: HTTP ${res.status} (is the site running with ads.mode "sim"?)`);
  const r = await res.json();
  const t = r.totals || {};
  const money = v => (Number(v) || 0).toFixed(4);
  const pct = v => `${((Number(v) || 0) * 100).toFixed(1)}%`;
  console.log(`simulated revenue, window ${r.window} (generated ${r.generated_at})`);
  console.log(`pageviews ${t.pageviews}  visits ${t.visits}  impressions ${t.impressions}  revenue ${money(t.revenue)}  RPM ${money(t.rpm_pageviews)}  fill ${pct(t.fill_rate)}  CTR ${pct(t.ctr)}`);
  for (const [title, rows] of [['zone', r.by_zone], ['format', r.by_format], ['geo', r.by_geo], ['device', r.by_device], ['partner', r.by_partner]]) {
    if (!rows?.length) continue;
    console.log(`\n${pad(`by ${title}`, 16)} ${pad('imps', 8)} ${pad('fill', 7)} ${pad('view', 7)} ${pad('CTR', 7)} ${pad('eCPM', 9)} ${pad('RPM', 9)} revenue`);
    for (const x of rows) console.log(`${pad(x.key, 16)} ${pad(x.impressions, 8)} ${pad(pct(x.fill_rate), 7)} ${pad(pct(x.viewability), 7)} ${pad(pct(x.ctr), 7)} ${pad(money(x.ecpm), 9)} ${pad(money(x.rpm_pageviews), 9)} ${money(x.revenue)}`);
  }
}

// ---------- expect (./tube test) ----------
function expect(file) {
  const c = load(file);
  const A = normalizeAds(c.ads, { language: c.site.language, modeOverride: flag('--mode') || undefined });
  const served = A.mode === 'live' || A.mode === 'sim';
  const pr = A.mode !== 'off' && A.slots.preroll.on ? prerollOf(A, { audience: c.audience, simOrigin: A.sim.origin }) : null;
  // the e2e expects the house pre-roll when consent is pending (live, banner) or the network is simulated (sim VAST)
  const preroll = !pr ? '0' : pr.kind === 'vast' ? (A.mode === 'sim' ? 'vast' : (A.consent.effective !== 'none' && A.house_preroll ? 'house' : 'any')) : 'house';
  const sticky = A.mode !== 'off' && A.slots.sticky.on ? 1 : 0;
  console.log([A.mode, preroll, sticky, c.audience, c.age_gate.mode, served ? A.consent.effective : 'none'].join(' '));
}

const [cmd, arg] = argv.filter(a => !a.startsWith('--') && !['--window', '--mode', '--audience', '--consent', '--region', '--net', '--slot', '--age-gate'].includes(argv[argv.indexOf(a) - 1]));
const file = configPath();
try {
  if (cmd === 'setup') await setup(file);
  else if (cmd === 'check') check(file, flag('--mode') || undefined);
  else if (cmd === 'report') await report(file, arg);
  else if (cmd === 'expect') expect(file);
  else { console.error('usage: ./tube ads setup [--yes flags] | check [--mode M] | report [URL] [--window 1h|24h|7d|all]'); process.exit(2); }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
