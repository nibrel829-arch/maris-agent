'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import { validateComposeFields, type ComposeFieldErrors } from './field-validation';
import type { EmailTemplate } from '@/types/domain';

const inputClass = (invalid: boolean) => `input${invalid ? ' border-red-400/60' : ''}`;
const hintClass = 'mt-1 text-xs leading-5 text-red-200/90';

interface Props {
  templates: EmailTemplate[];
  initialTemplateId?: string;
}

export function EmailComposer({ templates, initialTemplateId }: Props) {
  const router = useRouter();
  const activeTemplates = templates.filter((t) => (t.status ?? (t.archived ? 'archived' : 'active')) === 'active');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState<string>(initialTemplateId ?? '');
  const [variablesRaw, setVariablesRaw] = useState('{\n  "client.name": "Acme",\n  "client.company": "Acme Clinic"\n}');
  const [clientId, setClientId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ComposeFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; body: string; unresolved: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  function parseVariables(): { ok: true; data: Record<string, string> } | { ok: false; message: string } {
    if (!variablesRaw.trim()) return { ok: true, data: {} };
    try {
      const parsed = JSON.parse(variablesRaw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, message: 'Variables must be a JSON object of string to string.' };
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== 'string') return { ok: false, message: `Variable ${JSON.stringify(k)} must be a string.` };
        out[k] = v;
      }
      return { ok: true, data: out };
    } catch (e) {
      return { ok: false, message: `Variables JSON is invalid: ${e instanceof Error ? e.message : 'parse error'}` };
    }
  }

  // When template selection changes, optionally load its raw subject/body into compose fields for editing
  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      setSubject(tpl.subject);
      setBody(tpl.body);
      // Suggest variable keys
      if (tpl.variables.length > 0 && variablesRaw.trim() === '') {
        const vars: Record<string, string> = {};
        for (const v of tpl.variables) vars[v] = v;
        setVariablesRaw(JSON.stringify(vars, null, 2));
      }
    }
  }, [templateId, templates, variablesRaw]);

  async function doPreview() {
    setSubmitError(null);
    setNotice(null);
    const vars = parseVariables();
    if (!vars.ok) {
      setFieldErrors({ variables: vars.message });
      return;
    }
    setFieldErrors({});
    // Decide preview endpoint: template preview when template selected, generic otherwise
    setPreviewing(true);
    try {
      if (templateId) {
        const response = await fetch(`/api/workspace/email/templates/${templateId}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: vars.data }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          data?: { subject: string; body: string; unresolved: string[]; variables: string[] };
          error?: { message: string };
        };
        if (!payload.ok || !payload.data) {
          setSubmitError(payload.error?.message ?? 'Preview failed.');
          return;
        }
        setPreview({ subject: payload.data.subject, body: payload.data.body, unresolved: payload.data.unresolved });
        if (payload.data.unresolved.length > 0) {
          setNotice(`Unresolved variables: ${payload.data.unresolved.join(', ')} — add them to the variables JSON before sending.`);
        } else {
          setNotice('Preview ready — all placeholders resolved.');
        }
      } else {
        if (!subject.trim() || !body.trim()) {
          setSubmitError('Provide subject and body to preview.');
          return;
        }
        const response = await fetch('/api/workspace/email/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: subject.trim(), body: body.trim(), variables: vars.data }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          data?: { subject: string; body: string; unresolved: string[] };
          error?: { message: string };
        };
        if (!payload.ok || !payload.data) {
          setSubmitError(payload.error?.message ?? 'Preview failed.');
          return;
        }
        setPreview({ subject: payload.data.subject, body: payload.data.body, unresolved: payload.data.unresolved });
        if (payload.data.unresolved.length > 0) {
          setNotice(`Unresolved variables: ${payload.data.unresolved.join(', ')}`);
        } else {
          setNotice('Preview ready — all placeholders resolved.');
        }
      }
    } catch {
      setSubmitError('Could not reach the server for preview.');
    } finally {
      setPreviewing(false);
    }
  }

  async function doSend(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;

    const vars = parseVariables();
    if (!vars.ok) {
      setFieldErrors({ variables: vars.message });
      return;
    }

    // If using direct fields (no template), validate them client-side
    if (!templateId) {
      const errors = validateComposeFields({ to, subject, body });
      if (vars.data && Object.keys(vars.data).length === 0) {
        // no extra check
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;
    } else {
      // With template, only recipient is strictly required client-side; variables completeness is server-checked
      if (!to.trim()) {
        setFieldErrors({ to: 'Recipient email is required.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
        setFieldErrors({ to: 'Enter a valid email address.' });
        return;
      }
      setFieldErrors({});
    }

    setSending(true);
    setSubmitError(null);
    setNotice(null);
    setPreview(null);

    try {
      const payload: Record<string, unknown> = {
        to: to.trim(),
        variables: vars.data,
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        ...(idempotencyKey.trim() ? { idempotencyKey: idempotencyKey.trim() } : {}),
      };
      if (templateId) {
        payload.templateId = templateId;
        // subject/body are ignored when templateId is present; preview already shows rendered
      } else {
        payload.subject = subject.trim();
        payload.body = body.trim();
      }

      const response = await fetch('/api/workspace/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok: boolean;
        data?: { log: { id: string; status: string; provider_message_id: string | null }; providerMessageId: string | null };
        error?: { code: string; message: string; retryable?: boolean };
      };

      if (!result.ok) {
        const detail = result.error?.message ?? 'Could not send email.';
        const retry = result.error?.retryable ? ' (retryable)' : '';
        const code = result.error?.code ?? 'FAILED';
        setSubmitError(`${code}: ${detail}${retry}`);
        return;
      }

      setNotice(
        result.data?.providerMessageId
          ? `Sent. Provider id: ${result.data.providerMessageId}`
          : 'Email accepted for sending.',
      );
      setFieldErrors({});
      router.refresh();
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={doSend} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-to">
            Recipient email *
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.to)}
            className={inputClass(Boolean(fieldErrors.to))}
            id="composer-to"
            inputMode="email"
            placeholder="client@company.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {fieldErrors.to ? <p className={hintClass}>{fieldErrors.to}</p> : null}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-template">
            Template (optional)
          </label>
          <select className="input" id="composer-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— No template (use subject/body below) —</option>
            {activeTemplates.length === 0 ? <option disabled>No active templates</option> : null}
            {activeTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.subject.slice(0, 40)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-4 text-slate-500">Draft/archived templates are not selectable for sending.</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-client">
            Client association (optional)
          </label>
          <input
            className="input"
            id="composer-client"
            placeholder="client UUID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
      </div>

      {!templateId && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-subject">
              Subject *
            </label>
            <input
              aria-invalid={Boolean(fieldErrors.subject)}
              className={inputClass(Boolean(fieldErrors.subject))}
              id="composer-subject"
              placeholder="Welcome to {{client.company}}"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            {fieldErrors.subject ? <p className={hintClass}>{fieldErrors.subject}</p> : <p className="mt-1 text-[11px] leading-4 text-slate-500">Use {'{{client.name}}'}, {'{{user.name}}'} etc.</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-body">
              Body *
            </label>
            <textarea
              aria-invalid={Boolean(fieldErrors.body)}
              className={`${inputClass(Boolean(fieldErrors.body))} min-h-28`}
              id="composer-body"
              rows={5}
              placeholder="Hi {{client.name}}, welcome…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            {fieldErrors.body ? <p className={hintClass}>{fieldErrors.body}</p> : null}
          </div>
        </>
      )}

      {templateId && (
        <div className="rounded-xl border border-brand-300/15 bg-brand-500/10 p-3">
          <p className="text-xs font-medium text-brand-200">Using template</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">Subject and body come from the selected template. Variables below control substitution — preview before sending.</p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-vars">
          Variables (JSON object)
        </label>
        <textarea
          aria-invalid={Boolean(fieldErrors.variables)}
          className={`${inputClass(Boolean(fieldErrors.variables))} min-h-24 font-mono text-xs`}
          id="composer-vars"
          rows={4}
          placeholder={'{\n  "client.name": "Ayesha",\n  "client.company": "Northwind"\n}'}
          value={variablesRaw}
          onChange={(e) => setVariablesRaw(e.target.value)}
        />
        {fieldErrors.variables ? <p className={hintClass}>{fieldErrors.variables}</p> : <p className="mt-1 text-[11px] leading-4 text-slate-500">Keys must match placeholders like client.name, user.name, etc.</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="composer-idem">
          Idempotency key (optional)
        </label>
        <input className="input font-mono text-xs" id="composer-idem" placeholder="auto-generated if empty; re-using the same key prevents duplicate sends" value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} />
      </div>

      {preview && (
        <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Preview</h4>
          <p className="mt-2 text-sm font-medium text-slate-100">Subject: {preview.subject}</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface/60 p-3 text-xs leading-5 text-slate-300">{preview.body}</pre>
          {preview.unresolved.length > 0 ? <p className="mt-2 text-xs text-amber-200">Unresolved: {preview.unresolved.join(', ')}</p> : <p className="mt-2 text-xs text-emerald-200">All variables resolved.</p>}
        </div>
      )}

      {submitError ? <ErrorState message={submitError} /> : null}
      {notice ? <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" type="button" disabled={previewing} onClick={doPreview}>
          {previewing ? 'Previewing…' : 'Preview'}
        </button>
        <button className="btn-primary" disabled={sending} type="submit">
          {sending ? 'Sending…' : 'Send email'}
        </button>
      </div>
      <p className="text-[11px] leading-4 text-slate-500">Sending requires the email provider to be configured (Resend). When unconfigured, the send is reported as not_configured without duplicating.</p>
    </form>
  );
}
