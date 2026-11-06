import { Prisma } from "@prisma/client";

// Past `requireFamily`, usually the family being deleted mid-request: the insert waits on its lock, then finds nothing.
export function isForeignKeyViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
