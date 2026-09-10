import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Structured JSON logs in production so a log drain can parse them; a
 * human-readable stream in development via pino-pretty (a devDependency, so
 * the fallback below keeps this working if it isn't installed).
 */
function createLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

  if (!isProduction) {
    try {
      return pino({
        level,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      });
    } catch {
      // pino-pretty absent (production install): fall through to plain JSON.
    }
  }

  return pino({ level });
}

export const logger = createLogger();
