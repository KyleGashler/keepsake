-- Library journey (task L1): collection kind/icon/colour, child profile
-- photos, custom pillar covers, per-user favourites and manual memory links.
--
-- Hand-trimmed: `prisma migrate dev` also wants to drop the search GIN index
-- and the generated column's expression, because neither can be modelled in
-- schema.prisma (see the memory_search_vector migration). Those statements
-- are removed. Hand-added: the link ordering CHECK, and a backfill of icons and
-- colours for the default Arrival Stories / Family Life collections. Child
-- Profile defaults are adopted by ensureChildCollections at boot instead.

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#123F45',
ADD COLUMN     "icon" TEXT NOT NULL DEFAULT 'star',
ADD COLUMN     "kind" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "photoKey" TEXT;

-- CreateTable
CREATE TABLE "PillarCover" (
    "familyId" TEXT NOT NULL,
    "pillar" "Pillar" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PillarCover_pkey" PRIMARY KEY ("familyId","pillar")
);

-- CreateTable
CREATE TABLE "MemoryFavorite" (
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryFavorite_pkey" PRIMARY KEY ("userId","memoryId")
);

-- CreateTable
CREATE TABLE "MemoryLink" (
    "memoryId" TEXT NOT NULL,
    "linkedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryLink_pkey" PRIMARY KEY ("memoryId","linkedId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_personId_kind_key" ON "Collection"("personId", "kind");

-- CreateIndex
CREATE INDEX "MemoryFavorite_memoryId_idx" ON "MemoryFavorite"("memoryId");

-- CreateIndex
CREATE INDEX "MemoryLink_linkedId_idx" ON "MemoryLink"("linkedId");

-- AddForeignKey
ALTER TABLE "PillarCover" ADD CONSTRAINT "PillarCover_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFavorite" ADD CONSTRAINT "MemoryFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFavorite" ADD CONSTRAINT "MemoryFavorite_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_linkedId_fkey" FOREIGN KEY ("linkedId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A link is stored once, smaller id first, and never to itself.
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_ordered_check" CHECK ("memoryId" < "linkedId");

-- Backfill: glyphs and colours for the seeded default collections.
UPDATE "Collection" AS c SET "icon" = v.icon, "color" = v.color
FROM (VALUES
  ('ARRIVAL_STORIES', 'Finding Out', 'sparkles', '#D4A04C'),
  ('ARRIVAL_STORIES', 'Choosing Your Name', 'book', '#123F45'),
  ('ARRIVAL_STORIES', 'Pregnancy Journey', 'moon', '#8EADC1'),
  ('ARRIVAL_STORIES', 'Ultrasounds', 'camera', '#9AA383'),
  ('ARRIVAL_STORIES', 'Gender Reveal', 'star', '#D86A4E'),
  ('ARRIVAL_STORIES', 'Baby Shower', 'cake', '#F0DCC8'),
  ('ARRIVAL_STORIES', 'Meeting You', 'heart', '#2F5E45'),
  ('ARRIVAL_STORIES', 'Bringing Baby Home', 'home', '#D4A04C'),
  ('FAMILY_LIFE', 'At Home', 'home', '#123F45'),
  ('FAMILY_LIFE', 'Family Outings', 'sun', '#D4A04C'),
  ('FAMILY_LIFE', 'Vacations', 'plane', '#8EADC1'),
  ('FAMILY_LIFE', 'Holidays', 'star', '#D86A4E'),
  ('FAMILY_LIFE', 'Grandparents', 'heart', '#2F5E45'),
  ('FAMILY_LIFE', 'Pets', 'paw', '#9AA383')
) AS v(pillar, name, icon, color)
WHERE c."pillar"::text = v.pillar AND c."name" = v.name AND c."isDefault" = true;
