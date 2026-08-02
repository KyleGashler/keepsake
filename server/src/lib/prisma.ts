import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/**
 * v0 has no auth, so every request operates on the single seeded family.
 * When accounts land this becomes "the family on the session".
 */
export async function currentFamily() {
  const family = await prisma.family.findFirst({ orderBy: { createdAt: "asc" } });
  if (!family) throw new Error("No family found — run the seed (npm run seed).");
  return family;
}
