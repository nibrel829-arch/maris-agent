'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import type { Client, ClientStatus } from '@/types/domain';
import { CLIENT_STATUSES, statusLabel } from './client-statuses';
import {
  parseTags,
  validateClientFields,
  type ClientFieldErrors,
} from './field-validation';

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

const inputClass = (invalid: boolean) => `input${invalid ? ' border-red-400/60' : ''}`;
const hintClass = 'mt-1 text-xs leading-5 text-red-200/90';

export function EditClientForm({ client }: { client: Client }) {
  const router = useRouter();
  const [name, setName] = useState(client.name);
  const [company, setCompany] = useState(client.company ?? '');
  const [email, setEmail] = useState(client.email ?? '');
  const [phone, setPhone] = useState(client.phone ?? '');
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [notes, setNotes] = useState(client.notes ?? '');
  const [tags, setTags] = useState(client.tags.join(', '));
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
      const response = await fetch(`/api/workspace/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim(),
          email: email.trim(),
          phone: phone.trim(),
          status,
          notes,
          tags: parseTags(tags),
        }),
      });

      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setSubmitError(payload.error?.message ?? 'Could not save the client.');
        return;
      }

      setNotice('Changes saved.');
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
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-name">
            Client name *
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.name)}
            className={inputClass(Boolean(fieldErrors.name))}
            id="edit-client-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldErrors.name ? <p className={hintClass}>{fieldErrors.name}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-company">
            Company
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.company)}
            className={inputClass(Boolean(fieldErrors.company))}
            id="edit-client-company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
          {fieldErrors.company ? <p className={hintClass}>{fieldErrors.company}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-email">
            Email
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.email)}
            className={inputClass(Boolean(fieldErrors.email))}
            id="edit-client-email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldErrors.email ? <p className={hintClass}>{fieldErrors.email}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-phone">
            Phone
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.phone)}
            className={inputClass(Boolean(fieldErrors.phone))}
            id="edit-client-phone"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          {fieldErrors.phone ? <p className={hintClass}>{fieldErrors.phone}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-status">
            Status
          </label>
          <select
            className="input"
            id="edit-client-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ClientStatus)}
          >
            {CLIENT_STATUSES.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-tags">
            Tags
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.tags)}
            className={inputClass(Boolean(fieldErrors.tags))}
            id="edit-client-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          {fieldErrors.tags ? <p className={hintClass}>{fieldErrors.tags}</p> : null}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-client-notes">
          Notes
        </label>
        <textarea
          aria-invalid={Boolean(fieldErrors.notes)}
          className={`${inputClass(Boolean(fieldErrors.notes))} min-h-20`}
          id="edit-client-notes"
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
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
