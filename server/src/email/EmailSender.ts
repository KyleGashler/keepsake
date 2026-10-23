/**
 * The one seam between little by little and whoever delivers its email.
 *
 * Callers compose the message; an implementation only delivers it.
 * `emailSender()` (./index.ts) picks the implementation from `EMAIL_PROVIDER`,
 * so a real provider (Resend, B6) is a new class and a new case there, and
 * nothing that sends mail changes.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text, always — every client can show it. */
  text: string;
  /** Optional richer version; clients that can't render it fall back to `text`. */
  html?: string;
};

export interface EmailSender {
  /**
   * Whether a sent message actually reaches an inbox. False for the console
   * sender, so nothing tells a person "we emailed it" when nobody did.
   */
  readonly delivers: boolean;
  /** Resolves once the provider has accepted the message. Rejects if it didn't. */
  send: (message: EmailMessage) => Promise<void>;
}
