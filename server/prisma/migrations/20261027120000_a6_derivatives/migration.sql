-- A6: photo derivatives, EXIF dates and a real palette.
--
-- Where a memory's date came from. Existing rows are HUMAN: before this,
-- every date was chosen in the compose screen (or left at its default, which
-- can't be told apart), so no job may move one.
CREATE TYPE "DateSource" AS ENUM ('DEFAULT', 'EXIF', 'HUMAN');

ALTER TABLE "Memory" ADD COLUMN "occurredAtSource" "DateSource" NOT NULL DEFAULT 'HUMAN';

-- A photo's EXIF capture day, read by the media.derive job.
ALTER TABLE "Media" ADD COLUMN "capturedAt" TIMESTAMP(3);
