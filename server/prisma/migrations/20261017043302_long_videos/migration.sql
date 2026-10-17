-- Long videos (task C4): a SKIPPED transcript status for videos over
-- TRANSCRIBE_MAX_VIDEO_SECONDS, and storage's own checksum per original.
--
-- Hand-trimmed: `prisma migrate dev` also wants to drop the search GIN index
-- and the generated column's expression, because neither can be modelled in
-- schema.prisma (see the memory_search_vector migration). Those statements are
-- removed here and must be removed from any future generated migration too.
--
-- `ADD VALUE` runs inside the migration's transaction, which Postgres 12+
-- allows as long as nothing in that same transaction uses the new value.
-- Nothing here does: rows are only set SKIPPED by the app, after commit.

-- AlterEnum
ALTER TYPE "TranscriptStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "checksum" TEXT;
