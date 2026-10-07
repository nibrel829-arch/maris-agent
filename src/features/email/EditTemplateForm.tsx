'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import { validateTemplateFields, type TemplateFieldErrors } from './field-validation';
import type { EmailTemplate } from '@/types/domain';

const inputClass = (invalid: boolean) => `input${invalid ? ' border-red-400/60' : ''}`;
const hintClass = 'mt-1 text-xs leading-5 text-red-200/90';

export function EditTemplateForm({ template }: { template: EmailTemplate }) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [category, setCategory] = useState(template.category);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [status, setStatus] = useState(template.status ?? (template.archived ? 'archived' : 'active'));
  const [fieldErrors, setFieldErrors] = useState<TemplateFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const errors = validateTemplateFields({ name, category, subject, body });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/workspace/email/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), category: category.trim(), subject: subject.trim(), body: body.trim(), status }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setSubmitError(payload.error?.message ?? 'Could not update template.');
        return;
      }
      setNotice('Template updated.');
      router.refresh();
    } catch {
      setSubmitError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    setDeleting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/workspace/email/templates/${template.id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setSubmitError(payload.error?.message ?? 'Could not delete template.');
        return;
      }
      router.push('/email/templates');
      router.refresh();
    } catch {
      setSubmitError('Could not reach the server.');
    } finally {
      setDeleting(false);
    }
  }

  async function preview() {
    setSubmitError(null);
    setNotice(null);
    // Quick local preview using the same variable syntax: ask for a JSON map
    const raw = prompt('Preview variables as JSON, e.g. {"client.name":"Acme","user.name":"Ada"}', '{"client.name":"Acme","client.company":"Acme Clinic","user.name":"Ada"}');
    if (raw === null) return;
    let variables: Record<string, string>;
    try {
      variables = JSON.parse(raw);
    } catch {
      setSubmitError('Invalid JSON for variables.');
      return;
    }
    try {
      const response = await fetch(`/api/workspace/email/templates/${template.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
      });
      const payload = (await response.json()) as { ok: boolean; data?: { subject: string; body: string; unresolved: string[] }; error?: { message: string } };
      if (!payload.ok || !payload.data) {
        setSubmitError(payload.error?.message ?? 'Preview failed.');
        return;
      }
      const unresolved = payload.data.unresolved.length ? `\nUnresolved: ${payload.data.unresolved.join(', ')}` : '\nAll variables resolved.';
      alert(`Subject: ${payload.data.subject}\n\nBody:\n${payload.data.body}\n${unresolved}`);
    } catch {
      setSubmitError('Preview request failed.');
    }
  }

  return (
    <form className="space-y-3" onSubmit={save} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-name">
          Template name *
        </label>
        <input aria-invalid={Boolean(fieldErrors.name)} className={inputClass(Boolean(fieldErrors.name))} id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        {fieldErrors.name ? <p className={hintClass}>{fieldErrors.name}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-category">
            Category *
          </label>
          <input aria-invalid={Boolean(fieldErrors.category)} className={inputClass(Boolean(fieldErrors.category))} id="edit-category" value={category} onChange={(e) => setCategory(e.target.value)} />
          {fieldErrors.category ? <p className={hintClass}>{fieldErrors.category}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-status">
            Status
          </label>
          <select className="input" id="edit-status" value={status} onChange={(e) => setStatus(e.target.value as never)}>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-subject">
          Subject *
        </label>
        <input aria-invalid={Boolean(fieldErrors.subject)} className={inputClass(Boolean(fieldErrors.subject))} id="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        {fieldErrors.subject ? <p className={hintClass}>{fieldErrors.subject}</p> : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="edit-body">
          Body *
        </label>
        <textarea aria-invalid={Boolean(fieldErrors.body)} className={`${inputClass(Boolean(fieldErrors.body))} min-h-28`} id="edit-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        {fieldErrors.body ? <p className={hintClass}>{fieldErrors.body}</p> : null}
      </div>

      {submitError ? <ErrorState message={submitError} /> : null}
      {notice ? <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={saving} type="submit">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button className="btn-secondary" type="button" onClick={preview}>
          Preview
        </button>
        <button className="btn-danger ml-auto" disabled={deleting} type="button" onClick={remove}>
          {deleting ? 'Deleting…' : 'Delete template'}
        </button>
      </div>
    </form>
  );
}
