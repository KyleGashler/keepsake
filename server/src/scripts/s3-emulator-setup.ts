/**
 * One-shot setup for the local S3 emulator (`s3-init` in docker-compose.yml):
 * create the bucket, turn versioning on, allow the app's origins to PUT/GET.
 * Idempotent, and it waits for the emulator to come up first.
 *
 * Emulator only. It refuses to run without `S3_ENDPOINT`, so it can't be
 * pointed at a real AWS bucket by accident — that bucket is configured by hand
 * from docs/aws/ (README, "Storage").
 *
 *   npm run storage:s3-setup
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { s3ConfigFromEnv } from "../storage/S3StorageProvider.js";

const config = s3ConfigFromEnv();
if (!config.endpoint) {
  console.error("S3_ENDPOINT is unset. This script only sets up a local emulator; configure AWS by hand (README, Storage).");
  process.exit(1);
}

const client = new S3Client({
  region: config.region,
  endpoint: config.endpoint,
  forcePathStyle: config.forcePathStyle,
});
const Bucket = config.bucket;
const origins = (process.env.S3_CORS_ORIGINS ?? "http://localhost:8081")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function bucketState(): Promise<"exists" | "missing"> {
  try {
    await client.send(new HeadBucketCommand({ Bucket }));
    return "exists";
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return "missing";
    throw err;
  }
}

async function waitForEmulator() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await bucketState();
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`waiting for ${config.endpoint} (${(err as Error).name})…`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const state = await waitForEmulator();
if (state === "missing") {
  await client.send(new CreateBucketCommand({ Bucket }));
  console.log(`created bucket ${Bucket}`);
} else {
  console.log(`bucket ${Bucket} already exists`);
}

// Production's bucket is versioned; the emulator matches so finalize's
// version check sees the same thing it will in AWS.
await client.send(
  new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: "Enabled" } }),
);
console.log("versioning enabled");

// Mirrors docs/aws/cors.json, with the origins from S3_CORS_ORIGINS.
await client.send(
  new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ["GET", "HEAD", "PUT"],
          AllowedHeaders: ["content-type", "if-none-match", "range"],
          ExposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(`CORS allows ${origins.join(", ")}`);
