# Lessons learned

Things that cost time on the first site built with this stack. The template already handles each of them; this
file says why the code looks the way it does.

## bcrypt basic auth pinned the CPU

nginx verifies basic auth on **every** request, and a video session is mostly HLS segment requests (one every 4 s
per viewer). With a bcrypt htpasswd entry, a 2-vCPU box was CPU-bound at about 30 Mbps, 13x below its NIC. The
template writes `{SHA}` entries for a long random password (24 characters locally, generated once into
`~/.secrets/<slug>-basic-auth` for deploys; `lib/htpasswd.mjs` refuses fewer than 16). A long random password makes
the fast hash safe enough for a private preview; a public site has no basic auth at all.

## Instance creates can land in ERROR: region fallback

Two `d2-4` creates in GRA11 went to `ERROR` in a row (capacity), with no useful message. `./tube up` therefore
walks `deploy.ovh.region` then `deploy.ovh.fallback_regions`: a region without the flavor or image is skipped, an
instance that reaches `ERROR` is deleted (through the prefix guard) and the next region is tried. The region that
worked is remembered in `runs/region` and tried first next time. A park snapshot only exists in its own region, so
other regions start from the plain image (the deploy is idempotent, it just takes longer).

## A create can return 500 and still succeed

The OVH API sometimes answers a POST with a 5xx while the resource is being created anyway. Re-POSTing blindly
makes duplicates (and duplicate costs). The scripts never re-POST a create: after any failure they look the
resource up **by name** and continue with what they find. Snapshots get one extra POST only if the name never
appears.

## Docker creates a directory at a missing bind-mount source

If `docker compose up` runs before a bind-mounted **file** exists (here `secrets/htpasswd`), Docker creates a
directory with that name, and nginx then fails in confusing ways. The scripts write the file before compose runs,
and `./tube dev` replaces such a stray directory by the file.

## Let's Encrypt works with sslip.io

Without a domain, `<a-b-c-d>.sslip.io` resolves to the box IP and Let's Encrypt issues real certificates for it
(rate limits are per registered domain, shared with everyone; use `./tube deploy --staging` while testing). Set
`deploy.domain` once you have a real domain.

## certbot webroot needs the ACME path open without auth

In private mode the whole site is behind basic auth, which also blocks Let's Encrypt's HTTP-01 check. nginx serves
`/.well-known/acme-challenge/` from the certbot webroot **before** the auth block and without auth; nothing else is
exempt (except `/healthz`, a liveness check).

## Smaller ones

- `pkill -f pattern` matches the shell that runs it; use the `[p]attern` trick when scripting.
- OVH snapshots and instances live per region; list across regions when looking for leftovers (`./tube status`).
- Keep secrets off argv: tokens go to curl through `-K <(...)`, S3 keys to rclone through env vars passed by name,
  passwords are read from 600 files.
