-- A7: hard delete, no trash. Memory.deletedAt and Media.deletedAt go away.
--
-- Rows that were soft-deleted are deleted for real first (a memory takes its
-- media, participants, collection links, favourites and links with it by
-- cascade). Their stored files and any Mux assets are deliberately left where
-- they are: only deletes made through the app from now on enqueue a purge.
-- MuxAsset rows those media pointed at are left too, unlinked, so their ids
-- survive for a manual clean-up.

DELETE FROM "Media" WHERE "deletedAt" IS NOT NULL;
DELETE FROM "Memory" WHERE "deletedAt" IS NOT NULL;

DROP INDEX IF EXISTS "Memory_familyId_deletedAt_idx";

ALTER TABLE "Memory" DROP COLUMN "deletedAt";
ALTER TABLE "Media" DROP COLUMN "deletedAt";
