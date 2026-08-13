# Production image: the Expo web bundle baked into the API server, so the demo
# is one origin and one URL. Local development still uses docker-compose.yml.

# ---- stage 1: build the web bundle ----------------------------------------
FROM node:22-alpine AS web

WORKDIR /build
COPY app/package.json app/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY app/ ./
ENV EXPO_NO_TELEMETRY=1
# A bare "/" is stripped to "" by resolveBaseUrl(), making every request
# same-origin. The bundle therefore doesn't care what hostname it's served from.
ENV EXPO_PUBLIC_API_URL=/
RUN npx expo export --platform web --output-dir dist

# ---- stage 2: the server, with the bundle copied in -----------------------
FROM node:22-alpine

# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY server/ ./
RUN npx prisma generate

COPY --from=web /build/dist ./web

ENV PORT=4000
ENV WEB_DIR=/app/web
# /data is the Fly volume, so uploads survive redeploys.
ENV MEDIA_DIR=/data/media
ENV NODE_ENV=production

EXPOSE 4000
CMD ["sh", "./docker-entrypoint.prod.sh"]
