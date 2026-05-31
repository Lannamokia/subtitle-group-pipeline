# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src/frontend/app
COPY frontend/app/package*.json ./
RUN npm ci
COPY frontend/app ./
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM node:22-bookworm-slim AS backend-build
WORKDIR /src/backend
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci
COPY backend ./
RUN node scripts/generate-prisma-client.cjs && npm run build && npm prune --omit=dev

FROM caddy:2 AS caddy-bin

FROM node:22-bookworm-slim AS app
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=caddy-bin /usr/bin/caddy /usr/bin/caddy

WORKDIR /app/backend
COPY --from=backend-build /src/backend ./
COPY --from=frontend-build /src/frontend/app/dist /srv/frontend
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/subtitle-platform-entrypoint

RUN chmod +x /usr/local/bin/subtitle-platform-entrypoint \
  && mkdir -p /app/config /app/uploads /srv/frontend /data /config

ENV NODE_ENV=production \
  PORT=3000 \
  API_PREFIX=/api/v1 \
  UPLOAD_DIR=/app/uploads \
  ENV_FILE_PATH=/app/config/backend.env \
  FRONTEND_API_BASE_URL=/api/v1 \
  CADDY_SITE_ADDRESS=:80

EXPOSE 80 443
VOLUME ["/app/config", "/app/uploads", "/data", "/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["subtitle-platform-entrypoint"]
