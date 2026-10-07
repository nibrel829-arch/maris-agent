'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import { PRIMARY_CLIENT_STATUSES, statusLabel } from './client-statuses';
import {
  parseTags,
  validateClientFields,
  type ClientFieldErrors,
} from './field-validation';
import type { ClientStatus } from '@/types/domain';

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

const inputClass = (invalid: boolean) => `input${invalid ? ' border-red-400/60' : ''}`;
const hintClass = 'mt-1 text-xs leading-5 text-red-200/90';

export function CreateClientForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<ClientStatus>('lead');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ClientFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const errors = validateClientFields({ name, company, email, phone, notes, tags });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/workspace/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          status,
          notes: notes.trim() || undefined,
          tags: parseTags(tags),
        }),
      });

      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setSubmitError(payload.error?.message ?? 'Could not create the client.');
        return;
      }

      setName('');
      setCompany('');
      setEmail('');
      setPhone('');
      setStatus('lead');
      setNotes('');
      setTags('');
      setFieldErrors({});
      setNotice('Client created. The directory has been updated.');
      router.refresh();
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-name">
            Client name *
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.name)}
            className={inputClass(Boolean(fieldErrors.name))}
            id="client-name"
            placeholder="Ayesha Khan"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldErrors.name ? <p className={hintClass}>{fieldErrors.name}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-company">
            Company
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.company)}
            className={inputClass(Boolean(fieldErrors.company))}
            id="client-company"
            placeholder="Northwind Dental"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
          {fieldErrors.company ? <p className={hintClass}>{fieldErrors.company}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-email">
            Email
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.email)}
            className={inputClass(Boolean(fieldErrors.email))}
            id="client-email"
            inputMode="email"
            placeholder="client@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldErrors.email ? <p className={hintClass}>{fieldErrors.email}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-phone">
            Phone
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.phone)}
            className={inputClass(Boolean(fieldErrors.phone))}
            id="client-phone"
            inputMode="tel"
            placeholder="+1 555 010 2030"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          {fieldErrors.phone ? <p className={hintClass}>{fieldErrors.phone}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-status">
            Status
          </label>
          <select
            className="input"
            id="client-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ClientStatus)}
          >
            {PRIMARY_CLIENT_STATUSES.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-tags">
            Tags
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.tags)}
            className={inputClass(Boolean(fieldErrors.tags))}
            id="client-tags"
            placeholder="vip, referral"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          {fieldErrors.tags ? <p className={hintClass}>{fieldErrors.tags}</p> : null}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="client-notes">
          Notes
        </label>
        <textarea
          aria-invalid={Boolean(fieldErrors.notes)}
          className={`${inputClass(Boolean(fieldErrors.notes))} min-h-20`}
          id="client-notes"
          placeholder="Context the team should know before outreach…"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {fieldErrors.notes ? <p className={hintClass}>{fieldErrors.notes}</p> : null}
      </div>

      {submitError ? <ErrorState message={submitError} /> : null}
      {notice ? (
        <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}

      <button className="btn-primary w-full sm:w-auto" disabled={saving} type="submit">
        {saving ? 'Saving…' : 'Add client'}
      </button>
    </form>
  );
}
