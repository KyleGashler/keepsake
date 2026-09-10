#!/bin/sh
set -e

echo "→ applying migrations"
npx prisma migrate deploy

if [ "$SEED_DEMO" = "1" ]; then
  echo "→ seeding (skips if data exists)"
  npm run --silent seed
fi

echo "→ starting API"
# exec straight into node so SIGTERM reaches the process that handles it.
exec node dist/index.js
