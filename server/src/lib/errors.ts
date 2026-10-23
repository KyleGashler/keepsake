import { Prisma } from "@prisma/client";

/**
 * A write referenced a row that isn't there (Prisma P2003). Past
 * `requireFamily`, the usual cause is the family itself being deleted
 * mid-request (A16): its row is locked while it goes, so the insert waits
 * and then finds nothing to point at.
 */
export function isForeignKeyViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}

/** The message of anything thrown, which isn't always an `Error`. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
