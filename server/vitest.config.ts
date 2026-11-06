import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Set before any test imports lib/prisma.ts or the storage provider, which read them once.
const base = process.env.TEST_DATABASE_BASE_URL ?? "postgresql://littlebylittle:littlebylittle@localhost:55432";
process.env.TEST_DATABASE_URL ??= `${base}/test_${Date.now().toString(36)}_${process.pid}`;
process.env.TEST_MEDIA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbl-test-media-"));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      MEDIA_DIR: process.env.TEST_MEDIA_DIR,
      STORAGE_PROVIDER: "local",
      LOG_LEVEL: "silent",
    },
    // One database for the run: files take turns.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
