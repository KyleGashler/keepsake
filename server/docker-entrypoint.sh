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

echo "→ applying migrations"
# A database that predates the migrations (built with `prisma db push`) has the
# tables but no history, and `migrate deploy` refuses it with P3005. The first
# migration is a faithful snapshot of that schema, so marking it applied is the
# documented Prisma baseline step; everything after it then applies normally.
if ! out=$(npx prisma migrate deploy 2>&1); then
  echo "$out"
  if echo "$out" | grep -q "P3005"; then
    echo "→ pre-migration database detected; baselining 20260910042628_init"
    npx prisma migrate resolve --applied 20260910042628_init
    npx prisma migrate deploy
  else
    exit 1
  fi
else
  echo "$out"
fi

if [ "$SEED_DEMO" = "1" ]; then
  echo "→ seeding (skips if data exists)"
  npm run --silent seed
fi

echo "→ starting API"
exec npm run --silent dev
