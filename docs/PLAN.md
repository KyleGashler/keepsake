# Keepsake — path to production

Two tracks. **Track A** is work that lives entirely in this repo and needs no
outside accounts; every task is a self-contained brief for a sub-agent.
**Track B** needs an external service (Firebase, AWS, an AI provider, …). Each
B task splits into a *provision* step only a human can do and an *adapter*
step an agent can do once the credentials exist.

The trick that keeps the tracks independent: Track A builds every external
dependency behind an interface with a local implementation (disk storage,
dev-token auth, console email, stub AI). Track B swaps the implementation, not
the callers.

---

## Ground rules for every task

- Read `README.md` and `app/AGENTS.md` first.
- Server: Express + Prisma in `server/`. Client: Expo Router in `app/`.
- Run `npm run typecheck` in both packages before finishing.
- Every new query filters by `familyId`. Never look a row up by id alone.
- Original media is sacred: nothing deletes or overwrites an uploaded original.
- Don't add a dependency without a one-line justification in the PR.
- One PR per task. Branch name `task/<id>-<slug>`.

---

## Track A — in-repo work

### Wave 1 — no dependencies, run in parallel

#### A1. Real migrations
**Goal:** stop running `prisma db push --accept-data-loss` in prod.
**Do:** `prisma migrate dev --name init` to produce a baseline under
`server/prisma/migrations/`; `docker-entrypoint.prod.sh` runs
`prisma migrate deploy`; dev entrypoint keeps `migrate dev`. Seed runs only when
`SEED_DEMO=1`, and the Fly config sets it. Add `npm run db:migrate`.
**Accept:** fresh DB boots via migrate deploy; second boot is a no-op;
`fly.toml` no longer relies on push.


#### A12. Server hardening + real build
**Goal:** production runtime instead of `tsx` in prod.
**Do:** compile with `tsc` (or `tsup`) to `dist/`, `start` runs node on it.
Add `helmet`, `express-rate-limit` (tight on upload/auth paths), CORS allowlist
from `CORS_ORIGINS` env, `pino-http` with request ids, graceful shutdown
(SIGTERM → close server → `prisma.$disconnect`). Health returns storage + DB
status. Leave the `DEMO_PASSWORD` gate in place; A3 removes it.
**Accept:** Docker image runs compiled JS; typecheck clean.

#### A2. Schema for accounts, tenancy, storage, jobs
**Goal:** land every table the later tasks need in one migration so they don't
collide.
**Do:** in `schema.prisma`:
- `User { id, authProviderId @unique, email, displayName, createdAt }`
- `FamilyMembership { userId, familyId, role: OWNER|CONTRIBUTOR|VIEWER, personId? }`
- `Invite { id, familyId, email, role, token @unique, expiresAt, acceptedAt?, invitedById }`
- `Person.userId String? @unique` (a person may be a login)
- `Media`: add `storageKey`, `mimeType`, `bytes`, `sha256?`,
  `status: UPLOADING|READY|FAILED`, `deletedAt?`
- `Derivative { id, mediaId, kind: THUMB|DISPLAY|POSTER|WAVEFORM, storageKey, width, height, mimeType }`
- `Memory`: add `palette String[]` (hex swatches), `analysisStatus`,
  `storySource: HUMAN|AI_DRAFT`, `deletedAt?`
- `Job { id, type, payload Json, status, attempts, runAt, lastError?, createdAt, updatedAt }` + index on `(status, runAt)`
- `DeviceToken { id, userId, token @unique, platform }` (for B7)
- `Subscription { id, familyId @unique, provider, externalId, status, plan, currentPeriodEnd }` (for B9)
Generate the migration, update `seed.ts` so the demo family still seeds (one
demo user as OWNER).
**Accept:** migration applies to a DB seeded from the A1 baseline; seed works;
existing routes still typecheck.

### Wave 2 — after A1/A2

#### A3. Request context and family scoping
**Depends:** A2.
**Goal:** replace `currentFamily()` with a per-request identity.
**Do:**
- `server/src/auth/TokenVerifier.ts`: interface
  `verify(bearer: string) => Promise<{ providerId, email, name }>`.
- `DevTokenVerifier`: accepts `Bearer dev:<email>`; enabled only when
  `AUTH_MODE=dev`. Production refuses to boot without a real verifier configured.
- Middleware resolves `User` (upsert on first sight), loads memberships, sets
  `req.ctx = { user, family, role }`. Family chosen by `x-family-id` header or
  the user's only membership. 401 / 403 as appropriate.
- Delete `currentFamily()`. Every query takes `familyId` from ctx, including
  the by-id routes (`GET/PATCH /memories/:id`, `/collections/:id`,
  `/people/:id`, media lookups).
- `POST /families` creates a family + OWNER membership + Person for the user.
- `GET /me` returns user + memberships.
- Remove the `DEMO_PASSWORD` gate.
- Decide on `Person.userId`: A2 shipped both `Person.userId @unique` (one Person
  per User globally) and `FamilyMembership.personId` (one Person per User per
  family). The membership link is the one that supports a user in several
  families; drop `Person.userId` in this task's migration if it isn't needed.
**Accept:** user in family A gets 404 for family B's memory id; all routes 401
without a token.

#### A5. Storage abstraction + two-phase upload
**Depends:** A2.
**Goal:** upload path that works against local disk today and S3 tomorrow with
no route changes.
**Do:**
- `server/src/storage/StorageProvider.ts`:
  `createUploadTarget({ key, mimeType, bytes }) => { url, method, headers }`,
  `head(key)`, `getReadUrl(key, ttl)`, `delete(key)` (derivatives only),
  `stream(key)`.
- `LocalDiskProvider`: upload target is `PUT /media/local-upload/<signed-token>`
  served by this API; read URLs are `/media/o/<key>`. Signing via HMAC with
  `MEDIA_SIGNING_SECRET`.
- Routes: `POST /api/media/init` → creates `Media(status=UPLOADING)` and returns
  the target; `POST /api/media/:id/finalize` → verifies object exists, sniffs
  MIME from bytes (`file-type`), records size/sha256, sets `READY`, enqueues
  `media.derive` job (A6).
- Client `uploadFile()` in `app/src/api.ts` follows init → PUT → finalize.
- Keep the `/media/gen/:seed.png` placeholder route.
**Accept:** upload from web and from Expo Go on a phone; wrong MIME rejected at
finalize.

#### A10. Search index
**Depends:** A1.
**Do:** migration adding a generated `tsvector` column over
title/story/transcript/location with a GIN index; `/search` uses
`websearch_to_tsquery` with rank, falls back to ILIKE for people/collections.
**Accept:** EXPLAIN shows index use; existing search results unchanged.

### Wave 3 — after A3 / A5

#### A4. Roles, invites, membership management
**Depends:** A3.
**Do:** `requireRole(...)` middleware; OWNER: family settings, invites, remove
member, delete; CONTRIBUTOR: create/edit; VIEWER: read. Invite flow:
`POST /family/invites` creates token + calls `EmailSender.send()`
(interface + `ConsoleEmailSender`); `GET /invites/:token` preview;
`POST /invites/:token/accept` creates membership. `DELETE /family/members/:id`.
Family Hub screen shows real permissions and pending invites.
**Accept:** each role boundary verified by hand; accept flow end-to-end in dev mode.

#### A6. Job queue + derivatives worker (gives Mosaic a real palette)
**Depends:** A5.
**Do:**
- `server/src/jobs/JobQueue.ts` interface; `PostgresJobQueue` polling the `Job`
  table with `FOR UPDATE SKIP LOCKED`, retries with backoff.
- `server/src/worker.ts` entrypoint; also runnable in-process when
  `WORKER_INLINE=1` (dev + single-machine Fly).
- Handler `media.derive`: `sharp` → THUMB (400), DISPLAY (1600), HEIC→JPEG,
  EXIF date extraction (fill `occurredAt` if unset), dominant palette via
  `sharp().stats()` or a small k-means → `Memory.palette` + `paletteHue` +
  `brightness` from the hero. Video (see "Decision: video, for now"): poster frame via `ffmpeg` if present on
  the image, else skip. Audio: duration.
- Mosaic route orders by real palette; DTOs return derivative URLs, originals
  only on the memory page.
**Accept:** upload a photo, watch tiles reorder by true colour; worker survives
a thrown handler.

#### A7. CRUD completeness
**Depends:** A3.
**Do:** soft-delete memory (`deletedAt`, hidden everywhere, 30-day trash view
in Family Hub, restore); remove media from a memory (unlink, never delete the
original); people create/edit/delete; custom collections CRUD and
add/remove memory; reorder media. Client screens for each.
**Accept:** every mutation has a UI path.

#### A8. Client auth + data layer
**Depends:** A3.
**Do:** `app/src/auth/AuthProvider.ts` interface
(`signIn`, `signOut`, `getToken`, `onChange`); `DevAuthProvider` (email field
→ `dev:<email>` token) used when `EXPO_PUBLIC_AUTH_MODE=dev`; token stored in
`expo-secure-store`. Sign-in screen, family picker / create-family screen.
Replace `useApi` with TanStack Query; inject bearer + `x-family-id`; global
401 → sign-out. Error and empty states on every screen.
**Accept:** cold start → sign-in → browse → capture works on web and device.

### Wave 4 — feature work on the new foundations

#### A9. Audio recording and playback
**Depends:** A5, A8.
**Do:** `expo-audio` recorder on Capture → compose; level meter; playback
component in memory page with scrubber; upload through A5. Transcript field
stays hand-typed until B5.
**Accept:** record on device, play back from the memory page.

#### A13. AI interfaces with deterministic stubs
**Depends:** A6.
**Do:** `server/src/ai/` interfaces: `Transcriber(audioKey)`,
`Narrator(memory, transcript, participants)`, `Tagger(memory) → { people, collections, location }`,
`PromptGenerator(family) → CapturePrompt[]`. Stub implementations return
fixed text. Job types `ai.transcribe`, `ai.narrate`, `ai.tag`,
`ai.prompts.daily`. Endpoints: `POST /memories/:id/narrate`,
`GET /memories/:id/analysis`. UI: "Drafting…" state, AI draft badge, one-tap
accept/edit; `storySource` flips to HUMAN on edit.
**Accept:** full pipeline runs with stubs; swapping the stub for B5 touches
only `server/src/ai/impl/`.



#### A16. Account deletion + privacy surfaces
**Depends:** A4, A5.
**Do:** `DELETE /me` — leaves families, transfers or deletes solely-owned
families after confirmation, enqueues storage purge; privacy policy and terms
screens (placeholder copy, marked); COPPA note: children are `Person` rows,
never `User` rows, enforced in A4.
**Accept:** deletion leaves no rows or objects for the user.

---

## Track B — external integrations

Each task: **Provision** (human, use the `wizard` skill to script the
walkthrough) then **Adapter** (agent). Adapters implement an interface from
Track A; the row says which.

| ID | Service | Provision (human) | Adapter (agent) | Implements | After |
| --- | --- | --- | --- | --- | --- |
| B1 | **Firebase Auth** | Create project; enable Email, Apple, Google; download service-account JSON; add iOS/Android apps + web config | `FirebaseTokenVerifier` (`firebase-admin`); client `FirebaseAuthProvider` (Firebase JS SDK on web, `@react-native-firebase/auth` native) | A3 `TokenVerifier`, A8 `AuthProvider` | A3, A8 |
| B2 | **AWS S3** | Bucket with versioning on, no lifecycle deletes; IAM user scoped to that bucket (get/put/head, no delete on `*/original.*`); CORS for PUT from app origins | `S3StorageProvider` with presigned PUT/GET (`@aws-sdk/client-s3`, `s3-request-presigner`); local S3 emulator in compose; one-off copy of Fly-volume objects into the bucket | A5 `StorageProvider` | A5 |
| B3 | **Managed Postgres + backups** | Fly Postgres / Neon / RDS with PITR; set `DATABASE_URL` secret | Point `migrate deploy` at it; document restore drill | A1 | A1 |
| B4 | **Worker process** | Fly `[processes] worker` + scale | `fly.toml` process groups; `WORKER_INLINE=0` | A6 | A6 |
| B5 | **AI providers** | Anthropic API key; speech-to-text key (Deepgram / AssemblyAI / OpenAI) | `ClaudeNarrator`, `ClaudeTagger`, `ClaudePromptGenerator` (vision for palette/composition refinements), `DeepgramTranscriber` | A13 interfaces | A13 |
| B6 | **Email** | Resend or Postmark account, verified sending domain | `ResendEmailSender`; invite + magic-link templates | A4 `EmailSender` | A4 |
| B7 | **Push** | Expo EAS project; APNs key; FCM config | Register `DeviceToken`; `push.dailyPrompt` job; Family Updates pushes | A2 `DeviceToken`, A6 queue | A6, A8 |
| B8 | **Observability** | Sentry projects (server + RN); Fly log drain | `@sentry/node` in server, `@sentry/react-native` in app; pino → drain | A12 | A12 |
| B9 | **Billing** | RevenueCat (App Store + Play) and/or Stripe; products + entitlements | Webhook → `Subscription`; `requireEntitlement()` middleware; paywall screen | A2 `Subscription`, A4 | A4 |
| B10 | **App distribution** | Apple Developer + Play Console; EAS build/submit credentials; domain for universal links | `eas.json`, `apple-app-site-association`, `assetlinks.json`, invite deep-link handling | A4 invites, A8 | A8 |
| B11 | **Domain, TLS, secrets** | Domain + Fly cert; set all secrets | `CORS_ORIGINS`, `EXPO_PUBLIC_API_URL` per env | A12 | A12 |

---

## Decision: video, for now (2026-10-06)

Originals of every type, video included, go to plain S3. Video is accepted as
is and played back from the original through a presigned URL. Known costs we
are choosing to live with until real customers are close:

- ~~The 100 MB upload cap stays.~~ Raised to 2,000,000,000 bytes on
  2026-10-16 (C4): Deepgram's per-file limit, and under `Media.bytes`'s
  32-bit ceiling. Anything larger is still refused before upload.
- Single presigned PUT, no multipart or resumable upload. A dropped 2 GB
  upload restarts from zero.
- No transcoding. HEVC `.mov` from iPhones won't play in some browsers or on
  some Android devices; the memory page shows a download/open fallback.
- No adaptive streaming and no CDN; playback is slower over cellular.

**Revisit before launch** (one task, swap-in behind A6's job queue): raise the
cap with multipart uploads; transcode to H.264 MP4/HLS (Mux, Cloudflare Stream,
MediaConvert or an ffmpeg worker); CloudFront or R2 for egress; lifecycle
originals to an infrequent-access tier (transition, never expire).

## Capture milestone: record and transcribe (2026-10-16)

Pulled ahead of Wave 3. These tasks replace A9 and the transcription half of
A13 and B5. Decisions: **Deepgram** for speech-to-text, **web and phone**
both supported, and an **in-app video recorder** (our UI, length-capped)
rather than handing off to the system camera. Shipped one vertical at a time:
audio end to end first, then video.

### Vertical 1: audio, end to end

#### C1. Transcription pipeline (server)
**Do:**
- Job queue, built to the A6 spec so A6 only adds handlers later:
  `server/src/jobs/JobQueue.ts` interface, `PostgresJobQueue` claiming
  `Job` rows with `FOR UPDATE SKIP LOCKED`, retry with backoff up to
  `maxAttempts`; `server/src/worker.ts` entrypoint; runs in-process when
  `WORKER_INLINE=1` (default in dev and on Fly's single machine).
- `server/src/ai/Transcriber.ts`:
  `transcribe({ key, mimeType }) => { text, durationS?, speakers? }`.
  `StubTranscriber` (fixed text after a short delay) is used when
  `DEEPGRAM_API_KEY` is unset. `DeepgramTranscriber` lives in
  `server/src/ai/impl/` and calls the REST API with `fetch` (no SDK). It
  sends `{ url }` when storage returns an absolute https read URL (S3), and
  streams the bytes otherwise (local disk isn't reachable from Deepgram).
  Diarized output is formatted as `Speaker 1: …` paragraphs.
- Migration: `Media.transcript String?` and
  `Media.transcriptStatus TranscriptStatus?` (`PENDING|READY|FAILED`; null
  means not applicable, i.e. photos).
- `POST /memories` sets AUDIO and VIDEO media to `PENDING` and enqueues one
  `ai.transcribe` job per clip. The handler writes `Media.transcript`. If
  `Memory.transcript` is empty it fills it from the clip transcripts in sort
  order; a transcript a person typed or edited is never overwritten.
  `durationS` is filled from the transcriber when the client didn't send it.
- DTO: memory gains `transcriptStatus` (PENDING if any clip is pending,
  else FAILED if any failed, else READY, else null); media items gain
  `transcriptStatus`.
- `POST /memories/:id/media/:mediaId/transcribe` re-queues a failed clip.
- Allowlist: accept `audio/webm;codecs=…`-style declared types by stripping
  parameters before the lookup.
**Accept:** create a memory with an audio key; job runs; transcript appears
on `GET /memories/:id` (stub locally, Deepgram with a key); worker survives a
throwing transcriber and marks the clip FAILED after retries.

#### C2. Audio recorder and playback (client)
**Do:**
- `expo-audio` for recording on iOS, Android **and web** (MediaRecorder
  underneath). Capture → "Record a conversation" opens a full recorder
  screen: big record/stop button, elapsed timer, live level meter, pause and
  resume, discard, "Use recording". Permission denied → plain-language
  message with a link to settings.
- Use recording → compose with the clip attached (via `draft`, with
  `durationS`), audio-mode compose drops the hand-typed transcript field
  and says the transcript will be written automatically.
- Memory page: real `AudioCard` playback (`expo-audio` player) with
  play/pause, scrubber and time; transcript tab shows "Transcribing…" while
  pending (poll every 3s until settled), a retry on FAILED, and the
  transcript is editable like the story.
**Accept:** record in Chrome, Safari and Expo Go; play back from the memory
page; the transcript appears without a refresh.

### Vertical 2: video, end to end

#### C3. In-app video recorder, playback, transcription
**Do:**
- Native: `expo-camera` `CameraView` (video mode) with record/stop, timer,
  front/back flip, a hard `maxDuration` derived from the upload cap (about
  2 minutes at default quality), then preview with retake / use.
- Web: a `.web.tsx` recorder on `getUserMedia` + `MediaRecorder` (expo-camera
  can't record on web), same UI. Prefer `video/mp4` where the browser
  supports it, else `video/webm`. Server allowlist and sniff table gain
  `video/webm`.
- Capture → "Capture a moment" offers Photo (existing picker) or Video (new
  recorder).
- Memory page: native video playback with `expo-video` (replaces the
  "Open original" fallback where the codec plays); web keeps `<video>`.
- Transcription is C1's pipeline unchanged: VIDEO clips are already
  enqueued, and Deepgram takes video containers directly.
**Accept:** record a clip on web and on a phone; it plays on the memory page
and its transcript appears.

**Human steps:** create a Deepgram project + API key; `fly secrets set
DEEPGRAM_API_KEY=…`. Camera and microphone on web need a secure origin
(https or localhost), so testing from a phone's browser on the LAN won't
work; use Expo Go there.

### C4. Long videos (2026-10-16)
**Do:**
- `MAX_UPLOAD_BYTES` = 2,000,000,000. Upload URLs live 60 minutes, not 15.
  Too-large messages read in GB.
- Recorders drop the 2-minute stop. The only stop is the byte budget near
  the cap (about 40 minutes native, longer on web).
- Video over `TRANSCRIBE_MAX_VIDEO_SECONDS` (default 120) is not
  transcribed: new `TranscriptStatus.SKIPPED`, no job, and the retry route
  refuses it. The memory page says long-video transcripts are coming. Audio
  is transcribed at any length. Imported videos send their picker duration;
  a video with no known duration is transcribed.
- Finalize stops downloading S3 objects to hash them: it records S3's own
  full-object checksum (`HeadObject` with `ChecksumMode=ENABLED`, CRC64NVME
  by default) in a new `Media.checksum` column (`<algorithm>:<base64>`).
  It streams a sha256 only when the provider has no checksum (local disk,
  emulators). The MIME sniff stays a small ranged read.

### Later: long media, properly
- Resumable multipart uploads (S3 `CreateMultipartUpload` + presigned part
  URLs), so a dropped connection resumes and the cap can go past 2 GB.
- Transcribe long video: extract the audio track with ffmpeg in the worker,
  then send only audio to Deepgram. Deepgram handles long files natively, so
  splitting into chunks is probably unnecessary; revisit only if job
  timeouts force it.
- Web recorder: stream chunks to the multipart upload as they're recorded,
  instead of holding the whole clip in browser memory.

## Library journey redesign (2026-10-21)

A visual overhaul, built as one end-to-end journey before anything else is
restyled: **Library → Child Profiles → a child's Collections → one Collection
→ one Memory**. Mockups live in `design/mockups/` (gitignored — binaries stay
out of git):

| File | Screen |
| --- | --- |
| `00-journey-overview.png` | Screens 1–3 side by side |
| `01-library.png` | Library landing: three pillar cards with cover photo, edit pencil, chevron |
| `02-child-profiles.png` | Child selection: one photo card per child, name + age |
| `03-child-collections.png` | One child's collections: photo, name, age · N collections · N memories, search, icon list, Create a Collection |
| `05-memory-detail.png` | Memory detail, annotated, plus full-screen viewer, options menu, edit sheet, transcript view |

There is no mockup for a single collection's archive (screen 4). It is designed
from the same visual language and adjusted when one arrives.

Ground rules beyond the usual ones:

- **Data-driven.** Names, ages, counts, collection lists come from the API.
  Nothing about Banks is hardcoded; any number of children works, including zero.
- **A child's content is theirs.** A child's collections are `Collection` rows
  with `personId` = the child. A memory shows up under a second child only by
  being filed in one of that child's collections too (`MemoryCollection` is
  already many-to-many). Counts are per child, distinct by memory.
- **Copy never guesses pronouns.** The mockup's "Different parts of her story"
  becomes "Different parts of Banks's story".
- **Back preserves place.** Library screens live in a nested stack inside the
  Library tab, so the tab bar stays visible and each tab keeps its own history.
  Memory detail is immersive (no tab bar) and is pushed on the root stack over
  the tabs, so backing out lands on the exact archive it came from.

### Design language (from the mockups)

- Paper `#FBF8F2`, ink a deep teal `#123F45`, softer teal-grey for subtitles,
  golden-honey accent for the eyebrow ("LITTLE BY LITTLE") and the four-point
  sparkle. Capture is a raised deep-teal disc in the middle of the tab bar.
- Display serif for titles and row names (DM Serif Display), humanist sans for
  everything else (Nunito Sans), both via `@expo-google-fonts/*` + `expo-font`.
- Five tabs: Home, Library, Capture (center), Timeline, Mosaic. Timeline is a
  placeholder screen in this milestone.
- Child collection discs, in order: Milestones gold/sparkles, Day-to-Day Moments
  sage/rainbow, Quotes & Conversations deep teal/speech bubble, Birthdays
  terracotta/cake, Kindness & Character forest green/heart, Talents & Hobbies
  dusk blue/butterfly, Phases & Obsessions pale peach with a gold moon.

### API contract (L1 implements, L2–L5 consume)

Schema (one migration, `library_journey`):

- `Collection.kind String?` — template key (`milestones`, `day_to_day`,
  `quotes`, `birthdays`, `kindness`, `talents`, `phases`); null for a family's
  own. `Collection.icon String` and `Collection.color String` — a disc's glyph
  key and hex. Custom collections pick from the same icon set.
- `Person.photoKey String?` — storage key of an uploaded profile photo.
- `PillarCover { familyId, pillar, storageKey }`, `@@id([familyId, pillar])`.
- `MemoryFavorite { userId, memoryId, createdAt }` — per signed-in user.
- `MemoryLink { memoryId, linkedId }` — a manual "related memory", stored once
  with the smaller id first.

The child-collection template lives in one server module and is the only
source of the seven defaults (name, description, kind, icon, color, order).
`ensureChildCollections(personId)` is idempotent: it runs when a CHILD is
created and on boot for existing children, matching existing rows by `kind`,
then by name (with `Everyday Moments` → Day-to-Day Moments as an alias), and
creating what's missing. Collections it doesn't recognise are left alone.

Endpoints (all family-scoped):

- `GET /api/library` → `{ pillars: [{ key, name, tagline, coverUrl, customCover }] }`
- `PUT /api/library/pillars/:key/cover` `{ key }` (a finalized upload key) /
  `DELETE` to go back to the default.
- `GET /api/children` → `{ children: ChildSummary[] }`, where
  `ChildSummary = Person & { photoUrl: string | null, collectionCount, memoryCount }`.
  `collectionCount` is the child's CHILD_PROFILES collections; `memoryCount` is
  distinct, non-deleted memories in any collection of theirs.
- `GET /api/children/:id` → `{ child: ChildSummary, collections: Collection[] }`
  (CHILD_PROFILES, sorted).
- `PATCH /api/people/:id` `{ name?, birthDate?, photoKey? | null }`.
- `POST /api/collections` also takes `icon`, `color`.
- `GET /api/collections/:id?q=&year=` → `{ collection, child: ChildSummary | null,
  years: [{ year, count }], memories: MemoryCard[] }`, newest first; `years`
  ignores the `year` filter so the chips don't vanish.
- `GET /api/memories/:id` gains `isFavorite` and `related: MemoryCard[]` (manual
  links first, then suggestions sharing a collection or person, nearest in
  date, max 8).
- `PUT|DELETE /api/memories/:id/favorite`; `POST /api/memories/:id/links`
  `{ linkedId }`, `DELETE /api/memories/:id/links/:linkedId`.
- `PATCH /api/memories/:id` also takes `collectionIds` (replaces the set; covers
  "add to another collection" and "move"); `DELETE /api/memories/:id` soft-deletes.
- `Collection` DTO gains `kind`, `icon`, `color`; `MemoryCard` gains
  `mediaTypes: ("PHOTO"|"VIDEO"|"AUDIO")[]` and `isTextOnly`.

As implemented by L1 (where the contract left a response open):

- `PUT|DELETE /api/library/pillars/:key/cover` → `{ pillar }` (one pillar
  card). A bad key: 400 `malformed_key`, 415 `not_an_image`, 404
  `upload_not_found` (also for another family's key). `GET /api/library` still
  returns `children` and each pillar's `description`/`collectionCount`.
- `POST /api/people` → `{ person, child: ChildSummary | null }`;
  `PATCH /api/people/:id` → `{ person: Person & { photoUrl }, child: ChildSummary | null }`.
- `PUT|DELETE /api/memories/:id/favorite` → `{ isFavorite }`.
  `POST /api/memories/:id/links` → 201 `{ memory }`, `DELETE …/links/:linkedId`
  → `{ memory }` (the full detail, `related` updated).
  `DELETE /api/memories/:id` → 204. Every route that returns one memory
  (GET, POST, PATCH, transcribe) returns the detail shape with `isFavorite`
  and `related`.
- `years` buckets by UTC calendar year; `q` is a case-insensitive substring
  match on title, story, transcript and location, and does narrow `years`.
- Arrival Stories defaults are created for a new child only when they have
  none; existing unrecognised Child Profile rows (e.g. a legacy "The First 3
  Months") are kept and listed alongside the seven.

### Tasks

#### L1. Server: data and API for the journey
Everything in the contract above, plus the seed: three children — Banks (born
2020-05-14), Bear (2022-03-02), Collins (2026-02-10) — each with the default
collections, and a handful of text-only memories across Banks's collections
(one quote, one milestone, one birthday, one shared with Bear) so every
screen has content on a fresh database. No fake media.

#### L2. Client foundation
Theme tokens and fonts; the five-tab bar with the raised Capture button; the
Timeline placeholder; the nested Library stack (`app/(tabs)/library/…`) with
routes for landing, children, one child, one collection; shared primitives
(page header with eyebrow / back label / title + sparkle / subtitle / gear,
photo card, search field, icon disc, list row); `api.ts` types for the
contract. Screens may be stubs that prove the navigation.

#### L3. Screens 1–3
Library landing (pillar cards; pencil picks and uploads a cover), Child
Profiles (photo cards, empty state, add a child), the child's Collections
(header, client-side search, list, Create a Collection sheet with name,
description, icon, colour), and a child edit sheet behind the gear (photo,
name, birthday). Arrival Stories and Family Life keep working, restyled
minimally, until their own pass.

#### L4. Collection archive (screen 4)
One reusable `CollectionArchive`: child header, collection disc + title +
description, search, year chips, memories grouped by year. Entry rendering is
picked by `collection.kind` through a small registry — quotes get a pull-quote
card, everything else a photo-or-text row — so a new kind adds a renderer, not
a screen. Empty state leads to Capture with the collection preselected.

#### L5. Memory detail (screen 5)
Rebuild `app/memory/[id].tsx` from the annotated mockup: immersive hero
(photo, or video with play/scrub/full screen; back, favourite, ⋯ menu over
it), Story / Original Words toggle, date, title, edit pencil, people, media
gallery (+N), audio with waveform, Memory Details (season, where, collection),
Related Memories; full-screen swipeable viewer; options menu (edit, add to
another collection, link a memory, move date, delete); edit sheet. Every
section renders only when it has content — a text-only memory is a complete
page, not a photo memory with holes.

#### L6. Walkthrough
Fresh database, web and phone: tap through the whole journey for Banks, back
out step by step, switch to Bear and confirm nothing of Banks's leaks across
except the shared memory.

Order: **L1 ∥ L2**, then **L3 ∥ L4 ∥ L5**, then L6.

---

## Dependency graph

```
A1 ──┬── A2 ──┬── A3 ──┬── A4 ──┬── A16
     │        │        ├── A7   ├── B6, B9
     │        │        └── A8 ──┬── A9
     │        │                 └── B1, B7, B10
     │        └── A5 ──┬── A6 ──┬── A13 ── B5
     │                 │        └── B4, B7
     │                 └── B2
     ├── A10
     └── B3
A12 ── B8, B11
```

## Suggested execution

1. **Now, in parallel:** A1, A12, A2. ✅ Done. Human starts B1/B2/B3 provisioning.
2. **Next:** A3, A5, A10. ✅ Done.
   B2 adapter runs alongside Wave 3 (built against a local S3 emulator; AWS account only needed for the cutover).
3. **Then:** A4, A6, A7, A8 in parallel. B1 adapter after A3 + A8.
4. **Then:** A9, A13, A16; B4–B11 as their A-side lands.

## Handoff template for a sub-agent

```
Task: <ID + title from docs/PLAN.md>
Read: README.md, app/AGENTS.md, docs/PLAN.md (your task + its dependencies)
Branch: task/<id>-<slug>
Done when: acceptance criteria met, typecheck green, PR opened
Do not: touch files outside the task's scope; add deps without justification
```
