-- A4: invites become share links. Email is optional, an invite may name an
-- existing Person (or carry a name for someone new), and it can be revoked.
-- (`prisma migrate dev` also proposes dropping Memory.searchVector's index
-- and default; that is the usual generated-column drift and is left out.)

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "personId" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Invite_personId_idx" ON "Invite"("personId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
