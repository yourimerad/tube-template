// SimAds event store: an in-memory buffer flushed to Postgres in batches (one multi-row INSERT per second),
// per-IP rate limits, a hard cap on the buffer and on the table, and the report queries.
import { q } from '../db.js';

const FLUSH_MS = 1000;
const FLUSH_ROWS = 300;
const MAX_BUFFER = 20_000;      // events waiting for the DB; beyond that new events are dropped (and counted)
const MAX_ROWS = 5_000_000;     // table cap (estimate from pg_class); the oldest rows go first
const KEEP_DAYS = 90;

const COLS = ['ev', 'aid', 'zone', 'format', 'size', 'audience', 'geo', 'tier', 'device', 'partner', 'creative', 'filled', 'price_micros', 'visit'];
const TYPES = ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'boolean', 'int', 'text'];
let buf = [];
export const stats = { dropped_buffer: 0, dropped_bad: 0, dropped_rate: 0, rejected_token: 0, flushed: 0, flush_errors: 0 };

export function push(row) {
  if (buf.length >= MAX_BUFFER) { stats.dropped_buffer++; return false; }
  buf.push(row);
  if (buf.length >= FLUSH_ROWS) flush().catch(() => {});
  return true;
}

const NULLABLE = new Set(['aid', 'filled', 'visit']);
const clean = (r, c, i) => {
  const v = r[c];
  if (v === undefined || v === null) return NULLABLE.has(c) ? null : TYPES[i] === 'int' ? 0 : '';
  return TYPES[i] === 'text' ? String(v).slice(0, 64) : v;
};
const insert = rows => q(`INSERT INTO simads_events (${COLS.join(', ')})
  SELECT * FROM unnest(${TYPES.map((t, i) => `$${i + 1}::${t}[]`).join(', ')})
  ON CONFLICT DO NOTHING`, COLS.map((c, i) => rows.map(r => clean(r, c, i))));

let flushing = null;
export async function flush() {
  if (flushing) return flushing;
  if (!buf.length) return;
  const rows = buf;
  buf = [];
  flushing = (async () => {
    try {
      await insert(rows);
      stats.flushed += rows.length;
    } catch (err) {
      // One bad row must not lose the batch: retry row by row, drop only what still fails.
      stats.flush_errors++;
      for (const r of rows) {
        try { await insert([r]); stats.flushed++; } catch { stats.dropped_bad++; }
      }
      throw err;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// ---------- per-key fixed-window rate limits ----------
const windows = new Map(); // key -> { n, until }
export function allow(key, limit, ms = 60_000) {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.until < now) { w = { n: 0, until: now + ms }; windows.set(key, w); }
  if (++w.n > limit) { stats.dropped_rate++; return false; }
  return true;
}

let timers = [];
export function start(log) {
  timers.push(setInterval(() => flush().catch(err => log.warn({ err: err.message }, 'simads flush failed')), FLUSH_MS));
  timers.push(setInterval(() => { const now = Date.now(); for (const [k, w] of windows) if (w.until < now) windows.delete(k); }, 60_000));
  const prune = async () => {
    await q(`DELETE FROM simads_events WHERE at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
    const { rows } = await q(`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'simads_events'`);
    const over = Number(rows[0]?.n || 0) - MAX_ROWS;
    if (over > 0) await q(`DELETE FROM simads_events WHERE id IN (SELECT id FROM simads_events ORDER BY id LIMIT $1)`, [over]);
  };
  timers.push(setInterval(() => prune().catch(err => log.warn({ err: err.message }, 'simads prune failed')), 3600_000));
  for (const t of timers) t.unref();
}
export async function stop() { for (const t of timers) clearInterval(t); timers = []; await flush().catch(() => {}); }

export async function reset() {
  buf = [];
  await q('TRUNCATE simads_events');
  for (const k of Object.keys(stats)) stats[k] = 0;
}

// ---------- report ----------
export const WINDOWS = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', all: null };

const METRICS = `
  count(*) FILTER (WHERE ev = 'pv')                                    AS pageviews,
  count(DISTINCT visit) FILTER (WHERE ev = 'pv')                       AS visits,
  count(*) FILTER (WHERE ev = 'req')                                   AS requests,
  count(*) FILTER (WHERE ev = 'req' AND filled)                        AS filled,
  count(*) FILTER (WHERE ev = 'imp')                                   AS impressions,
  count(DISTINCT aid) FILTER (WHERE ev = 'view' OR (format = 'vast' AND ev = 'q1')) AS viewable,
  count(*) FILTER (WHERE ev = 'click')                                 AS clicks,
  count(*) FILTER (WHERE ev = 'close')                                 AS closes,
  coalesce(sum(price_micros) FILTER (WHERE ev = 'imp'), 0)             AS revenue_micros,
  count(*) FILTER (WHERE ev = 'start')                                 AS v_start,
  count(*) FILTER (WHERE ev = 'q1')                                    AS v_q1,
  count(*) FILTER (WHERE ev = 'mid')                                   AS v_mid,
  count(*) FILTER (WHERE ev = 'q3')                                    AS v_q3,
  count(*) FILTER (WHERE ev = 'complete')                              AS v_complete,
  count(*) FILTER (WHERE ev = 'skip')                                  AS v_skip`;

const r4 = n => Math.round(n * 1e4) / 1e4;
const ratio = (a, b) => (b ? r4(a / b) : 0);

function metrics(row, pageviews, visits) {
  const n = k => Number(row[k] || 0);
  const revenue = n('revenue_micros') / 1e6;
  const imps = n('impressions');
  return {
    pageviews: n('pageviews'), visits: n('visits'),
    requests: n('requests'), filled: n('filled'), fill_rate: ratio(n('filled'), n('requests')),
    impressions: imps, viewable: n('viewable'), viewability: ratio(n('viewable'), imps),
    clicks: n('clicks'), ctr: ratio(n('clicks'), imps), closes: n('closes'),
    revenue: Math.round(revenue * 1e6) / 1e6, revenue_micros: n('revenue_micros'),
    ecpm: imps ? r4((revenue / imps) * 1000) : 0,
    rpm_pageviews: pageviews ? r4((revenue / pageviews) * 1000) : 0,
    rpm_visits: visits ? r4((revenue / visits) * 1000) : 0,
    video: { start: n('v_start'), q1: n('v_q1'), mid: n('v_mid'), q3: n('v_q3'), complete: n('v_complete'), skip: n('v_skip'),
      completion_rate: ratio(n('v_complete'), n('v_start')) },
  };
}

export async function report(win = '24h', { events = 0 } = {}) {
  await flush().catch(() => {});
  const iv = WINDOWS[win] === undefined ? WINDOWS['24h'] : WINDOWS[win];
  const where = iv ? `WHERE at > now() - interval '${iv}'` : '';
  const { rows } = await q(`SELECT
      GROUPING(zone) AS g_zone, GROUPING(format) AS g_format, GROUPING(geo) AS g_geo, GROUPING(device) AS g_device,
      GROUPING(partner) AS g_partner, zone, format, geo, device, partner, ${METRICS}
    FROM simads_events ${where}
    GROUP BY GROUPING SETS ((), (zone), (format), (geo), (device), (partner))`);
  const total = rows.find(r => r.g_zone && r.g_format && r.g_geo && r.g_device && r.g_partner) || {};
  const pv = Number(total.pageviews || 0), visits = Number(total.visits || 0);
  const by = (dim, own) => rows
    .filter(r => !r[`g_${dim}`] && ['zone', 'format', 'geo', 'device', 'partner'].filter(d => d !== dim).every(d => r[`g_${d}`]))
    .filter(r => r[dim] !== '')
    .map(r => {
      const m = metrics(r, own ? Number(r.pageviews) : pv, own ? Number(r.visits) : visits);
      return { key: r[dim], ...m };
    })
    .sort((a, b) => b.revenue - a.revenue || b.impressions - a.impressions || String(a.key).localeCompare(String(b.key)));
  const out = {
    window: WINDOWS[win] === undefined ? '24h' : win,
    generated_at: new Date().toISOString(),
    totals: metrics(total, pv, visits),
    // zone / format / partner RPMs use all pageviews; GEO / device RPMs use the pageviews of that GEO / device.
    by_zone: by('zone', false), by_format: by('format', false), by_geo: by('geo', true), by_device: by('device', true),
    by_partner: by('partner', false),
    drops: { ...stats },
  };
  if (events) {
    const { rows: ev } = await q(`SELECT at, ev, aid, zone, format, size, geo, tier, device, partner, creative, filled, price_micros
      FROM simads_events ${where} ORDER BY id DESC LIMIT $1`, [Math.min(5000, events)]);
    out.events = ev.map(e => ({ ...e, price: e.price_micros / 1e6 }));
  }
  return out;
}
