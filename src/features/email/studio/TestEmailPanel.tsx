'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/primitives';

/**
 * Test-email workflow (Phase 16 §3).
 *
 * Sends exactly one message through the existing provider adapter and reports
 * the real outcome: the provider name, the provider message id, or the exact
 * failure reason. It never claims a delivery that did not happen, and it never
 * sends a campaign — campaigns keep their own approval gates.
 */

interface Props {
  designId: string;
  designName: string;
  subject: string;
  canSend: boolean;
  /** Called before sending so the test uses the saved design. */
  onSaved: () => Promise<boolean>;
}

interface Outcome {
  status: 'SENT' | 'FAILED';
  to: string;
  subject: string;
  provider: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
}

export function TestEmailPanel({ designId, designName, subject, canSend, onSaved }: Props) {
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setError(null);
    setOutcome(null);

    const saved = await onSaved();
    if (!saved) {
      setError('The design could not be saved, so the test email was not sent.');
      return;
    }

    setSending(true);
    try {
      const response = await fetch(`/api/workspace/email/designs/${designId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim() }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: Outcome;
        error?: { code: string; message: string };
      };
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'The test email could not be sent.');
        return;
      }
      setOutcome(payload.data);
    } catch {
      setError('Could not reach the server to send the test email.');
    } finally {
      setSending(false);
    }
  }

  if (!canSend) {
    return (
      <div className="panel p-4">
        <h2 className="card-title">Test email</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Your role cannot send email (requires email:send — owner or admin). You can still preview, validate and export
          the design, and ask an owner or admin to send the test.
        </p>
      </div>
    );
  }

  return (
    <form className="panel space-y-4 p-4" noValidate onSubmit={send}>
      <div>
        <h2 className="card-title">Send a test email</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Sends the saved design of <span className="text-slate-200">{designName}</span> to one address through the
          configured provider. The subject is prefixed with <span className="font-mono">[Test]</span>, the send is
          idempotent per recipient, and it is recorded in the email log. No campaign is sent from here.
        </p>
      </div>

      <label className="block text-xs font-medium text-slate-300" htmlFor="test-to">
        Recipient
        <input
          autoComplete="email"
          className="input mt-1"
          id="test-to"
          placeholder="you@yourdomain.com"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>

      <div className="panel-subtle p-3 text-xs leading-5 text-slate-400">
        <p>
          Subject sent: <span className="text-slate-200">[Test] {subject}</span>
        </p>
        <p className="mt-1">
          Blocking validation issues must be fixed first. If no provider is configured, the panel reports{' '}
          <span className="font-mono">not_configured</span> instead of claiming a delivery.
        </p>
      </div>

      <button className="btn-primary w-full justify-center" disabled={sending || to.trim().length === 0} type="submit">
        {sending ? 'Sending…' : 'Send test email'}
      </button>

      {error ? <p className="text-xs leading-5 text-red-200">{error}</p> : null}

      {outcome ? (
        <div className="panel-subtle space-y-2 p-3">
          <div className="flex items-center gap-2">
            <Badge tone={outcome.status === 'SENT' ? 'success' : 'danger'}>{outcome.status}</Badge>
            <span className="text-xs text-slate-400">{outcome.provider ?? 'no provider'}</span>
          </div>
          <p className="text-xs text-slate-300">
            To {outcome.to} · {outcome.subject}
          </p>
          {outcome.providerMessageId ? (
            <p className="font-mono text-[11px] text-emerald-200">Provider message id: {outcome.providerMessageId}</p>
          ) : null}
          {outcome.errorMessage ? <p className="text-xs leading-5 text-red-200">{outcome.errorMessage}</p> : null}
          <p className="text-[11px] leading-4 text-slate-500">
            This record is in the email log with its real status; retrying with the same recipient does not send twice.
          </p>
        </div>
      ) : null}
    </form>
  );
}
