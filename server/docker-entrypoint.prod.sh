#!/bin/sh
set -e

# No migration files yet, so the schema is pushed on boot exactly like it is in
# development. Fine while the only data is a seeded demo family — swap this for
# `prisma migrate deploy` before anything irreplaceable lives here.
echo "→ syncing schema"
npx prisma db push --skip-generate --accept-data-loss

echo "→ seeding (skips if data exists)"
npm run --silent seed

echo "→ starting API"
exec npm run --silent start
