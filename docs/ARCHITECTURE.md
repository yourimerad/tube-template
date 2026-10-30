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
- `app/src/views/*`: server-rendered HTML; the site's own code has no inline script or style (strict CSP).
  Per-request data goes in `<script type="application/json">` blocks. Inline scripts of ad tags are allowed one by
  one by their sha256 (see Ads engine).
- `app/static/js/watch.js`: player (hls.js, quality menu, pre-roll, votes, comments); `site.js`: hover / touch
  previews; `ads.js`: consent + ad activation; `ads-vast.js`: VAST 4.x pre-roll; `age.js`: age-gate session refresh.
- `app/migrations/*.sql`: applied in order at start-up.
- Privacy: viewers are identified by a random cookie hashed with `HASH_SALT`; IPs are hashed the same way for rate
  limits and never stored in clear.

## Ads engine

User docs: docs/ADS-general.md and docs/ADS-adult.md. Commands: `./tube ads setup | check | report`,
`./tube dev --ads off|placeholder|sim|live|config`.

**Config.** `ads` (+ `audience`, `age_gate`, `legal`) in site.config.json → `lib/config.mjs` validates it (schema,
then cross rules: unknown / closed network, audience mismatch, zone formats, Google + adult / popunder /
interstitial / EU without a TCF CMP, `sim` on a public site, public adult click-through without
`allow_click_through`, provider keys) and writes the runtime `site.json`. `app/src/ads/normalize.js` turns it into one
shape used everywhere (server, CLI, ingest, tests): mode, 11 slots `{on, network, zone, mobile_zone, html,
vast_url, format}`, consent `{mode, region, effective, us_optout}`. The legacy form (boolean slots, `ads.vast_url`,
`csp_origins`) still works.

**Presets** (`app/src/ads/presets/<id>.js`, interface in `_util.js`): metadata (audiences, Google or not,
`verified` + source URL + date, `unverifiedFormats`, signup URL, account `fields`, zone pattern) and pure
functions: `head(net)` (loader in `<head>`), `render(format, slot, net, ctx)` → HTML variants per device
(`desk` / `mob` / `all`), `vast(slot, net)` → VAST URL with macros, `adsTxt(net)`, CSP origins per directive.
Closed programs (AdXpansion, TrafficJunky self-serve) are stubs that make validation fail with an explanation.
`render.js` picks the format each preset supports and assembles `pageAssets` (head / bodyEnd / CMP).

**CSP** (`csp.js`). Per page: `'self'` + the origins of the presets in use + `'sha256-…'` of every inline script
of the ad markup (computed once per markup and cached) + the CMP origins; no `unsafe-inline`, no nonce (pages are
cached by nginx, a nonce would be shared by everyone). Google tags officially need a nonce-based strict CSP, which
a cached page cannot give: Google presets use `https:` in script-src / frame-src plus `'unsafe-eval'` instead.
`ads.csp_unsafe_inline` is the escape hatch for networks that inject inline scripts at run time.

**Consent wire protocol.** While consent is required, `views/ads.js` makes every ad `<script>` inert
(`type="text/plain" data-consent="ads"`, the real type in `data-type`) and puts device variants in
`<template data-ad-tpl data-media="desk|mob|all">`; slots show a labelled house box meanwhile. `static/js/ads.js`
reads the `tube_consent` cookie (1 accept / 0 refuse, 6 months) or the banner choice, then activates: head
scripts first, then templates matching the viewport, then the rest, **sequentially** (an external script without
`async` is awaited before the next one, so `atOptions = {...}` + `invoke.js` pairs work). US opt-out:
`tube_optout` cookie or `navigator.globalPrivacyControl` = refusal, and wins over everything. With a CMP
(`consent.mode "cmp"`), the CMP snippet is never inert and the TCF `__tcfapi` answer replaces the banner.

**VAST pre-roll** (`static/js/ads-vast.js`): VAST 4.x (and 2/3) InLine + Wrapper chains (max 5), macros
(`[CACHEBUSTING]`, `[PAGEURL]`, `[TIMESTAMP]`, `[ERRORCODE]`), skipoffset, impression / quartile / skip / click
/ error tracking, progressive MP4 only, timeouts, falls back to the house pre-roll or straight to the video.
Same-origin VAST (SimAds) is fetched with credentials, third-party VAST without. Not supported: VPAID, SIMID,
OMID verification. Legacy "AdSense for video" ended on 2026-05-31; Google Ad Manager video demand (AdX) needs the
IMA SDK, so the `gam` preset's VAST URL works with ads-vast.js only for direct-sold / non-AdX line items.

**SimAds** (ads.mode `sim`, `app/src/simads/`, private sites only): the engine renders the `simads` preset:
`<script async src="/simads/static/loader.js" data-audience="…">` + `<ins class="simads" data-zone data-format
data-size data-mobile-size>` per slot, and the pre-roll VAST URL `/simads/vast?zone=preroll`. The loader fills
the `ins`, sends beacons, and does nothing when `<html data-age-gate>` is set. `./tube ads report` reads
`/simads/report.json`. Consent applies in sim mode exactly as in live mode.

**Age gate** (`app/src/ads/agegate.js`, audience adult). Passing the gate sets two session cookies:
`av_exp` (unix expiry, now + 1 h, slid by `POST /age/refresh` from `age.js` while the visitor is active) and
`av_sig = base64url(md5("<av_exp> <AGE_COOKIE_SECRET>"))`, HttpOnly. The app checks them in an `onRequest` hook
(ungated: `/age/*`, `/legal/*`, static, health, robots, ads.txt); nginx checks the same pair with `secure_link`
(rendered into `gate.conf` by `site-entrypoint.sh` when `AGE_GATE=1`; it refuses to start without the secret),
returns 403 on `/media` without it, forwards only those two cookies to the app, and adds the result + the geo
headers to the page-cache key (`$age_key`), so verified and unverified pages never mix while the 30 s cache keeps
working. The gate page itself is a bare layout: no script, image, video or ad. `geo_rules` map a country or
`US-XX` (from `CF-IPCountry` / `X-Country` / `X-Region`) to verify / click / block (451). Provider flow:
`/age/start` → provider `start_url?return_url&state` → `/age/callback?token&state`; token = HMAC
(`base64url(JSON).base64url(HMAC-SHA256)`, secret `AGE_GATE_SECRET`) or a JWS ES256 / RS256 checked against a PEM
key or a JWKS URL (cached 1 h); claims `over18`, `exp` (≤ 1 h), `state`. `sim` mode puts a local fake verifier at
`/age/sim`. Every response of an adult site carries `Rating: RTA-5042-1996-1400-1577-RTA` (+ the meta tag).
Secrets: `secrets/age.env` (600) on the box, `AGE_COOKIE_SECRET` generated there once, `AGE_GATE_SECRET`
piped from `~/.secrets/<age_gate.provider.verify.secret_name>`. A CDN in front of `/media` bypasses nginx's check:
use the CDN's own token auth (validation warns).

**Tests.** `app/test/run-e2e.sh` runs every `app/test/e2e*.mjs`; `e2e-ads.mjs` covers validation cases and,
driven by `app/test/ads-scenarios.sh` (placeholder, live, adult-click, adult-sim on a throwaway private config),
labelled slots, zero third-party request before consent, exact preset tags, CSP origins + hashes without
violation, consent refuse / accept / GPC, a VAST pre-roll with tracking (every third-party request intercepted
by Playwright, nothing leaves the machine), `/ads.txt`, the age gate (gate page content, `/media` 403, session
cookies, forged cookie, cache isolation, geo block, sliding refresh, failed verification).
