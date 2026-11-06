import type { Logger } from "pino";
import type { EmailMessage, EmailSender } from "./EmailSender.js";

export class ConsoleEmailSender implements EmailSender {
  readonly delivers = false;

  constructor(private readonly log: Logger) {}

  async send(message: EmailMessage) {
    this.log.info({ email: { to: message.to, subject: message.subject } }, `email (not sent):\n${message.text}`);
  }
}
