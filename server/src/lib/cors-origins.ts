import type { Request } from "express";

const isProduction = process.env.NODE_ENV === "production";

// Unset in development allows anything: Expo Go arrives from whatever LAN address Metro picked.
// Unset in production means same-origin only, since this server serves the web bundle.
export const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function originAllowed(origin: string, req: Request): boolean {
  if (corsOrigins.length > 0) return corsOrigins.includes(origin);
  if (!isProduction) return true;
  return origin === `${req.protocol}://${req.get("host") ?? ""}`;
}
