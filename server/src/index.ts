import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors, { type CorsOptions } from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { createTokenVerifier } from "./auth/index.js";
import { emailSender } from "./email/index.js";
import { startWorker, type JobQueue } from "./jobs/index.js";
import { requireFamily, requireUser } from "./auth/middleware.js";
import { corsOrigins } from "./lib/cors-origins.js";
import { isForeignKeyViolation } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { MediaInputError } from "./lib/memory-media.js";
import { prisma } from "./lib/prisma.js";
import { mediaHost } from "./media-host/index.js";
import { accountRouter } from "./routes/account.js";
import { birthdaysRouter } from "./routes/birthdays.js";
import { familyRouter } from "./routes/family.js";
import { homeRouter } from "./routes/home.js";
import { inviteAcceptRouter, invitePreviewRouter } from "./routes/invites.js";
import { libraryRouter } from "./routes/library.js";
import { MEDIA_DIR, mediaApiRouter, mediaBytesRouter } from "./routes/media.js";
import { memoriesRouter } from "./routes/memories.js";
import { mosaicRouter } from "./routes/mosaic.js";
import { peopleRouter } from "./routes/people.js";
import { searchRouter } from "./routes/search.js";
import { timelineRouter } from "./routes/timeline.js";
import { muxWebhookRouter } from "./routes/webhooks.js";
import { UPLOAD_URL_TTL_SECONDS, localProvider, storage } from "./storage/index.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const isProduction = process.env.NODE_ENV === "production";

// Must run first: a misconfigured verifier has to stop the boot, not serve an open API.
const tokenVerifier = createTokenVerifier();

mediaHost();
emailSender();

// Fly terminates TLS and forwards one X-Forwarded-For hop; the rate limiters need the client address.
if (isProduction) app.set("trust proxy", 1);

app.use(
  helmet({
    // The Expo web bundle loads inline scripts and styles that helmet's default CSP blocks.
    contentSecurityPolicy: false,
    // In development the app runs on Metro's origin; `same-origin` would block media.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

const corsOptions: CorsOptions =
  corsOrigins.length > 0 ? { origin: corsOrigins } : { origin: !isProduction };
app.use(cors(corsOptions));

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const header = req.headers["x-request-id"];
      const id = (Array.isArray(header) ? header[0] : header) || crypto.randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === "/api/health" },
  }),
);

// Before `express.json` (Mux signs the raw bytes) and before auth (the signature is Mux's credential).
app.use("/api/webhooks/mux", muxWebhookRouter);

app.use(express.json({ limit: "2mb" }));

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.get("/api/health", async (_req, res) => {
  const [db, media] = await Promise.all([checkDatabase(), checkMedia()]);
  const ok = db && media;
  if (!ok) logger.warn({ db, media }, "health check failing");
  res.status(ok ? 200 : 503).json({ ok, db, media, mux: mediaHost() !== null });
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

// Order is the access policy: routes above `authenticated` are public, and
// routes above `requireFamily` are reachable before joining a family.
app.use("/api", invitePreviewRouter);

const authenticated = requireUser(tokenVerifier);
app.use("/api", authenticated);
app.use("/api", accountRouter);
app.use("/api", inviteAcceptRouter);

app.use("/api", requireFamily);
app.use("/api", homeRouter);
app.use("/api", peopleRouter);
app.use("/api", libraryRouter);
app.use("/api", birthdaysRouter);
app.use("/api", memoriesRouter);
app.use("/api", mosaicRouter);
app.use("/api", timelineRouter);
app.use("/api", searchRouter);
app.use("/api", familyRouter);
app.use("/api/media", mediaApiRouter);

// Public because `<img>` can't send an auth header; originals are reachable
// only through signed, expiring tokens in the path.
app.use("/media/uploads", express.static(path.join(MEDIA_DIR, "uploads"), { maxAge: "1y" }));
app.use("/media", mediaBytesRouter);

const WEB_DIR = process.env.WEB_DIR;
if (WEB_DIR && fs.existsSync(WEB_DIR)) {
  const indexHtml = path.join(WEB_DIR, "index.html");
  app.use(express.static(WEB_DIR, { index: false, maxAge: "1h" }));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
    res.sendFile(indexHtml);
  });
  logger.info({ webDir: WEB_DIR }, "serving web bundle");
}

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use(async (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = typeof req.id === "string" ? req.id : undefined;
  // `req.ctx` is declared but unset before requireUser runs.
  const ctx: Partial<express.Request["ctx"]> | undefined = req.ctx;
  const familyId = ctx?.family?.id;
  if (err instanceof MediaInputError) {
    if (!res.headersSent) res.status(err.status).json(err.body);
    return;
  }
  if (isForeignKeyViolation(err) && familyId && !(await familyExists(familyId))) {
    (req.log ?? logger).info({ familyId, requestId }, "request raced its family's deletion");
    if (!res.headersSent) res.status(403).json({ error: "forbidden" });
    return;
  }
  (req.log ?? logger).error({ err, requestId }, "unhandled error");
  res.status(500).json({ error: isProduction ? "Internal server error" : err.message, requestId });
});

async function familyExists(id: string) {
  try {
    return (await prisma.family.count({ where: { id } })) > 0;
  } catch {
    return true;
  }
}

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, `little by little API listening on http://localhost:${PORT}`);
});

// Node's default 5-minute `requestTimeout` cuts off large uploads through the
// local provider; `headersTimeout` still drops idle sockets quickly.
if (localProvider()) server.requestTimeout = UPLOAD_URL_TTL_SECONDS * 1000;

const worker: JobQueue | null = process.env.WORKER_INLINE === "1" ? startWorker() : null;

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

  // A job cut off by the force-exit is reclaimed once its lock goes stale.
  const workerStopped = worker?.stop().catch((err: unknown) => logger.error({ err }, "error stopping job worker"));

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
