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
# Sign-in: Firebase Auth, the production project's web app config. These are
# public identifiers, not secrets — they end up in the bundle either way.
# Override per build with `fly deploy --build-arg EXPO_PUBLIC_FIREBASE_…=…`.
# The project id must match FIREBASE_PROJECT_ID in fly.toml.
ARG EXPO_PUBLIC_AUTH_MODE=firebase
ARG EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyCGBzVJQuH3F_Plq6OYQDW2FVAS2mq4qE0
ARG EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=keepsake-prod-47eda.firebaseapp.com
ARG EXPO_PUBLIC_FIREBASE_PROJECT_ID=keepsake-prod-47eda
ARG EXPO_PUBLIC_FIREBASE_APP_ID=1:1032822992026:web:a595ea1e49895da35c8323
ENV EXPO_PUBLIC_AUTH_MODE=$EXPO_PUBLIC_AUTH_MODE \
    EXPO_PUBLIC_FIREBASE_API_KEY=$EXPO_PUBLIC_FIREBASE_API_KEY \
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=$EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN \
    EXPO_PUBLIC_FIREBASE_PROJECT_ID=$EXPO_PUBLIC_FIREBASE_PROJECT_ID \
    EXPO_PUBLIC_FIREBASE_APP_ID=$EXPO_PUBLIC_FIREBASE_APP_ID
RUN npx expo export --platform web --output-dir dist

# ---- stage 2: the server, with the bundle copied in -----------------------
FROM node:22-alpine

# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY server/ ./
# `build` runs prisma generate and then compiles src/ to dist/ — production
# runs the compiled JS, not tsx.
RUN npm run build

COPY --from=web /build/dist ./web

ENV PORT=4000
ENV WEB_DIR=/app/web
# /data is the Fly volume, so uploads survive redeploys.
ENV MEDIA_DIR=/data/media
ENV NODE_ENV=production

EXPOSE 4000
CMD ["sh", "./docker-entrypoint.prod.sh"]
