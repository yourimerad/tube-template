#!/bin/sh
# Render nginx config from the environment, then exec nginx.
#  - /etc/letsencrypt/live/$SITE_HOST/fullchain.pem exists -> HTTPS on 443, port 80 redirects
#    (except /.well-known/acme-challenge/); otherwise HTTP-only on 80 (+ ACME webroot).
#  - PRIVATE=1 (default, fail closed) -> basic auth with /etc/nginx/htpasswd + X-Robots-Tag on files.
#    Use a {SHA} htpasswd entry with a long random password, never bcrypt: nginx checks it on EVERY
#    request (each HLS segment) and bcrypt pins a small box's CPU (docs/LESSONS.md).
#  - AUTH_REALM: basic-auth realm text (ASCII).
set -eu
T=/etc/nginx/site
SITE_HOST=${SITE_HOST:-localhost}
AUTH_REALM=$(printf '%s' "${AUTH_REALM:-Private}" | tr -cd 'A-Za-z0-9 ._-' | cut -c1-60)
PRIVATE=${PRIVATE:-1}
CERT_DIR=/etc/letsencrypt/live/$SITE_HOST

case "$SITE_HOST" in *[!A-Za-z0-9.-]*|'') echo "site-entrypoint: invalid SITE_HOST" >&2; exit 1;; esac

if [ "$PRIVATE" = "0" ]; then
    echo "auth_basic off;" > $T/auth.conf
    : > $T/robots.conf
else
    if [ ! -f /etc/nginx/htpasswd ] || [ ! -s /etc/nginx/htpasswd ]; then
        echo "site-entrypoint: PRIVATE=$PRIVATE but /etc/nginx/htpasswd is missing or empty; refusing to start" >&2
        exit 1
    fi
    printf 'auth_basic "%s";\nauth_basic_user_file /etc/nginx/htpasswd;\n' "${AUTH_REALM:-Private}" > $T/auth.conf
    echo 'add_header X-Robots-Tag "noindex, nofollow" always;' > $T/robots.conf
fi


if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "site-entrypoint: certificate found for $SITE_HOST -> HTTPS"
    cat > /etc/nginx/conf.d/default.conf <<CONF
server {
    listen 80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; default_type text/plain; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl default_server;
    http2 on;
    server_name $SITE_HOST;
    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1h;
    include $T/site.conf;
}
CONF
else
    echo "site-entrypoint: no certificate for $SITE_HOST -> HTTP only"
    cat > /etc/nginx/conf.d/default.conf <<CONF
server {
    listen 80 default_server;
    server_name _;
    include $T/site.conf;
}
CONF
fi

nginx -t
exec "$@"
