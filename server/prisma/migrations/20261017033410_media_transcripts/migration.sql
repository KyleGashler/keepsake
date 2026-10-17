-- Per-clip transcripts for AUDIO and VIDEO media (task C1).
--
-- Hand-trimmed: `prisma migrate dev` also wants to drop the search GIN index
-- and the generated column's expression, because neither can be modelled in
-- schema.prisma (see the memory_search_vector migration). Those statements are
-- removed here and must be removed from any future generated migration too.

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptStatus" "TranscriptStatus";
