# Web app image: Fastify SSR on Node 24 (alpine), production deps only, non-root.
# site.json is generated from site.config.json by `./tube` (dev / deploy) before the build.
FROM node:24.22.2-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
COPY locales ./locales
COPY static ./static
COPY site.json ./site.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
