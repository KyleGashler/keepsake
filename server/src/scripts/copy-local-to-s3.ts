// Ignores STORAGE_PROVIDER, so it can run on a box still serving from disk. Never overwrites: existing
// objects are skipped and size mismatches reported. Legacy `MEDIA_DIR/uploads` files are counted, not copied.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "../lib/errors.js";
import { contentTypeForKey } from "../lib/mime.js";
import { prisma } from "../lib/prisma.js";
import { MEDIA_DIR, OBJECTS_DIR } from "../storage/LocalDiskProvider.js";
import { S3StorageProvider, s3ConfigFromEnv } from "../storage/S3StorageProvider.js";
import { assertSafeKey } from "../storage/StorageProvider.js";

const dryRun = process.argv.includes("--dry-run");

async function* walk(dir: string, prefix = ""): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(path.join(dir, entry.name), rel);
    else if (entry.isFile()) yield rel;
  }
}

async function countFiles(dir: string) {
  let n = 0;
  for await (const _ of walk(dir)) n++;
  return n;
}

async function main() {
  const config = s3ConfigFromEnv();
  const s3 = new S3StorageProvider(config);

  const summary = {
    scanned: 0,
    uploaded: 0,
    wouldUpload: 0,
    alreadyPresent: 0,
    sizeMismatch: 0,
    skipped: 0,
    failed: 0,
  };

  const rows = await prisma.media.findMany({
    where: { storageKey: { not: null } },
    select: { storageKey: true, mimeType: true },
  });
  const mimeByKey = new Map(rows.flatMap((r) => (r.storageKey ? [[r.storageKey, r.mimeType] as const] : [])));

  console.log(`${dryRun ? "[dry run] " : ""}copying ${OBJECTS_DIR} → s3://${config.bucket}`);

  for await (const key of walk(OBJECTS_DIR)) {
    summary.scanned++;
    const file = path.join(OBJECTS_DIR, ...key.split("/"));

    // An interrupted local upload leaves `<key>.<uuid>.part`; it was never an object.
    if (key.endsWith(".part")) {
      summary.skipped++;
      console.log(`skip  ${key} (partial upload)`);
      continue;
    }
    try {
      assertSafeKey(key);
    } catch (err) {
      summary.skipped++;
      console.log(`skip  ${key} (${errorMessage(err)})`);
      continue;
    }

    try {
      const { size } = await fsp.stat(file);
      const existing = await s3.head(key);
      if (existing) {
        if (existing.bytes !== size) {
          summary.sizeMismatch++;
          console.log(`WARN  ${key} is ${size} bytes on disk but ${existing.bytes} in the bucket — left alone`);
        } else {
          summary.alreadyPresent++;
        }
        continue;
      }

      const contentType = mimeByKey.get(key) ?? contentTypeForKey(key);
      if (dryRun) {
        summary.wouldUpload++;
        console.log(`would upload ${key} (${size} bytes, ${contentType})`);
        continue;
      }

      const result = await s3.putOriginalIfAbsent({
        key,
        body: fs.createReadStream(file),
        bytes: size,
        contentType,
      });
      if (result === "created") {
        summary.uploaded++;
        console.log(`put   ${key} (${size} bytes, ${contentType})`);
      } else {
        summary.alreadyPresent++;
      }
    } catch (err) {
      summary.failed++;
      console.error(`FAIL  ${key}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    }
  }

  const legacyFiles = await countFiles(path.join(MEDIA_DIR, "uploads"));
  const legacyRows = await prisma.media.count({
    where: { storageKey: null, url: { startsWith: "/media/uploads/" } },
  });

  console.log("\nsummary");
  console.log(`  scanned          ${summary.scanned}`);
  if (dryRun) console.log(`  would upload     ${summary.wouldUpload}`);
  else console.log(`  uploaded         ${summary.uploaded}`);
  console.log(`  already present  ${summary.alreadyPresent}`);
  console.log(`  size mismatch    ${summary.sizeMismatch}`);
  console.log(`  skipped          ${summary.skipped}`);
  console.log(`  failed           ${summary.failed}`);
  console.log(
    `  legacy uploads   ${legacyFiles} file(s) in ${path.join(MEDIA_DIR, "uploads")}, ` +
      `${legacyRows} Media row(s) pointing at /media/uploads/* — not copied, still served from the volume`,
  );

  if (summary.failed > 0 || summary.sizeMismatch > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
