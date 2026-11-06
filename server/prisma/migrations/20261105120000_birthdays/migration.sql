-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "birthday" INTEGER,
ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Collection_parentId_idx" ON "Collection"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_parentId_birthday_key" ON "Collection"("parentId", "birthday");

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
