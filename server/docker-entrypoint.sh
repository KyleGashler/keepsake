#!/bin/sh
set -e

echo "→ waiting for postgres..."
until node -e "
const net = require('net');
const url = new URL(process.env.DATABASE_URL);
const s = net.connect(Number(url.port || 5432), url.hostname);
s.on('connect', () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
" 2>/dev/null; do
  sleep 1
done

# The bind mount hides the image's node_modules, so regenerate against whatever
# schema is on disk right now.
echo "→ prisma generate"
npx prisma generate >/dev/null

echo "→ syncing schema"
npx prisma db push --skip-generate --accept-data-loss

echo "→ seeding (skips if data exists)"
npm run --silent seed

echo "→ starting API"
exec npm run --silent dev
