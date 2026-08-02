FROM node:22-alpine

# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npx prisma generate

ENV PORT=4000
ENV MEDIA_DIR=/app/media
EXPOSE 4000

CMD ["sh", "./docker-entrypoint.sh"]
