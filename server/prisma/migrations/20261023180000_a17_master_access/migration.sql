-- A17: per-memory download. A video's file comes from Mux temporary master
-- access; these record the request and its 24-hour URL.
ALTER TABLE "MuxAsset" ADD COLUMN "masterStatus" TEXT,
ADD COLUMN "masterUrl" TEXT,
ADD COLUMN "masterExpiresAt" TIMESTAMP(3),
ADD COLUMN "masterCheckedAt" TIMESTAMP(3);
