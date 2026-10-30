# Architecture

One config file (`site.config.json`) drives four pieces: the ingest pipeline, the media bucket, the box, and the app.

```
 videos/<Category>/<file>.mp4          site.config.json (+ optional manifest CSV/JSON)
            │                                   │
            ▼                                   ▼
 ┌──────────────────────── ./tube ingest (pipeline/ingest.mjs, ffmpeg) ─────────────────────────┐
 │ per video: HLS fMP4 ladder (by short side, never upscaled), poster.jpg/.webp, preview.mp4   │
 │ out/media/<id>/<v>/...   out/media/catalog.json   (incremental: .ingest.json per video)     │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
            │ ./tube bucket sync (rclone, immutable Cache-Control, explicit Content-Types)
            ▼
   S3 bucket <prefix>media-xxxxxx (private; any S3-compatible provider)
            │ ./tube deploy: the box pulls <bucket>/media/ (or deploy.media_origin = "rsync": pushed over SSH)
            ▼
 ┌──────────────────────────── the box (OVH instance or any Ubuntu server) ─────────────────────┐
 │ /srv/<slug>/media  (read-only bind mount)                                                   │
 │                                                                                             │
 │  nginx :80/:443 ── /media/*  files, immutable, byte ranges, CORS, catalog.json hidden      │
 │      │          ── /static/* immutable + gzip                                               │
 │      │          ── /, /v/... 30 s micro-cache (cookies ignored), basic auth when private    │
 │      ▼                                                                                      │
 │  app (Node 24, Fastify SSR) ── seeds categories + videos from media/catalog.json at start  │
 │      │                         views/votes/comments API, search (Postgres full text)        │
 │      ▼                                                                                      │
 │  postgres 17 (volume)                                                                       │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Everything runs from `docker compose` (`app/docker-compose.yml`); `./tube dev` runs the same stack locally on
`127.0.0.1:<dev.port>` with `app/test/compose.local.yml`.

## The media contract

The app never touches video files. It only builds URLs:

```
<MEDIA_BASE>/<media_path>/hls/master.m3u8        HLS master playlist (rungs: hls/<short side>/index.m3u8 + .m4s)
<MEDIA_BASE>/<media_path>/poster.webp|.jpg       poster
<MEDIA_BASE>/<media_path>/preview.mp4            silent hover preview (426x240, a few seconds)
<MEDIA_BASE>/_house/preroll.mp4                  house pre-roll (when ads.house_preroll)
```

- `id` = 8 base-36 characters of sha256(relative path of the source). Renaming a file makes a new video.
- `media_path` = `<id>/<v>` with `ingest.versioned_paths` (default), else `<id>`. `v` = 6 hex characters of a hash
  of the encode settings, the pipeline version and the source size/mtime. A re-encode gets a new path, so files can
  be cached for a year (`immutable`) by browsers and any CDN. The old version is removed locally after a
  successful encode; `bucket sync` deletes it remotely.
- `catalog.json` (one entry per video): `id, slug, title, description, category, category_name, tags, duration_s,
  width, height, renditions, source, created_at, media_path, hidden`. The app reads it at start-up (upsert), so
  `./tube ingest && ./tube bucket sync && ./tube deploy` is the whole publishing flow. Videos that disappear from
  the catalog are hidden, not deleted (their views/comments survive a re-add).

## MEDIA_BASE: the CDN switch

`media_base` defaults to `/media` (the box's nginx serves the files). Moving media to a CDN or edge boxes is a
config change: set `"media_base": "https://media.example.com"`, point that host at the bucket (or at edge
servers that mirror it) and `./tube deploy`. The CSP, the player and the previews follow. Because every media URL is
immutable and versioned, any pull-through cache works without purges. See [SCALING.md](SCALING.md).

## Config → runtime

`lib/config.mjs` loads `site.config.json` (JSONC), validates it against `site.config.schema.json`, fills the
defaults, and produces:

- `app/site.json` (`./tube dev` / `./tube deploy` write it; baked into the image): name, language, theme,
  strings, label, ads, categories. The app merges `app/locales/<lang>.json` with `strings`.
- shell variables for `infra/*.sh` (`node lib/config.mjs shell`).

Per-box environment (`.env.site` on the box) overrides only what differs per host: `SITE_HOST`, `PRIVATE`,
`MEDIA_BASE`, `SITE_SCHEME`, `AUTH_REALM`. Secrets (`POSTGRES_PASSWORD`, `HASH_SALT`) are generated on the box into
`/srv/<slug>/secrets/.env` (600) and never leave it.

## Hosting targets

| | `ovh` | `ssh` |
|---|---|---|
| create | `./tube up`: POST instance (region fallback), cloud-init runs `infra/box-setup.sh` | `./tube up`: `infra/box-setup.sh` piped over SSH |
| box setup | docker, ufw (SSH from your IP only, 80/443), swap, journald caps | same; SSH from `deploy.ssh.allow_ssh_from` |
| deploy | `./tube deploy` (same script) | same |
| stop paying | `./tube park` (snapshot + delete), `./tube teardown` | n/a (`teardown` = compose down) |
| safety | watchdog timer parks at cap-15 min and deletes at cap | n/a |

Every cloud resource is named `<deploy.prefix>...` (`<prefix>web-1`, `<prefix>loadgen`, `<prefix>park-<date>`,
`<prefix>key`, `<prefix>media-xxxxxx`). Every destructive call checks that the API name of the resource starts with
the prefix and that its id is not in `deploy.ovh.protected_ids`; `--dry-run` makes the API client refuse any
non-GET call.

## App

- `app/src/server.js`: routes (`/`, localized `/trending /new /top-rated` or `/tendances /nouveautes /mieux-notees`,
  `/c/<category>`, `/v/<id>/<slug>`, `/search`, `/categories`, sitemap, robots), JSON API (`/api/videos/<id>/...`).
- `app/src/views/*`: server-rendered HTML; no inline script or style (strict CSP). Per-request data goes in
  `<script type="application/json">` blocks.
- `app/static/js/watch.js`: player (hls.js, quality menu, pre-roll, votes, comments); `site.js`: hover / touch
  previews; `ads-vast.js`: VAST pre-roll for `ads.mode = "live"`.
- `app/migrations/*.sql`: applied in order at start-up.
- Privacy: viewers are identified by a random cookie hashed with `HASH_SALT`; IPs are hashed the same way for rate
  limits and never stored in clear.
