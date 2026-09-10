# Keepsake — v0 prototype

A working slice of Keepsake: a React Native app and an API, wired together and
runnable with one command. **No authentication and no AI in this build** — it
exists to make the product architecture tangible enough to argue with.

```bash
docker compose up --build
```

Then open **http://localhost:8081**. The database seeds itself on first boot
with one demo family (the Bryners — two parents, two kids, two grandparents,
24 memories across 36 collections), so there's something real to browse
immediately.

| Service | URL | What it is |
| --- | --- | --- |
| App | http://localhost:8081 | Expo dev server — React Native running on the web |
| API | http://localhost:4000/api/health | Express + Prisma |
| Postgres | `localhost:55432` | user / password / db all `keepsake` |

## What's here

All six primary destinations from the packet:

- **Home** — greeting, Your People, Today's Moment to Capture, Your Story So Far, Family Updates
- **Capture** — camera / import / write / record, all landing on one compose screen that writes a real memory
- **Library** — three Story Pillars → child selector → collections → memories, with the default collection sets pre-loaded per child
- **Mosaic** — the archive laid out by palette rather than date, in a masonry grid
- **Search** — one query across memories, transcripts, people, places, and collections. Memories are ranked with real Postgres full-text search — a generated, GIN-indexed `tsvector` column, not `ILIKE` scans; see `server/prisma/migrations/*_memory_search_vector/`.
- **Family Hub** — modal: members, permissions, invites, settings

Plus the immersive memory page: hero image, Story/Transcript toggle, original
media, who was there, and inline editing of the narrative.

## What's deliberately missing

These are stubbed and labelled in the UI rather than faked:

- **Auth** — the API is wide open and serves a single seeded family. Every route would hang off a session.
- **AI** — no narratives, transcription, tagging, or generated prompts. `Memory.transcript` and the prompt table already exist, so the AI phase fills fields rather than reshaping the schema.
- **Audio capture** — recording and playback need real files; the written form stands in, and typed transcripts land in the field transcription will eventually populate.
- **Sharing** — web links, printable stories, and highlight reels all need permissions before anything can leave the archive.
- **Real photographs** — every seeded image is a gradient generated from a string seed ([server/src/lib/placeholder.ts](server/src/lib/placeholder.ts)), so the app looks alive offline and nothing binary lives in git. Photos you upload yourself are real and land on a Docker volume.

## Running on a phone

The web build is the fastest way to look at it, but this is React Native — it
runs natively too:

```bash
cd app && npx expo start   # then scan the QR code with Expo Go
```

The app derives the API host from Metro's LAN address, so a device on the same
Wi-Fi finds the API without configuration. Override with `EXPO_PUBLIC_API_URL`
if that guess is wrong.

The API's CORS policy is an allowlist read from `CORS_ORIGINS` (comma-separated
origins, e.g. `http://localhost:8081,https://keepsake.example`). It is
deliberately unset in `docker-compose.yml`: outside production an empty
`CORS_ORIGINS` allows every origin, which is what lets a phone on an
unpredictable LAN address reach the API. In production an empty `CORS_ORIGINS`
means same-origin only — no `Access-Control-Allow-Origin` header at all — which
is correct for the hosted build, where the web bundle is served by the API
itself.

## Layout

```
app/                     Expo + expo-router
  app/(tabs)/              the four primary destinations
  app/memory/[id].tsx      the immersive memory page
  src/api.ts               API client + response types
  src/theme.ts             brand palette, type scale, spacing
  src/components/brand.tsx logo lockups + the six whimsical shapes
  src/components/brand-artwork.ts   generated — see design/
server/                  Express + Prisma
  prisma/schema.prisma     Family, Person, Memory, Media, Collection, ActivityEvent
  src/seed.ts              the demo family
design/
  extract_logo.py          traces the logo out of the brand guide PNG
docker-compose.yml
```

### Data model

`Family` is the tenancy boundary — every content row hangs off one and every
query filters by `familyId`. The tables beyond the v0 six are in place ahead of
the code that fills them, so the shape stops moving while the features land:
`User`, `FamilyMembership` (OWNER / CONTRIBUTOR / VIEWER) and `Person.userId`
carry sign-in and family scoping (A3), `Invite` carries the join flow (A4).
`Media.storageKey` / `mimeType` / `bytes` / `sha256` / `status` describe an
object in a storage provider rather than a path on disk, and `Derivative` holds
the thumbnails, display renditions, posters and waveforms generated from it
(A5, A6). `Job` is the durable work queue those derivatives run through (A6),
and `Memory.palette` / `analysisStatus` / `storySource` are what the analysis
and AI passes write back (A6, A13). `DeviceToken` and `Subscription` are for
push and billing in Track B (B7, B9). Soft deletes (`deletedAt` on `Memory` and
`Media`) exist because an original is never destroyed.

The logotype is a custom drawing, so it isn't any font and can't be rebuilt from
one. `design/extract_logo.py` traces it straight out of the brand sheet into
`brand-artwork.ts`, splitting ink from accent by colour, and the app draws those
paths — no font, identical on every platform. Re-run it if the guide is reissued.

## Common tasks

```bash
docker compose logs -f api                            # API logs
docker compose exec api npx prisma studio             # browse the data
docker compose exec -e SEED_RESET=1 api npm run seed  # rebuild the demo family
docker compose down -v                                # wipe database + uploads
```

```bash
cd server && npm run db:migrate    # edit schema.prisma, then create + apply a migration
cd server && npm run db:deploy     # apply pending migrations without creating one (what containers do on boot)
```

Development runs the server straight off TypeScript with `tsx watch`. The
production image doesn't: `npm run build` in `server/` runs `prisma generate`
and compiles `src/` to ESM in `server/dist/` (with source maps), and
`npm start` runs `node dist/index.js`. The root `Dockerfile` builds that way,
so the hosted image starts compiled JavaScript.

```bash
cd server && npm run build && npm start   # compiled, as production runs it
```

`node_modules` lives in an anonymous volume that shadows the image's copy, so a
new dependency needs the volume thrown away as well as a rebuild — otherwise
Metro reports it as unresolvable:

```bash
docker compose up -d --build --renew-anon-volumes web
```

Schema changes are tracked as real migrations under `server/prisma/migrations/`.
After editing `schema.prisma`, run `npm run db:migrate` (inside `server/`) to
generate and apply a new migration, then commit the generated folder.
Containers apply whatever is checked in via `prisma migrate deploy` on boot —
no more `prisma db push`.

A database that predates the migrations (created by `db push`) already has the
tables but no migration history, so `migrate deploy` will refuse to run. Either
wipe it (`docker compose down -v`) or mark the baseline as applied:

```bash
docker compose exec api npx prisma migrate resolve --applied 20260910042628_init
```
