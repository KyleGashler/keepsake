# Keepsake — v0 prototype

A working slice of Keepsake: a React Native app and an API, wired together and
runnable with one command. **Dev-mode identity and no AI in this build** — a
bearer token is taken at face value (see [Auth](#auth)) and nothing is
generated. It exists to make the product architecture tangible enough to argue
with.

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

- **Auth** — the request context, family scoping and roles are real; the *verification* isn't. A `dev:<email>` token is believed without proof. See [Auth](#auth).
- **AI** — no narratives, tagging, or generated prompts yet. Transcription is real (Deepgram, or a stub without a key) — see [Background jobs and transcription](#background-jobs-and-transcription).
- **Audio capture** — recording and playback need real files; the written form stands in, and typed transcripts land in the field transcription will eventually populate.
- **Sharing** — web links, printable stories, and highlight reels all need permissions before anything can leave the archive.
- **Real photographs** — every seeded image is a gradient generated from a string seed ([server/src/lib/placeholder.ts](server/src/lib/placeholder.ts)), so the app looks alive offline and nothing binary lives in git. Photos you upload yourself are real and land on a Docker volume.

## Auth

Every `/api` route except `/api/health` needs a signed-in user, and every query
is scoped to one family. What's missing is the part that checks a credential is
genuine — that's a `TokenVerifier`, and the only implementation so far is the
development one.

```
Authorization: Bearer dev:ali@example.com
```

`DevTokenVerifier` believes that token: it signs you in as `ali@example.com`,
creating the `User` row on first sight. There is no password and no signature.
It is active only when `AUTH_MODE=dev` (the default outside production).

| Variable | Meaning |
| --- | --- |
| `AUTH_MODE` | `dev` is the only implemented mode. `firebase` arrives with B1. |
| `DEV_DEFAULT_USER` | An email. In dev mode, a request with **no** `Authorization` header is treated as that user. |
| `ALLOW_DEV_AUTH_IN_PROD` | `1` lets `AUTH_MODE=dev` run under `NODE_ENV=production`. Without it the server refuses to boot, which is the point. |

`DEV_DEFAULT_USER` is set to `demo@keepsake.local` (the seeded OWNER of the
demo family) in `docker-compose.yml` and `fly.toml`. That's a stopgap: the app
doesn't send a token yet, and won't until A8 gives it a sign-in screen. Unset
the variable and the API behaves like production — no token, no access.

A user in several families must say which one they mean:

```
x-family-id: <family id>
```

Without the header, a single membership is used and several are a
`400 family_required` listing them. A family you don't belong to is a `403`,
and a row belonging to another family is a `404` — an id never confirms itself.

```bash
API=http://localhost:4000
TOKEN='Bearer dev:demo@keepsake.local'

curl -s $API/api/me -H "Authorization: $TOKEN"          # user + memberships
curl -s $API/api/home -H "Authorization: $TOKEN"
curl -s $API/api/memories -H "Authorization: $TOKEN" -H 'x-family-id: <id>'
curl -s -X POST $API/api/families -H "Authorization: $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"The Reyes"}'
```

`POST /api/families` and `GET /api/me` are the only routes reachable before you
belong to an archive; creating one makes you its OWNER and gives you a `Person`
row inside it.

**Production needs a real verifier.** `createTokenVerifier()` throws at boot
rather than serve dev auth under `NODE_ENV=production`, unless
`ALLOW_DEV_AUTH_IN_PROD=1` is set — which the hosted demo does today, and logs
loudly about, until the Firebase verifier (B1) replaces it.

Media bytes are reachable without a bearer token because the client loads them
as plain `<img>` URLs: `/media/gen/*` placeholders are public, and uploaded
originals are served through signed URLs with a one-hour expiry — see
[Storage](#storage).

## Storage

Uploads go through a two-phase handshake — `POST /api/media/init` authorises a
target, the client `PUT`s the bytes straight to it, `POST /api/media/finalize`
sniffs the real type and records size and SHA-256 — so the same client code
works against a local volume and a presigned S3 URL
([server/src/storage/](server/src/storage/)). Originals of every type, video
included, are stored as uploaded and capped at 100 MB (`GET /api/media/limits`;
the capture screen says so before uploading). No transcoding, multipart or CDN
yet — see "Decision: video, for now" in [docs/PLAN.md](docs/PLAN.md).

| Variable | Meaning |
| --- | --- |
| `STORAGE_PROVIDER` | `local` (default): originals on `MEDIA_DIR/objects`, upload and read URLs are `/media/local-upload/<token>` and `/media/o/<token>` on this API. `s3`: originals in a bucket, URLs are presigned S3 URLs. |
| `MEDIA_DIR` | Local provider's root. Also where pre-A5 `/media/uploads/*` files live, which are served from it whichever provider is active. |
| `MEDIA_SIGNING_SECRET` | Local provider only: HMAC key for its upload/read tokens. Set it anywhere the API is reachable from outside your machine. |
| `S3_BUCKET` | Required with `s3` — the server refuses to boot without it. |
| `S3_REGION` | Required with `s3` (falls back to `AWS_REGION`). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Read by the AWS SDK's default credential chain. |
| `S3_ENDPOINT` | Emulators only: where the API reaches the S3 API (e.g. `http://s3:9000` in compose). Unset for AWS. |
| `S3_PUBLIC_ENDPOINT` | Emulators only: the host a *client* uses, when it differs from `S3_ENDPOINT`. Presigned URLs are signed for this host. |
| `S3_FORCE_PATH_STYLE` | `1` for emulators (`endpoint/bucket/key` addressing). |

With `s3`, a presigned PUT has `Content-Type`, `Content-Length` and
`If-None-Match: *` inside its signature: a client can't upload a different type
or size than init authorised, and can't overwrite a key that already holds an
object — replaying the URL after finalize gets `412` from the bucket, the
equivalent of the local provider's `409`. Finalize also refuses (`409`) a key
that has more than one version. `/api/health` reports `media: false` when the
bucket doesn't answer `HeadBucket` (or, locally, when `MEDIA_DIR/objects` isn't
writable).

### Running against the S3 emulator

Compose ships an S3-compatible emulator ([RustFS](https://github.com/rustfs/rustfs)),
behind the `s3` profile so the default stack doesn't start it. It validates
SigV4 presigned URLs, conditional writes, versioning and bucket CORS, so it
rejects the same uploads AWS would. `s3-init` creates the `keepsake-dev`
bucket, turns versioning on and allows `http://localhost:8081` (CORS).

```bash
STORAGE_PROVIDER=s3 docker compose --profile s3 up --build   # API on the emulator
docker compose up                                            # back to the volume
```

The emulator's S3 API is on `localhost:9300` (user `keepsake`, password
`keepsake-dev-secret`). Presigned URLs point there, so uploads from a phone on
your LAN won't reach it; use the web build, or set `S3_PUBLIC_ENDPOINT` to your
machine's LAN address. Outside compose, run the API with the same variables
(`S3_ENDPOINT=http://localhost:9300`, no `S3_PUBLIC_ENDPOINT`) and create the
bucket with `npm run storage:s3-setup` in `server/` — it refuses to run without
`S3_ENDPOINT`, so it can't touch AWS.

The AWS SDK is a new dependency, so an existing stack needs its
`node_modules` volume renewed: `docker compose up -d --build --renew-anon-volumes api`.

### Cutover to AWS

The policies are in [docs/aws/](docs/aws/); replace `REPLACE_WITH_BUCKET` in
each. `us-west-1` is the region nearest Fly's `sjc`.

1. **Bucket** — private, versioned, no lifecycle rules (nothing ever expires an
   original):
   ```bash
   B=keepsake-originals-<suffix>; R=us-west-1
   aws s3api create-bucket --bucket $B --region $R --create-bucket-configuration LocationConstraint=$R
   aws s3api put-public-access-block --bucket $B --public-access-block-configuration \
     BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled
   aws s3api put-bucket-cors --bucket $B --cors-configuration file://docs/aws/cors.json
   aws s3api put-bucket-policy --bucket $B --policy file://docs/aws/bucket-policy.json
   ```
   `cors.json` lists the app's origins (the Fly host and local Metro) — add any
   other web origin. `bucket-policy.json` denies any PUT to an `original.*` key
   that isn't create-only (`If-None-Match: *`) and any non-TLS request.
2. **IAM user** for the API — get/put/list on this bucket only, delete only for
   non-originals ([docs/aws/iam-policy.json](docs/aws/iam-policy.json)):
   ```bash
   aws iam create-user --user-name keepsake-api
   aws iam put-user-policy --user-name keepsake-api --policy-name keepsake-media \
     --policy-document file://docs/aws/iam-policy.json
   aws iam create-access-key --user-name keepsake-api
   ```
3. **Secrets** — `fly secrets set AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…`
   (this redeploys; the app is still on `local`).
4. **Copy what's on the volume**, dry run first. It uploads each object under
   `MEDIA_DIR/objects` to the same key if absent, with the type from `Media.mimeType`,
   and is safe to re-run:
   ```bash
   fly ssh console -C "sh -c 'cd /app && S3_BUCKET=$B S3_REGION=$R node dist/scripts/copy-local-to-s3.js --dry-run'"
   fly ssh console -C "sh -c 'cd /app && S3_BUCKET=$B S3_REGION=$R node dist/scripts/copy-local-to-s3.js'"
   ```
   (Locally: `npm run storage:copy-to-s3 -- --dry-run` in `server/`.) Pre-A5
   files under `MEDIA_DIR/uploads` are counted and left alone — they're served
   from the volume regardless of provider, so keep the Fly mount.
5. **Flip it** — in `fly.toml` `[env]`: `STORAGE_PROVIDER = "s3"`,
   `S3_BUCKET = "<bucket>"`, `S3_REGION = "us-west-1"`; `fly deploy`.
6. **Run the copy again** — picks up anything uploaded between steps 4 and 5;
   everything else reports "already present". Then check `/api/health` shows
   `"media": true` and upload a photo and a video from the web app.

## Background jobs and transcription

Slow work runs through the `Job` table
([server/src/jobs/](server/src/jobs/)): a route enqueues a row, a worker claims
it with `FOR UPDATE SKIP LOCKED`, and a handler that throws is retried with
exponential backoff until `maxAttempts`, then marked `FAILED`. A job left
`RUNNING` by a worker that died is reclaimed once its lock is 10 minutes old.
The worker runs inside the API when `WORKER_INLINE=1` (compose and Fly set it),
or on its own with `npm run worker` (`npm run worker:dev` off TypeScript).

The one job today is `ai.transcribe`. Creating a memory with uploaded AUDIO or
VIDEO sets each clip's `transcriptStatus` to `PENDING` and queues a job per
clip; the job writes `Media.transcript`, fills `durationS` if the client didn't,
and fills `Memory.transcript` from the clips in order — but only while it is
empty or still exactly what the job wrote. Once a person edits it, it's theirs.
A clip that fails is `FAILED`; `POST /api/memories/:id/media/:mediaId/transcribe`
queues it again. With S3 storage Deepgram fetches the original from a presigned
URL; with local storage the API streams the bytes to Deepgram.

| Variable | Meaning |
| --- | --- |
| `WORKER_INLINE` | `1` runs the job worker in the API process. Unset, jobs wait for `npm run worker`. |
| `DEEPGRAM_API_KEY` | Deepgram key for speech-to-text. Unset in development, a stub transcriber returns a fixed two-speaker sample after ~1.5 s; unset in production, clips are marked FAILED (retry from the memory page once the key is set). On Fly: `fly secrets set DEEPGRAM_API_KEY=…`. |
| `DEEPGRAM_MODEL` | Optional; defaults to `nova-3`. |

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
`User` and `FamilyMembership` (OWNER / CONTRIBUTOR / VIEWER) carry sign-in and
family scoping and are live — `FamilyMembership.personId` is the canonical link
between a login and the person they are inside one family, and the older
`Person.userId` (globally unique, so one Person per login) survives only until
a later migration drops it. `Invite` carries the join flow (A4).
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
