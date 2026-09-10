-- AlterTable
-- Full-text search over Memory: a STORED generated column combining
-- title/location/story/transcript into a single weighted tsvector, kept in
-- sync by Postgres itself on every insert/update. Weights (A highest, D
-- lowest) bias ts_rank_cd toward matches in the title, then location, then
-- the story, then the transcript.
ALTER TABLE "Memory" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("location", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("story", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("transcript", '')), 'D')
  ) STORED;

-- CreateIndex
CREATE INDEX "Memory_searchVector_idx" ON "Memory" USING GIN ("searchVector");
