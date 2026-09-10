#!/bin/sh
set -e

echo "→ applying migrations"
npx prisma migrate deploy

if [ "$SEED_DEMO" = "1" ]; then
  echo "→ seeding (skips if data exists)"
  npm run --silent seed
fi

echo "→ starting API"
exec npm run --silent start
