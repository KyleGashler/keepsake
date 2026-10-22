import type { Request } from "express";

const isProduction = process.env.NODE_ENV === "production";

/**
 * CORS_ORIGINS is a comma-separated allowlist. Unset in development means
 * "allow anything", because Expo Go on a phone arrives from whatever LAN
 * address Metro picked. Unset in production means same-origin only — the
 * hosted build serves the web bundle from this same server.
 */
export const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Whether a browser on `origin` may talk to this API — the same rule the
 * CORS middleware applies, for places that hand an origin to someone else
 * (a Mux upload URL's `cors_origin`).
 */
export function originAllowed(origin: string, req: Request): boolean {
  if (corsOrigins.length > 0) return corsOrigins.includes(origin);
  if (!isProduction) return true;
  return origin === `${req.protocol}://${req.get("host") ?? ""}`;
}
