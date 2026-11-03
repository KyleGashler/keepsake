import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

/** The run's database (vitest.config.ts names it): created and migrated before the tests, dropped after. */
function target() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is unset (vitest.config.ts sets it)");
  const parsed = new URL(url);
  const name = parsed.pathname.slice(1);
  if (!/^test_[a-z0-9_]+$/.test(name)) throw new Error(`Refusing to manage a database not named test_*: ${name}`);
  parsed.pathname = "/postgres";
  return { url, name, admin: parsed.toString() };
}

async function onServer(sql: string) {
  const admin = new PrismaClient({ datasourceUrl: target().admin });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}

export async function setup() {
  const { url, name } = target();
  await onServer(`CREATE DATABASE "${name}"`);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
}

export async function teardown() {
  await onServer(`DROP DATABASE IF EXISTS "${target().name}" WITH (FORCE)`);
  const media = process.env.TEST_MEDIA_DIR;
  if (media) fs.rmSync(media, { recursive: true, force: true });
}
