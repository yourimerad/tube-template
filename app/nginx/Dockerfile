FROM nginx:1.30.6-alpine
# Our entrypoint renders the config (HTTPS if a cert exists, else HTTP-only) then execs nginx.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf
COPY site.conf proxy.conf /etc/nginx/site/
COPY site-entrypoint.sh /usr/local/bin/site-entrypoint.sh
RUN chmod 755 /usr/local/bin/site-entrypoint.sh && mkdir -p /var/cache/nginx/pages /var/www/certbot
ENTRYPOINT ["/usr/local/bin/site-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
