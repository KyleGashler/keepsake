import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors, { type CorsOptions } from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { createTokenVerifier } from "./auth/index.js";
import { startWorker, type JobQueue } from "./jobs/index.js";
import { requireFamily, requireUser } from "./auth/middleware.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { accountRouter } from "./routes/account.js";
import { familyRouter } from "./routes/family.js";
import { homeRouter } from "./routes/home.js";
import { libraryRouter } from "./routes/library.js";
import { MEDIA_DIR, mediaApiRouter, mediaBytesRouter } from "./routes/media.js";
import { memoriesRouter } from "./routes/memories.js";
import { mosaicRouter } from "./routes/mosaic.js";
import { peopleRouter } from "./routes/people.js";
import { searchRouter } from "./routes/search.js";
import { UPLOAD_URL_TTL_SECONDS, localProvider, storage } from "./storage/index.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const isProduction = process.env.NODE_ENV === "production";

// Before anything else: a misconfigured verifier must stop the boot, not
// quietly serve an open API. Throws in production unless dev auth is opted in.
const tokenVerifier = createTokenVerifier();

// Fly terminates TLS and forwards one X-Forwarded-For hop, so the rate
// limiters see the real client address rather than the proxy's.
if (isProduction) app.set("trust proxy", 1);

app.use(
  helmet({
    // The Expo web bundle (see the WEB_DIR block below) loads inline scripts
    // and styles that helmet's default policy blocks. Off until someone
    // measures what the bundle actually needs and writes a tuned CSP —
    // every other helmet default stays on.
    contentSecurityPolicy: false,
    // Media is served from the API origin but fetched by the app running on
    // Metro's origin in development, so the default `same-origin` would
    // block it.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

/**
 * CORS_ORIGINS is a comma-separated allowlist. Unset in development means
 * "allow anything", because Expo Go on a phone arrives from whatever LAN
 * address Metro picked. Unset in production means same-origin only — the
 * hosted build serves the web bundle from this same server.
 */
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions: CorsOptions =
  corsOrigins.length > 0 ? { origin: corsOrigins } : { origin: !isProduction };
app.use(cors(corsOptions));

app.use(
  pinoHttp({
    logger,
    // Honour an upstream request id when there is one so a trace survives the
    // proxy; otherwise mint one. Echoed back so clients can quote it.
    genReqId: (req, res) => {
      const header = req.headers["x-request-id"];
      const id = (Array.isArray(header) ? header[0] : header) || crypto.randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    // The platform health check runs every 15s; logging it drowns everything else.
    autoLogging: { ignore: (req) => req.url === "/api/health" },
  }),
);

app.use(express.json({ limit: "2mb" }));

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Generous enough that a person browsing the archive never notices it, low
// enough to blunt a scraper.
const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Uploads are the expensive path: they write to disk and hold a connection open.
const uploadLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Health sits above the password gate and the limiters so the platform can
// probe it however often it likes.
app.get("/api/health", async (_req, res) => {
  const [db, media] = await Promise.all([checkDatabase(), checkMedia()]);
  const ok = db && media;
  if (!ok) logger.warn({ db, media }, "health check failing");
  res.status(ok ? 200 : 503).json({ ok, db, media });
});

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, "health: database unreachable");
    return false;
  }
}

/** Local: the objects directory is writable. S3: the bucket answers HeadBucket. */
async function checkMedia(): Promise<boolean> {
  try {
    return await storage().healthCheck();
  } catch (err) {
    logger.error({ err }, "health: media storage unavailable");
    return false;
  }
}

app.use("/api/media/init", uploadLimiter);
app.use("/api/media/finalize", uploadLimiter);
app.use("/api", apiLimiter);

/**
 * Everything under /api needs an identity (health is registered above and so
 * escapes this). `/me` and `/families` are the two routes a signed-in person
 * can reach before belonging to an archive; every router past them is scoped
 * to exactly one family, and reads it from `req.ctx` rather than guessing.
 *
 * The middleware is mounted once rather than repeated per router so a request
 * verifies its token and resolves its membership a single time.
 */
const authenticated = requireUser(tokenVerifier);
app.use("/api", authenticated);
app.use("/api", accountRouter);

app.use("/api", requireFamily);
app.use("/api", homeRouter);
app.use("/api", peopleRouter);
app.use("/api", libraryRouter);
app.use("/api", memoriesRouter);
app.use("/api", mosaicRouter);
app.use("/api", searchRouter);
app.use("/api", familyRouter);
app.use("/api/media", mediaApiRouter);

/**
 * Media bytes are public: the client renders them as plain `<img>` URLs with
 * no way to attach a header. Generated placeholders are pure functions of a
 * seed, and uploaded originals are reachable only through signed, expiring
 * tokens in the path. The upload handshake itself lives under `/api/media`,
 * behind auth (mounted above) and the upload limiter.
 */
app.use("/media/uploads", express.static(path.join(MEDIA_DIR, "uploads"), { maxAge: "1y" }));
app.use("/media", mediaBytesRouter);

/**
 * In the hosted build the web bundle ships inside this image, so the app and
 * the API share an origin. Absent (as in local development) this is inert and
 * Metro serves the app on :8081 instead.
 */
const WEB_DIR = process.env.WEB_DIR;
if (WEB_DIR && fs.existsSync(WEB_DIR)) {
  const indexHtml = path.join(WEB_DIR, "index.html");
  app.use(express.static(WEB_DIR, { index: false, maxAge: "1h" }));
  // expo-router is a single-page app: any non-API path renders the same shell
  // and the client resolves the route.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
    res.sendFile(indexHtml);
  });
  logger.info({ webDir: WEB_DIR }, "serving web bundle");
}

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = req.id === undefined ? undefined : String(req.id);
  (req.log ?? logger).error({ err, requestId }, "unhandled error");
  // A stack trace is a map of the server; developers get it, the internet doesn't.
  res.status(500).json({ error: isProduction ? "Internal server error" : err.message, requestId });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, `Keepsake API listening on http://localhost:${PORT}`);
});

/**
 * Node ends any request that takes longer than `requestTimeout` (5 minutes by
 * default) to arrive in full. With the local provider, uploads come through
 * this server (`PUT /media/local-upload/…`), and a 2 GB video on a slow
 * uplink takes far longer than that. Give a request as long as an upload URL
 * lives. Headers still have to arrive within `headersTimeout`, so a client
 * that opens a socket and says nothing is still cut off quickly. With S3 the
 * bytes go to the bucket and the default stands.
 */
if (localProvider()) server.requestTimeout = UPLOAD_URL_TTL_SECONDS * 1000;

/**
 * One process doing both jobs, for dev and the single Fly machine. Without
 * it, jobs wait in the table until `npm run worker` picks them up.
 */
const worker: JobQueue | null = process.env.WORKER_INLINE === "1" ? startWorker() : null;

/**
 * Fly sends SIGTERM and waits before killing the machine. Stop taking new
 * connections and new jobs, let in-flight work finish, then let go of the
 * database.
 */
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  const forceExit = setTimeout(() => {
    logger.error("shutdown timed out after 10s — forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  // Stop claiming at once; a job already running gets until the force-exit,
  // and one cut off there is reclaimed once its lock goes stale.
  const workerStopped = worker?.stop().catch((err) => logger.error({ err }, "error stopping job worker"));

  server.close(async (err) => {
    if (err) logger.error({ err }, "error closing http server");
    try {
      await workerStopped;
      await prisma.$disconnect();
    } catch (disconnectErr) {
      logger.error({ err: disconnectErr }, "error disconnecting prisma");
    }
    clearTimeout(forceExit);
    logger.info("shutdown complete");
    process.exit(0);
  });
  // Keep-alive sockets would otherwise hold server.close() open until timeout.
  server.closeIdleConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
