# SCALING.md — a site built from this template, from 10k to 10M daily users

Status: plan, written 2026-10-30. Prices were looked up 2026-10-30 (sources in §9). Lines marked **(est.)** are
estimates or extrapolations, not quotes. All EUR prices exclude VAT. Monthly = hourly x 730 h. 1 USD = 0.86 EUR **(assumption)**.
Starting point (docs/ARCHITECTURE.md, the default `./tube up` box): one OVH d2-4 (2 vCore, 4 GB, 50 GB NVMe, 250 Mbps) running nginx + Fastify SSR + Postgres
in docker compose. Media is HLS fMP4 (4 s segments) in a private OVH S3 bucket (GRA), pulled to the box disk and
referenced only through `MEDIA_BASE`.

## 0. Assumptions (change these and re-run the arithmetic)

| Key | Value | Note |
|---|---|---|
| Library | 1,000 videos x 300 s, 720p max | |
| Ladder (video + audio kbps) | 720: 2500+128, 480: 1200+96, 360: 700+64, 240: 400+64 | Treated as the average bitrate. That is an upper bound: capped-CRF encodes usually average 60-80 % of maxrate |
| Watched per visit | 50 % = 150 s, 1 video per visit | |
| Player read-ahead lost on exit | 30 s at the ABR mix | hls.js default `maxBufferLength` = 30 s |
| ABR mix | 720p 55 %, 480p 30 %, 360p 7.5 %, 240p 7.5 % | Mostly FR/EU fixed and 4G/5G. Most sessions sustain >3 Mbps, so 720p wins. The 480p share is small screens and the startup rung. The low rungs are weak mobile |
| Hover previews | 10 per visit x 300 KB (426x240, about 6 s) | Middle of the 8-12 range |
| Posters | 36 per visit x 30 KB WebP | 24 on the home grid + 12 related |
| HTML/JSON/JS/CSS | 0.4 MB per visit | Includes hls.js. Ad creatives are not ours |
| Visits per daily user | 1.0 | Raise it if sessions chain videos |
| Peak factor | peak hour = 2.2x daily average (FR evening 20-23h); p95 of 5-min samples ≈ 2.0x | **(assumption)** |
| Dynamic requests per visit | 5 (home, video page, comments JSON, view ping, related) | |
| Writes per visit | 1 view, 5 % vote, 0.5 % comment | **(assumption)** |
| Audience | France/EU | |
| Month | 30.4 days | |

### 0.1 Storage per video and for the library

| Item | Per video | 1,000 videos |
|---|---|---|
| 720p rung (2,628 kbps x 300 s) | 98.6 MB | 98.6 GB |
| 480p rung | 48.6 MB | 48.6 GB |
| 360p rung | 28.7 MB | 28.7 GB |
| 240p rung | 17.4 MB | 17.4 GB |
| HLS ladder total | 193.2 MB | 193.2 GB |
| preview.mp4 + poster.jpg/webp | about 0.4 MB | 0.4 GB |
| **Total** | **≈ 194 MB** | **≈ 194 GB** (OVH Object Storage: about EUR 1.4/month) |

The library is already too big for the current d2-4 disk (50 GB), so tier 1 needs a block volume or a bigger disk.

### 0.2 Bytes per visit and per daily user

| Component | MB/visit | Share |
|---|---|---|
| Video watched: 150 s at the ABR mix (1,926 kbps) | 36.1 | 76 % |
| Read-ahead discarded on exit (30 s) | 7.2 | 15 % |
| Hover previews (10 x 300 KB) | 3.0 | 6 % |
| Posters (36 x 30 KB) | 1.1 | 2 % |
| HTML/JSON/JS/CSS | 0.4 | 1 % |
| **Total per visit = per daily user** | **47.8 MB** | |
| Edge requests per visit | about 95 (49 segments/playlists + 10 previews + 36 posters) | |

## 1. Traffic per tier

| Daily users | Egress/day | **Egress/month** | Avg Gbps | **Peak Gbps (2.2x)** | p95 Gbps | Page req/s at peak | Edge req/s at peak | View / vote / comment writes/s at peak |
|---|---|---|---|---|---|---|---|---|
| 10k | 0.48 TB | **14.5 TB** | 0.044 | **0.10** | 0.09 | 1.3 | 24 | 0.25 / 0.013 / 0.001 |
| 100k | 4.8 TB | **145 TB** | 0.44 | **0.97** | 0.89 | 13 | 242 | 2.5 / 0.13 / 0.013 |
| 1M | 48 TB | **1.45 PB** | 4.4 | **9.7** | 8.9 | 127 | 2,420 | 25 / 1.3 / 0.13 |
| 10M | 478 TB | **14.5 PB** | 44 | **97** | 89 | 1,273 | 24,190 | 255 / 13 / 1.3 |

Takeaways: bandwidth is the whole problem and the database is not. Even at 10M daily users, writes are about 270/s before
batching. With view batching (§3.3) Postgres sees fewer than 120 row updates/s.

## 2. Why the media edge is trivially cacheable

- **Immutable objects.** VOD segments, the `EXT-X-ENDLIST` playlists, posters and previews never change once published. Send
  `Cache-Control: public, max-age=31536000, immutable` on everything under `MEDIA_BASE`. Only HTML and the API stay dynamic.
- **One gotcha.** `<id>` is a stable hash of the source path, so a re-encode would reuse the same URLs and poison every cache.
  Add a version to the path (`<id>/v2/hls/...`) or never re-encode in place.
- **The hot set fits on one box.** The whole library (194 GB) fits 5x over on the 2x960 GB NVMe of the cheapest Advance
  server. Assume Zipf, with the top 20 % of videos taking about 80 % of views **(est.)**. Their 720p+480p rungs come to
  200 x 147 MB = 29 GB, and since viewers watch the first half, the hot bytes are about 18 GB. That fits in the 32 GB of RAM
  of an Advance-1, so it is served from page cache.
- **So edges are mirrors, not caches.** Each edge runs a full `s5cmd sync` of the bucket after every publish, plus an nginx
  `proxy_cache` fallback for anything not yet synced. The hit ratio is about 100 % after warm-up. Cold misses are bounded by
  object count (about 300k objects per edge, once) and do not grow with traffic.
- **Per-box load is small.** 24k edge req/s at 10M daily users is about 500 req/s per box across 48 boxes. With
  `sendfile` + kTLS, a 6-core Zen4 saturates a 3 Gbps port long before it runs out of CPU.

## 3. Architecture per tier

| Layer | Tier 1 — 10k | Tier 2 — 100k | Tier 3 — 1M | Tier 4 — 10M |
|---|---|---|---|---|
| Edge / media | Same box: nginx serves `/media` from a local volume | 2x Advance-1 bare metal (3 Gbps unmetered each, GRA + RBX), full mirror; `MEDIA_BASE=https://media.<domain>` | 6x Advance-1 (18 Gbps) across GRA/RBX/SBG; Bunny DNS geo/latency records + health checks; Bunny Volume pull zone as cold standby | 48x Advance-1 (144 Gbps): 12 each in GRA/RBX/SBG + 4 each in FRA/WAW/LON **or** 7x Scale-a1 @25 Gbps; Bunny Volume as weighted overflow/failover |
| Origin for media | Bucket → box disk | Bucket (source of truth) → edge sync | Same; `origin.media` = 2 edges for the Bunny pull zone | Same + bucket replica in a 2nd region |
| App (Fastify SSR) | 1 container | 2x b3-8 behind Octavia LB S | 3x b3-16 nodes on MKS, HPA | 6x b3-16 nodes, MKS Standard multi-AZ (EU-WEST-PAR) |
| HTML caching | nginx microcache 2 s for anonymous GET | Same on each app node | Edge nginx also proxies HTML with a 2-5 s microcache (anonymous only, `Vary` on cookie presence) | Same; origin sees about 30 % of 1,273 req/s |
| Database | Postgres container | Managed PG **Production** b3-8 (2 nodes, PITR 14 d) | Production b3-16 (2 nodes) + PgBouncer (transaction mode) | **Advanced** b3-32 (3 nodes + read replica, 99.99 %, 30 d backups); reads to replica via `DATABASE_URL_RO` |
| Redis (Valkey) | none (PG is fine) | Self-hosted Valkey on app node 1 | Managed Valkey Production b3-8 | 2 managed clusters: (a) sessions + rate limits, (b) counters + hot caches |
| Search | PG `tsvector` + `pg_trgm` | Same | Same + 60 s Redis cache of top queries | Same; Meilisearch on a b3-8 only if the catalog grows past about 100k videos |
| Transcoding | Local ffmpeg pipeline | Job table (`SELECT ... FOR UPDATE SKIP LOCKED`) + hourly c3 worker | Queue + K8s Jobs on a c3 node pool scaled 0→N | Same, plus upload ingest service and a dead-letter queue |
| Observability | node_exporter + external uptime probe | Prometheus + Grafana + Loki on a b3-8 | Same on a b3-16; player QoE beacons (startup, rebuffer, bitrate) | b3-32 + OVH Logs Data Platform; QoE/view events to ClickHouse; on-call alerting |
| DDoS / bots | OVH Anti-DDoS (included) + nginx `limit_req` | + Turnstile on comment/vote forms | + per-user Redis token buckets; Edge Network Firewall rules | + bot scoring at the edge (UA/ASN/JA4), hotlink protection via `secure_link` tokens on playlists |
| Multi-AZ / region | none | 2 DCs for edge; single-AZ app | 3 DCs for edge; DB 2 nodes | App + DB multi-AZ (PAR 3-AZ); warm DR in GRA; edges in 6 DCs |
| Deploy | docker compose | compose on 2 nodes (Ansible) | **OVH Managed Kubernetes** + Helm; edges via Ansible + cloud-init image | Same; GitOps (Argo CD) |
| Backup | nightly `pg_dump` → bucket + instance snapshot | Managed PITR + weekly logical dump to a bucket in SBG | Same + bucket versioning | Same + cold masters in Standard-IA in a 2nd region; quarterly restore drill |

### 3.1 Edge details
- nginx on the edge: `sendfile on; tcp_nopush on; ssl_conf_command Options KTLS;`, HTTP/2, `open_file_cache`,
  CORS `Access-Control-Allow-Origin: https://<site>`, `immutable` headers, per-IP `limit_conn` to stop single-IP scrapers.
- Health: `/edge-health` returns 200 only if the last sync succeeded and the NIC is below 85 % of its cap. DNS drops red boxes.
- Edges are stateless and rebuilt from one image, so they need no backup and stay out of Kubernetes (they need host networking).
- Public Cloud instances list bandwidth as *not guaranteed* (catalog `guaranteed:false`). Bare metal is "unmetered and guaranteed",
  which is why media moves to bare metal from tier 2.

### 3.2 GeoDNS and anycast at 10M
- **OVH does not sell anycast to customers.** Its BYOIP guide says "an IP range must be used in only one region", and the catalog
  has no anycast product. Real anycast means your own ASN plus transit at several sites, which is not possible on OVH and not worth it here.
- The audience is FR/EU and all OVH EU DCs sit within about 10-30 ms of it. **GeoDNS/latency DNS with health checks is enough.**
  Bunny DNS smart records (geo/latency) and monitoring are free ($1 minimum). Cloudflare DNS-only load balancing or Route 53
  latency records also work. A 30-60 s TTL on `media.<domain>`.
- Each DNS answer carries 4-8 A records drawn from the healthy pool for that region, so clients spread across boxes.

### 3.3 Database, PgBouncer, Redis, view batching
- Views go to `INCR views:<video>` in Redis plus `PFADD seen:<video>:<day> <visitor-hash>` (dedup, at most 1 view per visitor per day).
  A flush job every 10 s runs one `UPDATE videos SET views = views + v.n FROM (VALUES ...) v`, which is at most 1,000 rows per 10 s whatever the traffic.
- Votes: one row per (user, video) with a unique constraint, plus Redis-cached aggregates. Comments: insert into
  `comments(status='pending'|'visible')`; moderation is async.
- PgBouncer in transaction mode from tier 3 (Node pools x pods would otherwise exceed `max_connections`).
  Prepared statements need `max_prepared_statements` (PgBouncer ≥ 1.21) or the driver must not use named statements.
- Sessions and rate limits live in Redis from tier 2, which lets app nodes become stateless (no sticky sessions).

### 3.4 Transcoding (estimate; replace with numbers measured by the pipeline)
| Option | Cost model | 1,000 x 5 min library |
|---|---|---|
| CPU x264 `medium`, 4 rungs + preview + posters | about 10 core-min per video **(est.)** = about 167 core-hours | 8 vCore c3-16: about 21 h; 4x c3-64 (32 vCore each): about 1.3 h; cost about EUR 3.8 either way (c3 EUR 0.0228/vCore-h) |
| GPU NVENC (OVH L4-90 at EUR 0.75/h) | about 10-20 parallel 720p ladders per card **(est.)** | about 2-4 h, about EUR 2-3 |

Recommendation: stay on CPU x264, even `slow`. Encoding happens once and the bytes are served millions of times. NVENC needs
about 10-20 % more bits for the same quality **(est.)**, which only matters if we pay per GB. Keep NVENC for bulk backfills or live.

### 3.5 Deployment: Kubernetes (OVH MKS), not Nomad
- **Pick MKS.** The control plane is free on the Free plan, or EUR 0.09/h (EUR 65.7/month) for Standard (multi-AZ in PAR). It
  integrates natively with the Octavia LB and Block Storage, has a cluster autoscaler for node pools (scale-to-zero c3 pool for
  transcoding), and comes with the Helm/cert-manager/Argo CD ecosystem.
- **Why not Nomad.** We would have to run its control plane ourselves (3 servers). OVH offers no managed Nomad. The license is BSL and the
  ecosystem is smaller. Its simplicity does not outweigh having someone else run the control plane.
- Use Gateway API (Envoy Gateway or Traefik) for ingress. Upstream ingress-nginx was retired in 2026.
- Bare-metal edges stay outside K8s and are managed with Ansible and an image.

## 4. Monthly cost per tier (EUR, ex VAT; labor not included)

| Line | Tier 1 — 10k | Tier 2 — 100k | Tier 3 — 1M | Tier 4 — 10M |
|---|---|---|---|---|
| Edge bare metal | – | 2x Advance-1 = 230.0 | 6x Advance-1 = 689.9 | 48x Advance-1 = 5,519.5 |
| App compute | b3-8 = 37.4 (+250 GB volume 10.5) | 2x b3-8 = 74.8 | 3x b3-16 = 224.1 | 6x b3-16 = 448.2 |
| K8s control plane | – | – | MKS Standard 65.7 | MKS Standard 65.7 |
| Load balancer | – | Octavia S 6.0 | Octavia M 15.0 | 2x Octavia L 80.0 |
| Managed PostgreSQL | – (container) | Production b3-8 x2 = 325.6 | Production b3-16 x2 = 651.3 | Advanced b3-32 x3 = 2,105.9 |
| Redis / Valkey | – | self-hosted 0 | Production b3-8 x2 = 215.5 | 2 clusters = 431.0 |
| Observability | 0 (free probes) | b3-8 = 37.4 | b3-16 = 74.7 | b3-32 + logs ≈ 250 (est.) |
| Search | – | – | – | b3-8 = 37.4 (optional) |
| Object storage + backups | ≈ 3 | ≈ 7 | ≈ 20 | ≈ 60 |
| Transcoding (new uploads) | ≈ 0 | ≈ 5 | ≈ 20 | ≈ 50 |
| DR standby (GRA) | – | – | – | ≈ 800 (est.) |
| CDN overflow/failover (Bunny Volume) | – | – | ≈ 50 (est.) | ≈ 2,000 (est., about 470 TB) |
| **Total / month** | **≈ 51** (min ≈ 27 on the d2-4) | **≈ 686** | **≈ 2,026** | **≈ 11,850** |
| Per daily user / month | 0.0051 | 0.0069 | 0.0020 | 0.0012 |
| One-off | – | Advance setup = 1 month each (230) | 690 | 5,520 |

Alternative tier 4 edge: 7x Scale-a1 with 25 Gbps (599.99 + 1,250 upgrade = 1,849.99 each) = EUR 12,950 for 175 Gbps.
That is 7 boxes instead of 48, at 2.3x the price. Pick it only if ops headcount matters more than EUR 7.4k/month.

### 4.1 Same traffic on third-party CDNs (delivery only, USD/month)

| Daily users (TB/mo) | Bunny Volume | Bunny Standard (EU $0.01) | CloudFront EU list | Fastly EU list | Cloudflare Stream |
|---|---|---|---|---|---|
| 10k (14.5) | 73 | 145 | 1,128 | 1,551 | 937 |
| 100k (145) | 727 | 1,454 | 9,688 | 12,018 | 9,145 |
| 1M (1,454) | 5,408 | 14,538 | 50,430 | 116,692 **(est.)** | 91,225 |
| 10M (14,538) | 31,576 **(est.)** | 145,378 | 329,961 | 1.16M **(est.)** | 912,025 |

Notes:
- Bunny Volume is $0.005/GB up to 500 TB, $0.004 to 1 PB, $0.002 to 2 PB, and "contact sales" above that (extrapolated at $0.002).
- Fastly lists $0.12/GB up to 10 TB and $0.08 for the next 10 TB, then "contact" (extrapolated at $0.08). Contracts land far lower.
- Akamai publishes no list price (contract only).
- Cloudflare Stream: $1 per 1,000 minutes delivered, at 3 min/visit including read-ahead, plus $5 per 1,000 minutes stored (5,000 min = $25).
  Encoding is free. Previews are not included.
- **Cloudflare CDN ToS:** on Free/Pro/Business plans you "must use" paid services (Stream, R2 and similar) "to serve video and other large
  files via the CDN", or Cloudflare may "disable or limit" the CDN. So proxying our HLS through Cloudflare is off the table unless
  we buy Enterprise or Stream. DNS-only use is fine.
- Bunny Stream: free encoding, storage from $0.01/GB, delivery at Bunny CDN rates. It is a reasonable all-in-one at tiers 1-2,
  but at 1M daily users it costs the same as Bunny Volume, so it buys nothing.

### 4.2 Own edge on unmetered bare metal vs CDN: break-even
- An Advance-1 costs EUR 114.99/month for 3 Gbps unmetered. Size it for 70 % at peak with a 2.2 peak factor: 3 x 0.7 / 2.2 =
  0.95 Gbps average, which is **about 313 TB/month per box, or EUR 0.37/TB**.
- Bunny Volume costs about EUR 4.3/TB, so **one box breaks even at about 27 TB/month**. Against Bunny Standard EU (EUR 8.6/TB) it breaks even at about 13 TB.
- Add ops time (about 0.1 FTE, say EUR 600/month **(est.)**) and own edge wins above about 150-300 TB/month. That is from tier 2
  upward, and by 10x at tiers 3-4.
- Bandwidth upgrades are poor value: +1 Gbps on an Advance is EUR 200/month, more than a second box with 3 Gbps (EUR 115).
  Scale out with base boxes; scale up only to cut box count.
- The CDN stays useful as **overflow and failover**. Keep a Bunny pull zone with `origin.media` pointing at 2 edges, weighted 0 in DNS
  and raised during incidents, DC outages, or for non-EU traffic.

## 5. Hidden costs and load we don't carry

- **Previews are a hidden cost.** 3 MB per visit is 6 % of bytes: 0.9 TB/month at 10k, 91 TB at 1M, 912 TB at 10M (≈ $4.5k/month if it ran
  through Bunny). A bouncing visitor who hovers 20 cards and plays nothing costs 6 MB for zero watch time. Mitigations:
  - start fetching only after 500 ms of hover (current spec);
  - no autoplay previews on touch devices;
  - `preload="none"`;
  - drop to about 150 KB (lower bitrate, 4 s);
  - mark previews `immutable` so repeat hovers cost nothing.
- **Read-ahead waste (15 %).** Capping the hls.js buffer at 20 s cuts about 2.4 MB per visit, but risks rebuffering on mobile. Tune it from QoE data.
- **Ad tech.** VAST/VMAP requests go from the player (IMA SDK or similar) straight to the ad server. Ad creatives come from the ad
  network's CDN. Our only cost is the ad-slot HTML. Ad scripts weigh on the *client* (page weight, CPU), and the CMP is mandatory (§6).
- **Bots and scrapers** can eat bandwidth. Defenses:
  - per-IP `limit_conn` and `limit_req` on the edge;
  - expiring `secure_link` tokens on playlists from tier 3, which blocks hotlinking (segments stay token-free and cacheable);
  - Turnstile on write forms;
  - per-user Redis token buckets for comments (e.g. 5/min) and votes;
  - view dedup by visitor hash, so bots cannot inflate counters.

## 6. Legal / ops items that grow with scale

| Item | When | What |
|---|---|---|
| AI labels | Now | the content label on every video (`content_label`, e.g. "Vidéo générée par IA") (SREN art. 226-8). EU AI Act art. 50 deepfake disclosure has applied since 2 Aug 2026 (check Digital Omnibus changes). Also keep the label in metadata (C2PA where possible) |
| DSA notice-and-action (art. 16) + statement of reasons (art. 17) | Before going public | "Signaler" button on every video and comment. Notices tracked with timestamps. Reasoned decision sent to the uploader/commenter. Point of contact for authorities and users (art. 11-12) |
| Moderation queue | Tier 2+ | Automated pre-filter (keyword + classifier) → pending queue → human review. At 10M daily users ≈ 50k comments/day **(est.)**, so plan 2-4 moderators or a vendor |
| DSA platform duties (art. 20-28: complaints, transparency DB, ads repository) | When we exceed small enterprise (≥ 50 staff or > EUR 10M turnover) | Micro/small enterprises are exempt from most art. 19+ duties |
| VLOP threshold | Tier 4 | 45M monthly active EU recipients. 10M daily users can mean 30-60M MAU **(est.)**. Measure MAU per DSA art. 24(2) every 6 months |
| Abuse contact | Tier 1 | abuse@ / legal@ addresses, LCEN legal notice (mentions légales), host identity (OVH) |
| Cookie consent CMP | Before real ads | IAB TCF v2.2 CMP certified by Google (for Ad Manager/AdSense in the EEA). CNIL rules: "Refuser" as easy as "Accepter", no cookie wall. Audience measurement exempt only if configured per CNIL |
| Copyright | Tier 2+ | Notice handling for rights holders, repeat-infringer policy. Article 17 DSM directive (France: ARCOM) once user uploads open |
| Minors / adult content | If user uploads open | Policy + reporting. Age verification only if the content requires it |
| Data | Tier 2+ | GDPR register, DPA with OVH/Bunny/CMP, log retention (LCEN: 1 year for connection data where applicable) |

## 7. Migration checklist

### Tier 1 → 2 (10k → 100k)
1. Buy a real domain. Set `deploy.domain` (LE certificate via `./tube deploy`) and `"private": false` (removes basic auth, makes robots.txt public). Legal pages and CMP go live first.
2. Edge: order 2x Advance-1 (GRA, RBX). Ansible role: nginx + kTLS + immutable headers + CORS + `s5cmd sync s3://<prefix>media-*/media/ /srv/media/`
   (systemd timer + publish webhook). DNS `media.<domain>` → both IPs.
3. Set `"media_base": "https://media.<domain>"` in site.config.json and `./tube deploy`. No code change (the media contract). Verify playback, then stop serving `/media` from the app box.
4. Keep `ingest.versioned_paths` on (the default): media live at `<id>/<v>/...`, so a re-encode never collides with year-long edge caches.
5. Database: create managed PG Production b3-8 (GRA, private network). Cutover: `pg_dump -Fc` → `pg_restore` in a 5-min read-only window
   (or logical replication). Set `DATABASE_URL=postgres://...:20184/...?sslmode=require` in `/srv/<slug>/secrets/.env`. Remove the postgres service from compose.
6. Redis: run a Valkey container and set `REDIS_URL`. Move view counting to INCR + PFADD + 10 s flush, and sessions/rate limits to Redis.
7. App: a 2nd b3-8 + Octavia LB S, health check `/healthz`, LB in front of both. DNS `<domain>` → LB.
8. Observability box (Prometheus/Grafana/Loki). Alerts: 5xx rate, p95 TTFB, edge NIC %, sync age, PG connections/lag.
9. Backups: managed PITR, weekly `pg_dump` to a bucket in SBG, bucket versioning.

### Tier 2 → 3 (100k → 1M)
1. MKS cluster (Standard), node pools `app` (b3-16 x3) and `transcode` (c3, min 0). Images in a registry. Helm chart = the same compose services.
2. PgBouncer deployment in transaction mode; `DATABASE_URL` → PgBouncer. Resize PG to Production b3-16. Add `DATABASE_URL_RO` for heavy reads.
3. Managed Valkey: set `REDIS_URL` to the managed endpoint and drop the container.
4. Edge to 6 boxes (add SBG + 2 more). Move `media.<domain>` to Bunny DNS smart records + monitors. Create the Bunny Volume pull zone (weight 0).
5. Edge nginx also fronts HTML with a 2-5 s anonymous microcache, which offloads SSR.
6. Transcode queue + K8s Jobs; upload/ingest API if user uploads open.
7. Moderation queue + DSA notice workflow; Turnstile; per-user rate limits; `secure_link` on playlists.
8. Player QoE beacons → dashboards (startup time, rebuffer ratio, bitrate mix → re-check the 55/30/15 ABR assumption).

### Tier 3 → 4 (1M → 10M)
1. App + DB to EU-WEST-PAR 3-AZ: MKS Standard multi-AZ, PG Advanced b3-32 (3 nodes + replica). Migrate with a replica-promote cutover.
2. Edge fleet to about 48x Advance-1 over 6 DCs (or 7x Scale-a1 @25G). Fully automated provisioning: order via API → cloud-init → Ansible → join DNS pool after a health check.
3. Bunny Volume as active overflow: DNS weight driven by edge NIC utilisation, with a hard failover per DC.
4. Warm DR in GRA: PG cross-region replica (verify managed support, otherwise logical replication to a self-managed standby), app manifests ready, runbook-tested failover.
5. View/QoE events → ClickHouse. Postgres keeps aggregates only.
6. Second Valkey cluster (split sessions/rate limits from counters/caches).
7. GitOps (Argo CD), on-call rota, SLOs (99.9 % playback start < 2 s).
8. Legal: DSA MAU measurement and VLOP watch, transparency reports, moderation staffing, ad repository if the size thresholds are crossed.

## 8. What we measured vs what is extrapolated

**Measured 2026-10-30** (box `<prefix>web-1`, d2-4 in SBG5, 2 vCPU / 4 GB / 250 Mbps, nginx + Fastify + Postgres in docker compose,
HTTPS, private mode; load from a d2-8 in the same region running k6 "playback" visits: home, 2-3 full hover previews,
video page, master + 480p playlist, 15 segments paced at 4 s like a real player, view/vote API calls):

| Concurrent viewers | p50 / p95 latency | Throughput | Errors | Web box CPU |
|---|---|---|---|---|
| 100 | 2.6 / 12.8 ms | 68 req/s, 48 Mbps | 0 % | - |
| 300 | 3.1 / 20.5 ms | 201 req/s, 141 Mbps | 0.11 % | - |
| 600 | 121 / 872 ms | 340 req/s, 234 Mbps | 1.29 % (mostly nginx per-IP 429s: all load came from 1 IP) | avg 30 %, max 60 % (steal up to 23 %) |

- The d2-4 is **NIC-bound, not CPU-bound**: it saturates at ~234-270 Mbps of its 250 Mbps guarantee with CPU to spare.
  App container ~2 % CPU, Postgres < 30 %, RAM 0.7 / 3.8 GB: the 30 s nginx page cache absorbs SSR.
- Rule of thumb from the §0 traffic model (0.10 Gbps peak per 10k daily users): **one d2-4 ~ 20k daily users** at 80 % of
  its NIC. Beyond that, either move media to an edge (MEDIA_BASE) or a bigger NIC (b3-16 = 1 Gbps ~ 80k/day, b3-32 = 2 Gbps).
- First run (same test) was 13x worse: **bcrypt basic auth** is verified by nginx on every request (each HLS segment),
  which pinned both vCPUs at ~30 Mbps. Switched to `{SHA}` with a 16-char random password. Lesson: never put a slow
  password hash in front of segment traffic; in public mode there is no auth at all.
- Pipeline (a 12-thread desktop, `--jobs 2`): 13 sources, 820 s of 1080x1920 30 fps content -> 4-rung HLS + poster + preview
  in 141 s wall = **~5.8x real time**. A 1,000 x 5 min library (300,000 s) ~ 14 h on such a desktop, or a few hours on 2-3 c3 boxes.
- Real bitrates of the measured (animated, flat-colour) content are far below the caps: e.g. 720p average 0.64 Mbps vs 2.5 Mbps
  maxrate; previews 38-102 KB (budget 400 KB). Camera footage will sit much closer to the caps, so §1 stays the planning number.

**Extrapolated** (not measured): everything in §1 (visit model, 2.2x peak factor, ABR mix), §4 costs (list prices),
the Zipf hot-set share, write rates at 1M+, edge-box throughput on bare metal, multi-box behaviour, real-device players
(only headless Chromium was tested; Safari/iOS native HLS untested).

## 9. Sources (all retrieved 2026-10-30)

| What | Source |
|---|---|
| OVH Public Cloud prices (d2/b3/c3 hourly, instance egress EUR 0, object storage EUR 0.007/GB-month and egress EUR 0, Octavia LB S/M/L/XL EUR 6/15/40/150 per month, MKS Standard EUR 0.09/h, managed PostgreSQL and Valkey per-node hourly, block volume EUR 0.042/GB-month, L4-90 EUR 0.75/h) | OVH public catalog API `https://eu.api.ovh.com/v1/order/catalog/public/cloud?ovhSubsidiary=FR` |
| OVH bare metal (Advance-1 EUR 114.99 with 3 Gbps unmetered guaranteed, 4/5 Gbps +EUR 200/+250; Advance-2 EUR 154.99; Scale-a1 EUR 599.99 with 5 Gbps, 10/15/20/25 Gbps +EUR 500/750/1,000/1,250; HGR-HCI-i1 EUR 1,344.99 with 10 Gbps, up to 25 Gbps +EUR 1,250; setup fee = 1 month; DCs fra, gra, lon, rbx, sbg, waw, bhs) | `https://eu.api.ovh.com/v1/order/catalog/public/baremetalServers?ovhSubsidiary=FR`, https://www.ovhcloud.com/en-ie/bare-metal/advance/ |
| Managed PostgreSQL plans (Discovery 1 node, Production 2 nodes, Advanced 3 nodes + replica; prices per node; 48 h / 14 d / 30 d backups) | https://www.ovhcloud.com/en-ie/public-cloud/postgresql/ |
| Octavia LB throughput (S 200 Mbps … XL 4 Gbps) | https://www.ovhcloud.com/en-ie/public-cloud/load-balancer/ |
| Anti-DDoS included on every product, unmetered | https://www.ovhcloud.com/en-ie/security/anti-ddos/ |
| BYOIP single region, no anycast | https://docs.ovhcloud.com/en/guides/network/bring-your-own-ip/bring-your-own-ip.md |
| Bunny CDN (Standard EU $0.01/GB; Volume $0.005/0.004/0.002) | https://bunny.net/pricing/cdn/ |
| Bunny Stream | https://bunny.net/pricing/stream/ |
| Bunny DNS (smart queries free) | https://bunny.net/pricing/dns/ |
| Cloudflare CDN video clause | https://www.cloudflare.com/service-specific-terms-application-services/ |
| Cloudflare Stream ($5 per 1k min stored, $1 per 1k min delivered) | https://developers.cloudflare.com/stream/pricing/ |
| CloudFront EU tiers ($0.085 … $0.020/GB) | https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/ |
| Fastly EU ($0.12/GB to 10 TB, $0.08 next 10 TB) | https://www.fastly.com/pricing |
