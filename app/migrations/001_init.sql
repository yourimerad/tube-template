-- Initial schema. Counters start at 0; visitors and IPs are only stored as salted hashes.

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE categories (
  slug     text PRIMARY KEY,
  name     text NOT NULL,
  position int  NOT NULL DEFAULT 100
);

CREATE TABLE videos (
  id             text PRIMARY KEY,
  slug           text NOT NULL,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  category_slug  text NOT NULL REFERENCES categories(slug),
  tags           text[] NOT NULL DEFAULT '{}',
  duration_s     real NOT NULL DEFAULT 0,
  width          int  NOT NULL DEFAULT 0,
  height         int  NOT NULL DEFAULT 0,
  renditions     jsonb NOT NULL DEFAULT '[]',
  source         text,
  published_at   timestamptz NOT NULL DEFAULT now(),
  hidden         boolean NOT NULL DEFAULT false,
  views          bigint NOT NULL DEFAULT 0,
  likes          int NOT NULL DEFAULT 0,
  dislikes       int NOT NULL DEFAULT 0,
  comments_count int NOT NULL DEFAULT 0,
  -- Wilson score lower bound (95%) so "top rated" is not dominated by 1/1 votes.
  rating_score   double precision GENERATED ALWAYS AS (
    CASE WHEN likes + dislikes = 0 THEN 0
    ELSE ((likes + 1.9208) / (likes + dislikes)
          - 1.96 * sqrt((likes::float8 * dislikes) / (likes + dislikes) + 0.9604) / (likes + dislikes))
         / (1 + 3.8416 / (likes + dislikes))
    END) STORED,
  tsv            tsvector NOT NULL DEFAULT ''::tsvector
);

CREATE INDEX videos_published_idx  ON videos (published_at DESC) WHERE NOT hidden;
CREATE INDEX videos_views_idx      ON videos (views DESC) WHERE NOT hidden;
CREATE INDEX videos_rating_idx     ON videos (rating_score DESC, views DESC) WHERE NOT hidden;
CREATE INDEX videos_cat_pub_idx    ON videos (category_slug, published_at DESC) WHERE NOT hidden;
CREATE INDEX videos_cat_views_idx  ON videos (category_slug, views DESC) WHERE NOT hidden;
CREATE INDEX videos_cat_rating_idx ON videos (category_slug, rating_score DESC) WHERE NOT hidden;
CREATE INDEX videos_tags_idx       ON videos USING gin (tags);
CREATE INDEX videos_tsv_idx        ON videos USING gin (tsv);

-- Daily view buckets for "trending" (views over the last 7 days).
CREATE TABLE video_views_daily (
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  day      date NOT NULL,
  views    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, day)
);
CREATE INDEX video_views_daily_day_idx ON video_views_daily (day);

-- View dedup: one counted view per visitor per video per 6 h.
CREATE TABLE view_dedup (
  video_id     text NOT NULL,
  visitor_hash text NOT NULL,
  last_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, visitor_hash)
);
CREATE INDEX view_dedup_last_idx ON view_dedup (last_at);

CREATE TABLE votes (
  video_id     text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL,
  value        smallint NOT NULL CHECK (value IN (-1, 1)),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, visitor_hash)
);

CREATE TABLE comments (
  id           bigserial PRIMARY KEY,
  video_id     text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author       text NOT NULL,
  body         text NOT NULL,
  visitor_hash text NOT NULL,
  ip_hash      text NOT NULL,
  upvotes      int NOT NULL DEFAULT 0,
  hidden       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_video_recent_idx  ON comments (video_id, created_at DESC) WHERE NOT hidden;
CREATE INDEX comments_video_popular_idx ON comments (video_id, upvotes DESC, created_at DESC) WHERE NOT hidden;
CREATE INDEX comments_ip_recent_idx     ON comments (ip_hash, created_at DESC);

CREATE TABLE comment_votes (
  comment_id   bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, visitor_hash)
);
