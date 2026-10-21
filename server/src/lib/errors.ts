/** The message of anything thrown, which isn't always an `Error`. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
