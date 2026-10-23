import { logger } from "../lib/logger.js";
import { ConsoleEmailSender } from "./ConsoleEmailSender.js";
import type { EmailSender } from "./EmailSender.js";

export type { EmailMessage, EmailSender } from "./EmailSender.js";

/**
 * `EMAIL_PROVIDER` picks how mail goes out: `console` (the default, and the
 * only one so far) logs it. An unknown value refuses to start rather than
 * quietly dropping every email.
 */
export function createEmailSender(): EmailSender {
  const provider = process.env.EMAIL_PROVIDER?.trim() || "console";
  switch (provider) {
    case "console":
      return new ConsoleEmailSender(logger);
    default:
      throw new Error(`refusing to start: unknown EMAIL_PROVIDER=${JSON.stringify(provider)}. Use "console".`);
  }
}

let sender: EmailSender | null = null;

/** The process's sender, created on first use. `index.ts` calls it at boot so a bad config fails early. */
export function emailSender(): EmailSender {
  sender ??= createEmailSender();
  return sender;
}
