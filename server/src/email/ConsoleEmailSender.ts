import type { Logger } from "pino";
import type { EmailMessage, EmailSender } from "./EmailSender.js";

/**
 * Delivers nothing: writes the message to the log instead. The default until
 * a real provider exists (B6), and what local development keeps using — the
 * invite link is in the API's output, ready to paste.
 */
export class ConsoleEmailSender implements EmailSender {
  readonly delivers = false;

  constructor(private readonly log: Logger) {}

  async send(message: EmailMessage) {
    this.log.info({ email: { to: message.to, subject: message.subject } }, `email (not sent):\n${message.text}`);
  }
}
