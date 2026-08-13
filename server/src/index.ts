import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { prisma } from "./lib/prisma.js";
import { familyRouter } from "./routes/family.js";
import { homeRouter } from "./routes/home.js";
import { libraryRouter } from "./routes/library.js";
import { MEDIA_DIR, mediaRouter } from "./routes/media.js";
import { memoriesRouter } from "./routes/memories.js";
import { mosaicRouter } from "./routes/mosaic.js";
import { peopleRouter } from "./routes/people.js";
import { searchRouter } from "./routes/search.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// No auth in v0: the API is wide open to whatever runs on localhost.
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health sits above the password gate so the platform can probe it.
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(503).json({ ok: false, db: false, error: (err as Error).message });
  }
});

/**
 * One shared password for the hosted demo, off unless DEMO_PASSWORD is set.
 * This is a curtain, not a lock — there are still no accounts, and everyone
 * past it shares the same family. Real auth replaces this entirely.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (DEMO_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    if (scheme === "Basic" && encoded) {
      const [, password] = Buffer.from(encoded, "base64").toString().split(":");
      if (password === DEMO_PASSWORD) return next();
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="Keepsake demo"');
    res.status(401).send("Keepsake demo — password required.");
  });
  console.log("Demo password gate is ON");
}

app.use("/api", homeRouter);
app.use("/api", peopleRouter);
app.use("/api", libraryRouter);
app.use("/api", memoriesRouter);
app.use("/api", mosaicRouter);
app.use("/api", searchRouter);
app.use("/api", familyRouter);

app.use("/media/uploads", express.static(path.join(MEDIA_DIR, "uploads"), { maxAge: "1y" }));
app.use("/media", mediaRouter);
app.use("/api/media", mediaRouter);

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
  console.log(`Serving web bundle from ${WEB_DIR}`);
}

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Keepsake API listening on http://localhost:${PORT}`);
});
