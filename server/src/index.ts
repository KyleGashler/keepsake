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

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(503).json({ ok: false, db: false, error: (err as Error).message });
  }
});

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

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Keepsake API listening on http://localhost:${PORT}`);
});
