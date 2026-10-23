# little by little — v0 prototype

A working slice of little by little: a React Native app and an API, wired together and
runnable with one command. **No AI in this build** — nothing is generated.
Locally, sign-in is a development stand-in (an email, no password); the hosted
build uses Firebase Auth (see [Auth](#auth)). It exists to make the product
architecture tangible enough to argue with.

```bash
docker compose up --build
```

Then open **http://localhost:8081** and sign in as `demo@littlebylittle.local` (the
form fills it in). The database seeds itself on first boot with one demo family
(the Bryners — two parents, two kids, two grandparents, 24 memories across 36
collections), so there's something real to browse immediately.

| Service | URL | What it is |
| --- | --- | --- |
| App | http://localhost:8081 | Expo dev server — React Native running on the web |
| API | http://localhost:4000/api/health | Express + Prisma |
| Postgres | `localhost:55432` | user / password / db all `littlebylittle` |

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

- **Roles** — sign-in, family scoping and the OWNER/CONTRIBUTOR/VIEWER memberships are real; what each role may do isn't enforced yet (A4). Locally a `dev:<email>` token is believed without proof. See [Auth](#auth).
- **AI** — no narratives, tagging, or generated prompts yet. Transcripts are real: Mux's generated captions of each clip — see [Video and audio (Mux)](#video-and-audio-mux).
- **Audio capture** — recording and playback need real files; the written form stands in, and typed transcripts land in the field transcription will eventually populate.
- **Sharing** — web links, printable stories, and highlight reels all need permissions before anything can leave the archive.
- **Real photographs** — every seeded image is a gradient generated from a string seed ([server/src/lib/placeholder.ts](server/src/lib/placeholder.ts)), so the app looks alive offline and nothing binary lives in git. Photos you upload yourself are real and land on a Docker volume.

## Auth

Every `/api` route except `/api/health` needs a signed-in user, and every query
is scoped to one family. The API checks the credential with a `TokenVerifier`
([server/src/auth/](server/src/auth/)); the app gets it from an `AuthProvider`
([app/src/auth/](app/src/auth/)). Each side has two, chosen by an environment
variable, and the two sides must agree:

| Mode | API (`AUTH_MODE`) | App (`EXPO_PUBLIC_AUTH_MODE`) | Where |
| --- | --- | --- | --- |
| `dev` (default) | `DevTokenVerifier` believes `Bearer dev:<email>` | `DevAuthProvider`: an email field, no password | compose, Expo Go against a local API |
| `firebase` | `FirebaseTokenVerifier` checks a Firebase ID token | `FirebaseAuthProvider`: email + password via the Firebase JS SDK | Fly |

**Dev mode.** `Bearer dev:ali@example.com` signs you in as `ali@example.com`,
creating the `User` row on first sight. There is no password and no signature,
and every dev identity counts as email-verified. `demo@littlebylittle.local` is the
seeded OWNER of the demo family; any other address starts an account with no
family, and the app offers to create one.

**Firebase mode.** The app signs in with the Firebase JS SDK — the same code on
the web and in Expo Go, no native module — and sends the user's ID token. The
API verifies it with `firebase-admin` initialised with nothing but the project
id: an ID token is checked against Google's public signing keys, so no
service account is needed (one will be for account deletion, A16). A token
without an email is refused. If Google's keys can't be fetched the API answers
`503 auth_unavailable` rather than `401`, so the app doesn't sign anyone out
over an outage. Sign-up sends Firebase's verification email; an unverified
account can use the app, but accepting an invite will require a verified
address (A4 — `req.ctx.emailVerified`, also on `GET /me`).

**One email, one account.** `User.email` is unique. When a new Firebase
identity's email already belongs to a `dev:` user, a *verified* address takes
that user over (its `authProviderId` is rebound, memberships and all — this is
how a real account inherits a family built under dev auth); unverified, the API
answers `403 verify_email` and the app shows a verify-your-email screen. An
email that belongs to another real account is `409 email_in_use`.

| Variable | Meaning |
| --- | --- |
| `AUTH_MODE` | `dev` (default) or `firebase`. |
| `FIREBASE_PROJECT_ID` | Required with `firebase` — the server refuses to boot without it. The project whose ID tokens are accepted. |
| `DEV_DEFAULT_USER` | Dev mode only. A request with **no** `Authorization` header is treated as this email (compose sets `demo@littlebylittle.local`, so a bare `curl` works). |
| `ALLOW_DEV_AUTH_IN_PROD` | `1` lets `AUTH_MODE=dev` run under `NODE_ENV=production`. Without it the server refuses to boot, which is the point. Nothing deployed sets it. |

The app reads these at bundle time (copy [app/.env.example](app/.env.example)
to `app/.env` for local Firebase work; the root `Dockerfile` bakes the
production values into the hosted web build):

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_AUTH_MODE` | `dev` (default) or `firebase`. |
| `EXPO_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | The Firebase web app's config (Project settings → Your apps). Public identifiers, not secrets. Required with `firebase`. |
| `EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR` | Development aid only: e.g. `http://127.0.0.1:9099` points the app at a local Firebase Auth emulator (see [Emailed links](#emailed-links-authaction)). Unset everywhere real. |

There are two Firebase projects, dev and prod: point a local Firebase build at
dev, and keep `FIREBASE_PROJECT_ID` on Fly equal to the project the hosted
bundle was built for.

### Emailed links: `/auth/action`

Firebase's verification, password-reset and email-recovery emails link to
our own page, `/auth/action`, instead of Firebase's unbranded hosted one
(`<project>.firebaseapp.com/__/auth/action`). Firebase appends `mode`,
`oobCode`, `apiKey`, `continueUrl` and `lang`; the page
([app/src/components/auth-action-screen.tsx](app/src/components/auth-action-screen.tsx))
handles each `mode` with the Firebase JS SDK, behind the `AuthProvider`'s
optional `actionCodes`:

- `verifyEmail` — applies the code. If the same person is signed in in this
  browser it reloads them and mints a fresh ID token, so the API sees
  `email_verified` at once (this also completes a dev-account takeover stuck on
  `403 verify_email`). Continue goes into the app, or to sign-in.
- `resetPassword` — shows whose password it is, takes a new one (sign-up's
  rules and messages), sets it, signs them in and goes into the app.
- `recoverEmail` — restores the old address and offers a password reset.
- An expired or used link says so and offers the way back: a new
  verification email if signed in, or a new reset link. A link without a code
  or with an unknown mode is "This link doesn't work". In dev mode the page
  only says it isn't used.

It renders in every session phase — signed out, restoring, no family, in the
archive — because the root layout's `Gate` lets this one path skip the phase
switch until the person is done with it (see the comment there).

When the app sends these emails from the web it passes the web app's origin
as the continue URL. If Firebase refuses it (`auth/unauthorized-continue-uri`
— the domain isn't under Authentication → Settings → Authorized domains), the
app logs a warning and sends the email without one. Natively no continue URL
is sent.

**Human step — point the emails at the page** (once per Firebase project; the
page must be deployed before the prod project is switched, or every emailed
link breaks):

1. Firebase console → the project → Authentication (under *Security* in the
   newer navigation) → **Templates**.
2. Open any template (e.g. *Email address verification*) and click the
   **pencil** (edit).
3. Click **Customize action URL** at the bottom of the form and enter:
   - prod (`keepsake-prod-47eda`): `https://keepsake-demo-h4t9wq.fly.dev/auth/action`
   - dev: `http://localhost:8081/auth/action`
4. Save. The action URL is one setting for the whole project — it applies to
   every template (verification, password reset, email change), not just the
   one you opened.
5. While there, add `keepsake-demo-h4t9wq.fly.dev` under Authentication →
   **Settings → Authorized domains** (prod), so the continue URL is accepted
   (`localhost` is authorized by default).

What else the console lets you change in the emails (per template, same
pencil): the **sender name**, the sender address (the part before the `@`,
until a custom domain is set up), the
**reply-to** address and the **subject**; the **message body** only for the
password-reset template (verification and email-change bodies are fixed).
Subject and body take `%DISPLAY_NAME%`, `%APP_NAME%` (the project's public-facing
name, Project settings), `%LINK%`, `%EMAIL%` and `%NEW_EMAIL%`. Sending from
our own domain is **Customize domain** on the same form, then TXT and CNAME
records at the DNS registrar (verification can take up to 24 hours), then
**Apply custom domain** — it changes both the From address and the action
links' domain. ([Firebase help: email templates](https://support.google.com/firebase/answer/7000714),
[custom domain](https://firebase.google.com/docs/auth/email-custom-domain).)

**Trying it locally with the Auth emulator** (a development aid; no real
Firebase project or email involved). Java is required.

```bash
# 1. The emulator (any directory; the demo- prefix means no real project)
npx firebase-tools emulators:start --only auth --project demo-littlebylittle

# 2. The API in firebase mode against the emulator, on a scratch database
AUTH_MODE=firebase FIREBASE_PROJECT_ID=demo-littlebylittle \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
DATABASE_URL=postgresql://littlebylittle:littlebylittle@localhost:55432/<scratch db> \
PORT=4100 npx tsx src/index.ts          # in server/

# 3. The app, pointed at both (in app/; any non-empty Firebase values work)
EXPO_PUBLIC_API_URL=http://localhost:4100 EXPO_PUBLIC_AUTH_MODE=firebase \
EXPO_PUBLIC_FIREBASE_API_KEY=demo-api-key EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost \
EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-littlebylittle EXPO_PUBLIC_FIREBASE_APP_ID=1:0:web:0 \
EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR=http://127.0.0.1:9099 npx expo start --web

# 4. The "emails": every code the emulator would have sent
curl -s http://127.0.0.1:9099/emulator/v1/projects/demo-littlebylittle/oobCodes
```

Open `http://localhost:8081/auth/action?mode=<requestType's mode>&oobCode=<oobCode>`
for any code listed (each entry's `oobLink` carries the right query string).
`firebase-admin` switches to the emulator by itself when
`FIREBASE_AUTH_EMULATOR_HOST` is set; never set it, or
`EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR`, anywhere real.

The app puts `Authorization: Bearer <token>` and `x-family-id` on every API
call (`apiFetch` in [app/src/api.ts](app/src/api.ts)), and a `401` signs it
out. Upload targets get neither — they are signed in their URL.

A user in several families must say which one they mean:

```
x-family-id: <family id>
```

Without the header, a single membership is used and several are a
`400 family_required` listing them. A family you don't belong to is a `403`,
and a row belonging to another family is a `404` — an id never confirms itself.

```bash
API=http://localhost:4000
TOKEN='Bearer dev:demo@littlebylittle.local'

curl -s $API/api/me -H "Authorization: $TOKEN"          # user + memberships
curl -s $API/api/home -H "Authorization: $TOKEN"
curl -s $API/api/memories -H "Authorization: $TOKEN" -H 'x-family-id: <id>'
curl -s -X POST $API/api/families -H "Authorization: $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"The Reyes"}'
```

`POST /api/families` and `GET /api/me` are the only routes reachable before you
belong to an archive; creating one makes you its OWNER and gives you a `Person`
row inside it.

The app asks `GET /api/me` after sign-in: no membership shows "Start your
family's archive", several show a picker (the choice is remembered, and Family
Hub can switch), one goes straight in.

**Production needs a real verifier.** `createTokenVerifier()` throws at boot
rather than serve dev auth under `NODE_ENV=production` (unless
`ALLOW_DEV_AUTH_IN_PROD=1`), and rather than run `firebase` mode without a
project id. The hosted demo runs `AUTH_MODE=firebase`.

Media bytes are reachable without a bearer token because the client loads them
as plain `<img>` URLs: `/media/gen/*` placeholders are public, and uploaded
originals are served through signed URLs with a one-hour expiry — see
[Storage](#storage).

## Storage

Uploads go through a two-phase handshake — `POST /api/media/init` authorises a
target, the client `PUT`s the bytes straight to it, `POST /api/media/finalize`
sniffs the real type from the first 4 KB (a ranged read) and records the size
and a digest — so the same client code works against a local volume and a
presigned S3 URL ([server/src/storage/](server/src/storage/)). This section
is photos (and covers and avatars): they are stored as uploaded. Video and
audio take the same three calls but go to Mux instead — see
[Video and audio (Mux)](#video-and-audio-mux). Every upload is capped at
2,000,000,000 bytes (`GET /api/media/limits`; the capture screen says so before
uploading). Upload URLs live 60 minutes.

The digest is S3's own checksum when there is one: S3 computes a full-object
CRC64NVME for every upload that arrives without a checksum header, and
finalize reads it with `HeadObject` (`ChecksumMode=ENABLED`) into
`Media.checksum` as `crc64nvme:<base64>` instead of downloading the object to
hash it. Where storage has no checksum (local disk, emulators that don't keep
one) finalize streams the object through SHA-256 into `Media.sha256`. Exactly
one of the two is set on an upload.

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
rejects the same uploads AWS would. `s3-init` creates the `littlebylittle-dev`
bucket, turns versioning on and allows `http://localhost:8081` (CORS).

```bash
STORAGE_PROVIDER=s3 docker compose --profile s3 up --build   # API on the emulator
docker compose up                                            # back to the volume
```

The emulator's S3 API is on `localhost:9300` (user `littlebylittle`, password
`littlebylittle-dev-secret`). Presigned URLs point there, so uploads from a phone on
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
   from the volume regardless of provider, so keep the Fly mount until you
   no longer need them. (The demo dropped its mount on 2026-10-17 after a
   reset; see `fly.toml`.)
5. **Flip it** — in `fly.toml` `[env]`: `STORAGE_PROVIDER = "s3"`,
   `S3_BUCKET = "<bucket>"`, `S3_REGION = "us-west-1"`; `fly deploy`.
6. **Run the copy again** — picks up anything uploaded between steps 4 and 5;
   everything else reports "already present". Then check `/api/health` shows
   `"media": true` and upload a photo and a video from the web app.

## Background jobs

Slow work runs through the `Job` table
([server/src/jobs/](server/src/jobs/)): a route enqueues a row, a worker claims
it with `FOR UPDATE SKIP LOCKED`, and a handler that throws is retried with
exponential backoff until `maxAttempts`, then marked `FAILED`. A job left
`RUNNING` by a worker that died is reclaimed once its lock is 10 minutes old.
The worker runs inside the API when `WORKER_INLINE=1` (compose and Fly set it),
or on its own with `npm run worker` (`npm run worker:dev` off TypeScript).

The one job today is `mux.sync` (see [Video and audio (Mux)](#video-and-audio-mux)).

| Variable | Meaning |
| --- | --- |
| `WORKER_INLINE` | `1` runs the job worker in the API process. Unset, jobs wait for `npm run worker`. |

## Video and audio (Mux)

Every VIDEO and AUDIO clip goes straight to [Mux](https://www.mux.com) and lives
only there; photos stay in [Storage](#storage). Mux transcodes (HEVC plays
everywhere), streams adaptive HLS over its CDN, draws poster frames by URL and
writes captions, which are our transcripts. Why: "Decision: Mux for video and
audio" in [docs/PLAN.md](docs/PLAN.md). The code is in
[server/src/media-host/](server/src/media-host/).

The client's upload is the same three steps as a photo:

1. `POST /api/media/init` with an `audio/*` or `video/*` type creates a Mux
   *direct upload* and answers `{ uploadId, key: "mux:<uploadId>", mimeType,
   target: { url, method: "PUT", headers: {}, expiresAt } }`. The browser's
   `Origin` becomes the upload's CORS origin (it must be one this API allows;
   native clients send none). A `MuxAsset` row records that this family asked.
2. The client PUTs the file to `target.url` — one plain PUT, no headers.
3. `POST /api/media/finalize` with the `mux:` key asks Mux whether the upload
   arrived (waiting up to ~8 s for Mux to notice), checks it is this family's,
   and answers `{ media: { key, type, mimeType, bytes, sha256: null,
   checksum: null } }`. No sniff or checksum: Mux decodes the file itself and
   fails the asset if it can't. It also starts the `mux.sync` job.

`POST /api/memories` takes the `mux:` key as `media[].storageKey`. The clip's
media item reads `status: "PROCESSING"` until Mux can play it, then `READY`
(or `FAILED`), with `url` — signed HLS for video, the signed `audio.m4a` static
rendition for audio — and, for video, `posterUrl`; both are null until READY.
A memory card's `heroUrl` and a mosaic tile's `url` for a video are its poster
frame, never the video. Every URL carries an RS256 playback token valid for
`READ_URL_TTL_SECONDS` (plus the clip's length for playback), reused for ten
minutes so URLs (and the client's image cache) are stable. Assets are created
with signed playback only, `basic` quality, a 1080p cap and auto-language
captions.

**Order doesn't matter.** A clip can finish — captions and all — before or
after the memory that holds it is created. Whichever comes second copies the
duration, dimensions and transcript onto the `Media` row and offers the
transcript to the memory: `Memory.transcript` is filled from the clips in
order while it is empty or still exactly what the machine wrote. Once a person
edits it, it's theirs.

**Webhooks and polling.** `POST /api/webhooks/mux` takes Mux's events
(`video.upload.asset_created`, `video.asset.ready` / `errored`,
`video.asset.track.ready` / `errored` for the generated captions,
`video.asset.static_rendition.ready` for audio). It reads the raw body
(mounted before `express.json` and auth), verifies `mux-signature` with
`MUX_WEBHOOK_SECRET`, and is idempotent: every event is merged as facts that
can't move backwards, so a replay changes nothing. It never calls Mux back;
fetching the caption text is the `mux.sync` job's work. That job, queued at
finalize, polls the upload and asset — every 3 s at first, easing to every
2 minutes — until the asset is playable and its transcript is in, and gives up
after 6 hours (whatever is still pending becomes FAILED). It's the safety net
for a missed webhook, and the whole mechanism **in development, where no
tunnel is needed**: without `MUX_WEBHOOK_SECRET` the webhook answers 503 and
polling does everything.

A FAILED transcript is retried with
`POST /api/memories/:id/media/:mediaId/transcribe`: if Mux has the caption
text it is fetched again, otherwise the errored caption track is removed and
captions are generated anew from the asset's audio track. Nothing ever deletes
a Mux asset — it is the only copy — and soft-deleting a `Media` row leaves it
alone.

Without the four required variables the server still boots, photos work,
`/api/health` reports `"mux": false`, and AV init answers
`503 { code: "av_unavailable" }`.

| Variable | Meaning |
| --- | --- |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Required. An access token with Mux Video read/write. |
| `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE` | Required. A URL signing key; the private key as Mux hands it out (base64 of the PEM; a raw PEM also works). Every playback, poster and caption URL is signed with it. |
| `MUX_WEBHOOK_SECRET` | Optional. The webhook's signing secret. Set it where Mux can reach `https://<host>/api/webhooks/mux` (production); leave it unset in development. |

Locally, put them in a root `.env` (gitignored; compose passes them through).
On Fly: `fly secrets set MUX_TOKEN_ID=… MUX_TOKEN_SECRET=… MUX_SIGNING_KEY_ID=…
MUX_SIGNING_KEY_PRIVATE=… MUX_WEBHOOK_SECRET=…`. Use separate Mux
environments (Development, Production) so dev uploads never land in the
production archive.

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
origins, e.g. `http://localhost:8081,https://littlebylittle.example`). It is
deliberately unset in `docker-compose.yml`: outside production an empty
`CORS_ORIGINS` allows every origin, which is what lets a phone on an
unpredictable LAN address reach the API. In production an empty `CORS_ORIGINS`
means same-origin only — no `Access-Control-Allow-Origin` header at all — which
is correct for the hosted build, where the web bundle is served by the API
itself.

## Layout

```
app/                     Expo + expo-router
  app/(tabs)/              the five tabs; library/ is a nested stack (landing → children → child → collection)
  app/memory/[id].tsx      the immersive memory page
  src/api.ts               API client + response types
  src/auth/                AuthProvider (dev / Firebase), session phases, chosen family
  src/theme.ts             palette, fonts, type scale, spacing
  src/components/journey.tsx  redesign primitives: PageHeader, PhotoCard, SearchField, IconDisc, ListRow, Sparkle
  src/routes.ts            route paths + openInLibrary
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
`Media.storageKey` / `mimeType` / `bytes` / `checksum` or `sha256` / `status` describe an
object in a storage provider rather than a path on disk, and `Derivative` holds
the thumbnails, display renditions, posters and waveforms generated from it
(A5, A6); a video or audio clip instead links through `Media.muxAssetId` to a
`MuxAsset` (the Mux upload, asset, playback id and transcript). `Job` is the durable work queue those derivatives run through (A6),
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

Linting is [oxlint](https://oxc.rs/docs/guide/usage/linter), configured once at
the root in `oxlint.config.ts` for both `app/` and `server/`. It's type-aware,
so install `app/` and `server/` first; their `node_modules` supply the types.

```bash
npm install && npm run lint   # from the repo root; `npm run lint:fix` applies safe fixes
```

The root `npm install` also points git at `.githooks/`, whose `pre-commit` runs
the same lint and blocks the commit on any error (`git commit --no-verify` skips
it). A fresh clone or worktree needs `npm install` in the root, `app/` and
`server/` before it can commit.

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
