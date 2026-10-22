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
- Original media is sacred: nothing deletes, overwrites or AI-alters what a
  family uploaded. Re-encoding for playback (Mux) is fine; the content stays
  true.
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

> Superseded on 2026-10-22 by "Decision: Mux for video and audio".

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
- `years` and `year` use calendar years in `tz` (the viewer's IANA zone, UTC
  without one; added in L6), so chips agree with the local dates the app
  shows; `q` is a case-insensitive substring match on title, story,
  transcript and location, and does narrow `years`.
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

As built: the memory detail also returns `linkedIds` (which related memories
were linked by hand, so only those offer "unlink"). No hero when a memory has
no photo or video (text-only and audio-only alike). Waveforms are drawn from
the clip id until there's real waveform data; dates are typed YYYY-MM-DD on a
phone (no native date picker dependency yet). Share is shown disabled.

#### L6. Walkthrough
Fresh database, web and phone: tap through the whole journey for Banks, back
out step by step, switch to Bear and confirm nothing of Banks's leaks across
except the shared memory.

As built: a screen's named back row ("‹ Child Profiles", "‹ Banks") uses
`backTo` (src/routes.ts, `router.dismissTo`), so a cold deep link backs out
one level at a time instead of jumping to the Library landing. Archive years
are the viewer's calendar years (`tz`), matching the local dates entries show.

Order: **L1 ∥ L2**, then **L3 ∥ L4 ∥ L5**, then L6.

## Decision: Mux for video and audio (2026-10-22)

Supersedes "Decision: video, for now" and the Deepgram half of C1/C3/C4.
Every VIDEO and AUDIO clip is uploaded straight to **Mux** and lives only
there; S3 (the `StorageProvider`) keeps photos, covers and avatars. Mux gives
us transcoding (HEVC plays everywhere), adaptive HLS over a CDN, poster
frames by URL, and Whisper captions at no extra cost, so Deepgram, the
`ai.transcribe` job and the ffmpeg worker A6 planned for posters all go away.

- **Settings on every asset:** `video_quality: "basic"` (free encoding),
  `max_resolution_tier: "1080p"` (4K is a later unlock at ~3× storage),
  `playback_policies: ["signed"]` (family content is never public),
  `generated_subtitles: [{ language_code: "auto" }]`. Audio assets also get
  the `audio.m4a` static rendition, so audio plays as a plain file
  everywhere instead of HLS.
- **What "original" means now:** Mux keeps its own full-quality master, not
  the uploaded bytes; file metadata and container are not preserved. That's
  accepted: the rule is that nothing *AI-alters* a family's content.
  Re-encoding for playback is fine. If we ever leave Mux, we export every
  master (master access, 24h download URLs per asset).
- **Nothing deletes a Mux asset** except account deletion (A16). It is the
  only copy. Soft-deleting a Media row leaves the asset alone.
- **Cost:** see the comparison from 2026-10-22: roughly $0.25–0.40 per family
  per month in year one, growing with the archive. Storage dominates; the
  lever later is pruning long-unwatched assets, which now means exporting the
  master to cold S3 first.
- **Known losses vs Deepgram:** no speaker diarization (transcripts are no
  longer "Speaker 1: …" paragraphs) and Mux advises against mixed-language
  audio. Accepted for now.
- Legacy dev AV rows (an S3 `storageKey`, no Mux asset) are soft-deleted by
  the migration. No backfill; their S3 objects are left alone.

### API contract (M1 implements, M2 consumes)

- `POST /api/media/init` for an AUDIO/VIDEO MIME type creates a Mux direct
  upload (`cors_origin` from the request's `Origin`, checked against
  `CORS_ORIGINS`; `passthrough` = familyId) and returns the same shape as
  today: `{ key: "mux:<uploadId>", target: { url, method: "PUT", headers } }`.
  Photos are unchanged.
- `POST /api/media/finalize` for a `mux:` key confirms with Mux that the
  upload belongs to this family and has finished, and returns
  `{ key, type, mimeType, bytes }`. No sniff or checksum (Mux validates the
  file and fails the asset if it can't decode it).
- `POST /api/memories` accepts `mux:` keys in `media[].storageKey`.
- Media item DTO for AUDIO/VIDEO gains `status: "PROCESSING" | "READY" |
  "FAILED"` and `posterUrl` (VIDEO only). `url` is the signed HLS
  `https://stream.mux.com/{playbackId}.m3u8?token=…` for video, the signed
  `…/{playbackId}/audio.m4a?token=…` for audio, and `null` until READY.
  `durationS`, `width`, `height`, `transcriptStatus`, `transcript` as today.
- `posterUrl` is `https://image.mux.com/{playbackId}/thumbnail.jpg?token=…`
  with `width` and `time` in the JWT claims (Mux requires thumbnail options
  in the claims, never the query string).
- Memory card `heroUrl` and mosaic tile `url`: a video hero returns its
  `posterUrl`, never the video URL (today a video hero sends the raw video
  URL to `<Image>`).
- `GET /api/media/limits` drops `transcribeMaxVideoSeconds`.
- Tokens follow `READ_URL_TTL_SECONDS`; a video token's `exp` also covers
  the clip's duration.

### Tasks

#### M0. Mux account (human)
Create a Mux account with two environments, **Development** and
**Production**. In each: an access token with Mux Video read/write, a URL
signing key, and a webhook pointing at `https://<host>/api/webhooks/mux`
(Production: the Fly app; Development: skip, or a tunnel). Set
`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`,
`MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE` (base64 PEM) in `.env` and as
Fly secrets. Afterwards `fly secrets unset DEEPGRAM_API_KEY`.

#### M1. Server: Mux pipeline
**Do:**
- Dependency: `@mux/mux-node` (official SDK: uploads, asset API, webhook
  signature verification and playback JWT signing in one place).
- `server/src/media-host/`: a small `MediaHost` module wrapping the SDK
  (create upload, get upload, get asset, request subtitles, sign playback /
  thumbnail / text URLs). No local stand-in: dev uses the Mux Development
  environment, and the server refuses AV uploads with a clear 503 when the
  Mux env is missing.
- Schema + migration: a `MuxAsset` row per upload (`uploadId` unique,
  `familyId`, `assetId?` unique, `playbackId?`, `status`, `durationS?`,
  `width?`, `height?`, `captionTrackId?`, `transcript?`, timestamps), written
  by init, finalize, webhooks and the sync job. `Media.muxAssetId` links a
  clip to it. `MediaStatus` gains `PROCESSING`. `TranscriptStatus.SKIPPED`
  goes away. Soft-delete legacy AV rows (see the decision).
- **Order-independent:** the asset can become ready (and its captions too)
  before or after `POST /memories` links it to a memory. Whichever happens
  second copies duration/dimensions/transcript onto the Media row and runs
  the existing `offerToMemory` merge (a human-edited transcript is never
  overwritten).
- `POST /api/webhooks/mux`: raw body, mounted before `express.json`,
  signature verified, idempotent. Handles `video.upload.asset_created`,
  `video.asset.ready`, `video.asset.errored`, `video.asset.track.ready`
  (`text_source: "generated_vod"`), and the static-rendition ready event for
  audio. Anything that calls Mux back (fetching the `.txt` transcript) runs as
  a `mux.sync` job, not in the request.
- `mux.sync` job, enqueued at finalize: polls the upload/asset with backoff
  until the asset and its caption track settle. It's the safety net for
  missed webhooks and what makes local dev work without a tunnel.
- Transcript retry route now calls Mux's `generate-subtitles` on the asset's
  audio track. Delete `DeepgramTranscriber`, `StubTranscriber`, the
  `Transcriber` interface if nothing else uses it, `jobs/transcribe.ts`'s
  handler and `TRANSCRIBE_MAX_VIDEO_SECONDS`.
- DTOs per the contract (`serialize.ts`, `mosaic.ts`, `memory-detail.ts`).
- `README.md`: replace "Background jobs and transcription" and the AV parts
  of Storage with a Mux section (env table, webhook, dev without a tunnel).
  `fly.toml` and `docker-compose.yml` env comments.

**Verify while building** (unknowns from the docs): captions are generated
for audio-only assets; WebM/Opus audio and WebM video from the web recorders
ingest cleanly; a native `File.upload` single PUT works against a Mux upload
URL.

**Accept:** with Development credentials and no tunnel, upload a video and
an audio clip through `/api/media/init` → PUT → finalize → `POST /memories`;
both reach READY, the video DTO has a poster that loads, both URLs play, and
transcripts land on the memory. Replaying a webhook changes nothing.

**As built (2026-10-22):**
- Code: `server/src/media-host/` (`MediaHost` interface, `MuxMediaHost` over
  `@mux/mux-node` 15.5, `assets.ts` for the row merges, linking and
  `offerToMemory`), `jobs/mux-sync.ts`, `routes/webhooks.ts`; Deepgram, the
  stubs, `ai/` and `jobs/transcribe.ts` are gone. Migration
  `20261022120000_mux`. Compose's anonymous `node_modules` volume needs
  `--renew-anon-volumes` for the new dependency.
- `MuxAsset` has the planned fields plus `type`, `mimeType`, `bytes` (Mux
  doesn't report them back), Mux's raw `uploadStatus` / `assetStatus` /
  `renditionStatus`, `audioTrackId`, `captionStatus`, `error`,
  `syncGaveUpAt`. Each writer merges facts under a row lock (a terminal Mux
  status never reverts) and `status` is computed from them, which is what
  makes replays and out-of-order webhooks no-ops. `POST /memories` locks the
  rows while it creates the Media rows, then settles them itself.
- Contract as written, with these specifics: init answers
  `{ uploadId, key: "mux:<uploadId>", mimeType, target: { url, method: "PUT",
  headers: {}, expiresAt } }` (no Origin → `cors_origin: "*"`; an Origin this
  API wouldn't allow → `403 origin_not_allowed`). Finalize keeps today's
  wrapper: `{ media: { key, type, mimeType, bytes, sha256: null,
  checksum: null } }`; it waits up to 8 s for a just-finished PUT
  (`409 upload_incomplete` after that, `422 upload_failed` for an
  errored/timed-out upload). `status` and `posterUrl` are on **every** media
  item (photos `READY`, `posterUrl: null`). Audio falls back to the HLS URL
  if Mux skips or fails the `audio.m4a` rendition. Media items now exclude
  soft-deleted rows (they didn't before). Without Mux env: AV init and
  finalize `503 av_unavailable`, `/api/health` has `mux: false`.
- Video hero while PROCESSING: memory-card `heroUrl` and mosaic `url` are the
  signed poster URL as soon as Mux has given the asset a playback id (finalize
  reads the asset once, so that's almost always before the memory exists).
  It fails to load until Mux has a frame, so the client's teal tile shows
  through. With no playback id yet, or a FAILED video, the hero falls back to
  the next photo, then the generated `/media/gen` image.
- Posters: `width: 1200`, `time` 2 s (or half a shorter clip), in the JWT
  claims. Tokens: `exp` = `READ_URL_TTL_SECONDS` + clip duration + 10 min,
  and each signed URL is reused for 10 min so URLs stay cache-stable.
- `POST /memories` rejects an AUDIO/VIDEO `storageKey` that isn't `mux:`
  (`400 av_requires_mux`), a `mux:` key of the wrong type
  (`400 type_mismatch`) and one never finalized (`409 upload_not_finalized`).
- Transcript retry: `202` when re-requested (or already pending), `409`
  `already_transcribed` / `not_ready` / `not_transcribable`, `409`/`502`
  `retry_refused` when Mux says no. Found against real Mux: generate-subtitles
  refuses a language an existing generated track already has, so the retry
  re-reads a ready/preparing caption track and only regenerates after
  deleting the *errored* caption tracks (text tracks only; no asset is ever
  deleted).
- `mux.sync` polls every 3 s for 2 min, 10 s to 15 min, 30 s to 1 h, then
  every 2 min, giving up at 6 h (pending parts → FAILED; a later webhook still
  fixes it). At most one queued job per asset: new reasons pull it forward.
- Verified with the Development environment, no tunnel: an H.264 MP4, an
  HEVC `.mov` and an AAC `.m4a` (speech from macOS `say`) each went init →
  single plain PUT → finalize → `POST /memories` → READY in 8–14 s, with
  transcripts on media and memory. Captions **are** generated for audio-only
  assets. HLS master, variant and segments, `audio.m4a` and the poster (1200
  px) load with the token; unsigned URLs get 403. Webhooks verified locally
  with HMAC-signed payloads (bad/stale signature 400, replay and late
  `preparing` events change nothing, ready-before and ready-after the memory
  both link, typed transcripts survive). **Not verified:** WebM/Opus from the
  web recorders (no encoder on the build machine) and a native
  `File.upload` PUT from the phone — the server side is the same plain PUT
  that worked from Node.

#### M2. Client: Mux playback and stills
**Do:**
- `uploadFile()` keeps init → PUT → finalize; adjust only what the contract
  changes. Compose drops the "over N, not transcribed" warning.
- Video: native `expo-video` plays the HLS URL as is. Web: `hls.js` (Chrome
  and Firefox can't play HLS natively; Safari can, so use it only when
  `canPlayType("application/vnd.apple.mpegurl")` is empty) inside the
  existing `<video>`, keeping `VideoControls`. Applies to `video.web.tsx` and
  `hero-video.web.tsx`.
- `VideoStill` (both platforms) renders `posterUrl` with `<Image>` and keeps
  the teal tile only while PROCESSING or when there's no poster. Drop the
  per-row `<video>` on web. `CardArt`'s video-only play glyph uses the poster
  too.
- Audio plays the `audio.m4a` URL through the existing `expo-audio` player.
- PROCESSING state: the memory page shows "Preparing video…" / "Preparing
  audio…" in place of the player and polls like the transcript does. Remove
  the SKIPPED copy.
- `VideoFallback` stays for FAILED only.

**Accept:** memory rows, mosaic tiles and gallery thumbs show posters
without loading video; video plays in Chrome, Safari and Expo Go; audio plays
on web and phone.

As built: `hls.js` 1.7.3 (Chrome/Firefox lack native HLS) lives behind
`src/components/web-hls.ts`, imported only by the `.web.tsx` players and
loaded lazily (its own web chunk). Current desktop Chrome reports native HLS
(`canPlayType` → "maybe") and plays the stream itself; hls.js runs where it
says "". Native passes `contentType: "hls"` to expo-video for `.m3u8` URLs
(`src/playback.ts`). The hero shows `posterUrl` until first play (web: the
`poster` attribute; phone: an `<Image>` over the player). Client-side
assumptions where the contract is silent (all in `src/api.ts`): `status` may
be missing on photos and is read through `mediaStatus()` (photo → READY; a
clip with no status → READY if it has a url, else PROCESSING); `posterUrl`
is optional; init's `target.headers`, `expiresAt` and `uploadId` are optional;
finalize's `sha256`/`checksum` are optional (absent for `mux:` keys); a
video-only memory's `heroUrl` is drawn over the teal tile, so whatever the
server sends while PROCESSING shows through. Polling (3 s) runs while any
clip is PROCESSING or the transcript is PENDING. A player error on a READY
clip shows "can't play right now" with Try again (refetch for a fresh token,
then a new player); FAILED shows "couldn't prepare" with no retry. The
"Open original" link is gone (there's no original file to open).

#### M3. Walkthrough
Fresh database, web and phone: record a video, record audio, pick an iPhone
HEVC video from the library. Each shows "Preparing…", then a poster, plays,
and gets a transcript. Deploy to Fly with Production credentials and repeat
once there (webhooks live, not just the sync job).

Order: **M0** (human) ∥ **M1 ∥ M2** against the contract, then M3.

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
