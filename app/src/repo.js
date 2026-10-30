import { q, TS_CONFIG } from './db.js';
import { t } from './i18n.js';
import { config } from './config.js';

const CARD_COLS = `v.id, v.slug, v.title, v.duration_s, v.width, v.height, v.views, v.likes, v.dislikes,
  v.published_at, v.category_slug, v.media_path`;

// Sort keys are language-neutral (?sort=new); labels come from locales/<lang>.json "sort".
export const SORTS = {
  recommended: { order: `((v.views + 5 * v.likes - 3 * v.dislikes + 3 * v.comments_count + 10)
      / power(extract(epoch FROM now() - v.published_at) / 3600 + 2, 0.6)) DESC, v.published_at DESC` },
  new: { order: 'v.published_at DESC, v.id' },
  views: { order: 'v.views DESC, v.published_at DESC' },
  top_rated: { order: 'v.rating_score DESC, v.views DESC, v.published_at DESC' },
  trending: { order: 'COALESCE(t.recent, 0) DESC, v.views DESC, v.published_at DESC' },
};
export const SORT_TABS = ['recommended', 'new', 'views', 'top_rated'];
export const sortLabel = k => t(`sort.${k}`);

const TRENDING_JOIN = `LEFT JOIN (SELECT video_id, sum(views) AS recent FROM video_views_daily
  WHERE day > current_date - 7 GROUP BY video_id) t ON t.video_id = v.id`;

export async function listVideos({ sort = 'recommended', category = null, tag = null, page = 1 }) {
  const s = SORTS[sort] || SORTS.recommended;
  const where = ['NOT v.hidden'];
  const params = [];
  if (category) { params.push(category); where.push(`v.category_slug = $${params.length}`); }
  if (tag) { params.push([tag]); where.push(`v.tags @> $${params.length}::text[]`); }
  const w = where.join(' AND ');
  const size = config.pageSize;
  const offset = (Math.max(1, page) - 1) * size;
  const [rows, count] = await Promise.all([
    q(`SELECT ${CARD_COLS} FROM videos v ${sort === 'trending' ? TRENDING_JOIN : ''}
       WHERE ${w} ORDER BY ${s.order} LIMIT ${size} OFFSET ${offset}`, params),
    q(`SELECT count(*)::int AS n FROM videos v WHERE ${w}`, params),
  ]);
  return { rows: rows.rows, total: count.rows[0].n };
}

const likeEscape = s => s.replace(/[\\%_]/g, c => '\\' + c);

// Full-text search (Postgres config of the site language) on title (A), tags (B), description (C), OR'ed with an ILIKE fallback
// so partial words still match. Small catalog: the ILIKE part is a cheap seq scan (pg_trgm at scale).
export async function searchVideos(term, page = 1) {
  const size = config.pageSize;
  const offset = (Math.max(1, page) - 1) * size;
  const pattern = `%${likeEscape(term)}%`;
  const where = `NOT v.hidden AND (v.tsv @@ websearch_to_tsquery('${TS_CONFIG}', f_unaccent($1))
     OR f_unaccent(v.title) ILIKE f_unaccent($2) OR f_unaccent(v.description) ILIKE f_unaccent($2)
     OR f_unaccent(array_to_string(v.tags, ' ')) ILIKE f_unaccent($2))`;
  const [rows, count] = await Promise.all([
    q(`SELECT ${CARD_COLS}, ts_rank(v.tsv, websearch_to_tsquery('${TS_CONFIG}', f_unaccent($1))) AS rank
       FROM videos v WHERE ${where}
       ORDER BY rank DESC, (f_unaccent(v.title) ILIKE f_unaccent($2)) DESC, v.views DESC LIMIT ${size} OFFSET ${offset}`, [term, pattern]),
    q(`SELECT count(*)::int AS n FROM videos v WHERE ${where}`, [term, pattern]),
  ]);
  return { rows: rows.rows, total: count.rows[0].n };
}

export async function categories() {
  const { rows } = await q(`SELECT c.slug, c.name, count(v.id)::int AS n,
      (SELECT v2.media_path FROM videos v2 WHERE v2.category_slug = c.slug AND NOT v2.hidden
       ORDER BY v2.views DESC, v2.published_at DESC LIMIT 1) AS top_media
    FROM categories c LEFT JOIN videos v ON v.category_slug = c.slug AND NOT v.hidden
    WHERE NOT c.hidden
    GROUP BY c.slug ORDER BY c.position, c.name`);
  return rows;
}

export async function category(slug) {
  const { rows } = await q('SELECT slug, name FROM categories WHERE slug = $1 AND NOT hidden', [slug]);
  return rows[0] || null;
}

export async function video(id) {
  const { rows } = await q(`SELECT v.*, c.name AS category_name FROM videos v
    JOIN categories c ON c.slug = v.category_slug WHERE v.id = $1 AND NOT v.hidden`, [id]);
  return rows[0] || null;
}

// Related: same category first, then number of shared tags, then popularity. Excludes current.
export async function related(v, limit = 28) {
  const { rows } = await q(`SELECT ${CARD_COLS},
      (CASE WHEN v.category_slug = $2 THEN 10 ELSE 0 END)
      + 3 * cardinality(ARRAY(SELECT unnest(v.tags) INTERSECT SELECT unnest($3::text[]))) AS rel
    FROM videos v WHERE v.id <> $1 AND NOT v.hidden
    ORDER BY rel DESC, v.views DESC, v.published_at DESC LIMIT $4`, [v.id, v.category_slug, v.tags, limit]);
  return rows;
}

export async function comments(videoId, sort = 'recent', limit = 100) {
  const order = sort === 'popular' ? 'upvotes DESC, created_at DESC' : 'created_at DESC';
  const { rows } = await q(`SELECT id, author, body, upvotes, created_at FROM comments
    WHERE video_id = $1 AND NOT hidden ORDER BY ${order} LIMIT $2`, [videoId, limit]);
  return rows;
}

export async function sitemapEntries() {
  const { rows } = await q(`SELECT id, slug, title, published_at FROM videos WHERE NOT hidden ORDER BY published_at DESC LIMIT 45000`);
  return rows;
}
