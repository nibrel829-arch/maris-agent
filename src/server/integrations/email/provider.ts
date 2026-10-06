/**
 * Email provider adapter (PDF #10 §14 Provider Architecture).
 *
 * Production email is delivered through an external provider API. Provider
 * specifics live entirely inside this adapter, credentials stay server-side,
 * and provider message IDs are stored for tracing.
 *
 * If no provider is configured the adapter reports `not_configured`. It never
 * reports a successful send that did not happen (PDF #10 §21, CEO spec §11).
 */

export interface OutboundEmail {
  organizationId: string;
  to: string;
  subject: string;
  /** Already rendered and validated — variables resolved before this call. */
  html: string;
  text: string;
  replyTo?: string;
  /** Idempotency key preventing duplicate sends on retry (PDF #10 §15). */
  idempotencyKey: string;
}

export type SendOutcome =
  | { status: 'sent'; providerMessageId: string; provider: string }
  | { status: 'not_configured'; reason: string }
  | { status: 'failed'; reason: string; retryable: boolean };

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(email: OutboundEmail): Promise<SendOutcome>;
}

/**
 * Resend adapter — official HTTP API.
 * Enabled only when RESEND_API_KEY is present.
 */
class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.fromAddress);
  }

  async send(email: OutboundEmail): Promise<SendOutcome> {
    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        reason: 'Resend is selected but RESEND_API_KEY or NIBREXO_EMAIL_FROM is missing.',
      };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Provider-side idempotency so a retry cannot duplicate the email.
          'Idempotency-Key': email.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        }),
      });

      if (response.status === 429) {
        return { status: 'failed', reason: 'Provider rate limited the request.', retryable: true };
      }
      if (response.status >= 500) {
        return { status: 'failed', reason: `Provider error ${response.status}.`, retryable: true };
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return {
          status: 'failed',
          reason: `Provider rejected the message (${response.status}). ${detail.slice(0, 200)}`,
          retryable: false,
        };
      }

      const payload = (await response.json()) as { id?: string };
      if (!payload.id) {
        return {
          status: 'failed',
          reason: 'Provider accepted the request but returned no message id. Delivery is unconfirmed.',
          retryable: false,
        };
      }

      return { status: 'sent', providerMessageId: payload.id, provider: this.name };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown transport error';
      return { status: 'failed', reason: `Transport error: ${message}`, retryable: true };
    }
  }
}

class UnconfiguredProvider implements EmailProvider {
  readonly name = 'unconfigured';

  isConfigured(): boolean {
    return false;
  }

  async send(): Promise<SendOutcome> {
    return {
      status: 'not_configured',
      reason:
        'No email provider is configured. Set NIBREXO_EMAIL_PROVIDER and the provider credentials. Emails can be prepared and approved but not delivered until then.',
    };
  }
}

export function createEmailProvider(): EmailProvider {
  const provider = (process.env.NIBREXO_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.NIBREXO_EMAIL_FROM?.trim();

  if (provider === 'resend' && apiKey && fromAddress) {
    return new ResendProvider(apiKey, fromAddress);
  }
  return new UnconfiguredProvider();
}
