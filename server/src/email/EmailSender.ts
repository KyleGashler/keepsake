export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailSender {
  readonly delivers: boolean;
  send: (message: EmailMessage) => Promise<void>;
}
