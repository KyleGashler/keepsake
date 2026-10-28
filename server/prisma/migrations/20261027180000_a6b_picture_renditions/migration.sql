-- A6 follow-up: renditions for profile photos and pillar covers, which hold
-- an upload's storage key rather than a Media row. Each records which key its
-- renditions were made from, so a replaced photo never serves stale ones.
ALTER TABLE "Person" ADD COLUMN "photoDerivedKey" TEXT;
ALTER TABLE "PillarCover" ADD COLUMN "derivedKey" TEXT;
