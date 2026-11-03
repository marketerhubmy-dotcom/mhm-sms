export interface EmailProvider {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

/**
 * Adapter Resend (https://resend.com/docs/api-reference/emails/send-email).
 * Perlu: EMAIL_PROVIDER=resend, RESEND_API_KEY (secret), EMAIL_FROM (domain disahkan).
 * Belum diuji dengan akaun sebenar.
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}
  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [input.to], subject: input.subject, text: input.text }),
    });
    if (!res.ok) throw new Error(`EMAIL_SEND_FAILED_${res.status}`);
  }
}
