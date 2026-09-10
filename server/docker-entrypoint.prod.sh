#!/bin/sh
set -e

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
# exec straight into node so SIGTERM reaches the process that handles it.
exec node dist/index.js
