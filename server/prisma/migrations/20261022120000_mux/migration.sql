-- Video and audio move to Mux (docs/PLAN.md, "Decision: Mux for video and
-- audio"). Photos stay in the StorageProvider.

-- Legacy AV clips: uploaded to our own storage (an S3/local `storageKey`, or a
-- pre-A5 `/media/uploads/*` url) before Mux. No backfill: the rows are
-- soft-deleted so nothing tries to play them, and their objects are left
-- exactly where they are. Generated placeholders (`/media/gen/*`) are kept.
UPDATE "Media"
SET "deletedAt" = CURRENT_TIMESTAMP
WHERE "type" IN ('AUDIO', 'VIDEO')
  AND "deletedAt" IS NULL
  AND ("storageKey" IS NOT NULL OR "url" LIKE '/media/uploads/%');

-- SKIPPED (a video too long for Deepgram) goes away; only legacy rows, all
-- soft-deleted above, can hold it.
UPDATE "Media" SET "transcriptStatus" = 'FAILED' WHERE "transcriptStatus" = 'SKIPPED';

-- AlterEnum
ALTER TYPE "MediaStatus" ADD VALUE 'PROCESSING';

-- AlterEnum
CREATE TYPE "TranscriptStatus_new" AS ENUM ('PENDING', 'READY', 'FAILED');
ALTER TABLE "Media" ALTER COLUMN "transcriptStatus" TYPE "TranscriptStatus_new" USING ("transcriptStatus"::text::"TranscriptStatus_new");
ALTER TYPE "TranscriptStatus" RENAME TO "TranscriptStatus_old";
ALTER TYPE "TranscriptStatus_new" RENAME TO "TranscriptStatus";
DROP TYPE "TranscriptStatus_old";

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "muxAssetId" TEXT;

-- CreateTable
CREATE TABLE "MuxAsset" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "assetId" TEXT,
    "playbackId" TEXT,
    "type" "MediaType" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "uploadStatus" TEXT NOT NULL DEFAULT 'waiting',
    "assetStatus" TEXT,
    "renditionStatus" TEXT,
    "durationS" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "audioTrackId" TEXT,
    "captionTrackId" TEXT,
    "captionStatus" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "transcript" TEXT,
    "error" TEXT,
    "syncGaveUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MuxAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MuxAsset_uploadId_key" ON "MuxAsset"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "MuxAsset_assetId_key" ON "MuxAsset"("assetId");

-- CreateIndex
CREATE INDEX "MuxAsset_familyId_idx" ON "MuxAsset"("familyId");

-- CreateIndex
CREATE INDEX "Media_muxAssetId_idx" ON "Media"("muxAssetId");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_muxAssetId_fkey" FOREIGN KEY ("muxAssetId") REFERENCES "MuxAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuxAsset" ADD CONSTRAINT "MuxAsset_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
