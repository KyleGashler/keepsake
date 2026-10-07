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

- The 100 MB upload cap stays. Longer or 4K phone videos are rejected; the
  client must say so clearly before uploading, not after.
- Single presigned PUT, no multipart or resumable upload.
- No transcoding. HEVC `.mov` from iPhones won't play in some browsers or on
  some Android devices; the memory page shows a download/open fallback.
- No adaptive streaming and no CDN; playback is slower over cellular.

**Revisit before launch** (one task, swap-in behind A6's job queue): raise the
cap with multipart uploads; transcode to H.264 MP4/HLS (Mux, Cloudflare Stream,
MediaConvert or an ffmpeg worker); CloudFront or R2 for egress; lifecycle
originals to an infrequent-access tier (transition, never expire).

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
