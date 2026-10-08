'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import { validateTemplateFields, type TemplateFieldErrors } from './field-validation';

const inputClass = (invalid: boolean) => `input${invalid ? ' border-red-400/60' : ''}`;
const hintClass = 'mt-1 text-xs leading-5 text-red-200/90';

export function CreateTemplateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'draft' | 'active'>('active');
  const [fieldErrors, setFieldErrors] = useState<TemplateFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const errors = validateTemplateFields({ name, category, subject, body });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/workspace/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), category: category.trim(), subject: subject.trim(), body: body.trim(), status }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setSubmitError(payload.error?.message ?? 'Could not create template.');
        return;
      }
      setName('');
      setCategory('');
      setSubject('');
      setBody('');
      setStatus('active');
      setFieldErrors({});
      setNotice('Template created.');
      router.refresh();
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="tpl-name">
          Template name *
        </label>
        <input
          aria-invalid={Boolean(fieldErrors.name)}
          className={inputClass(Boolean(fieldErrors.name))}
          id="tpl-name"
          placeholder="Welcome sequence — step 1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {fieldErrors.name ? <p className={hintClass}>{fieldErrors.name}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="tpl-category">
            Category *
          </label>
          <input
            aria-invalid={Boolean(fieldErrors.category)}
            className={inputClass(Boolean(fieldErrors.category))}
            id="tpl-category"
            placeholder="onboarding"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          {fieldErrors.category ? <p className={hintClass}>{fieldErrors.category}</p> : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="tpl-status">
            Status
          </label>
          <select className="input" id="tpl-status" value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'active')}>
            <option value="active">Active — selectable for sending</option>
            <option value="draft">Draft — preview only, not selectable</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="tpl-subject">
          Subject *
        </label>
        <input
          aria-invalid={Boolean(fieldErrors.subject)}
          className={inputClass(Boolean(fieldErrors.subject))}
          id="tpl-subject"
          placeholder="Welcome to {{client.company}}, {{client.name}}"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        {fieldErrors.subject ? <p className={hintClass}>{fieldErrors.subject}</p> : <p className="mt-1 text-[11px] leading-4 text-slate-500">Use {'{{client.name}}'}, {'{{client.company}}'}, {'{{user.name}}'} etc.</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="tpl-body">
          Body *
        </label>
        <textarea
          aria-invalid={Boolean(fieldErrors.body)}
          className={`${inputClass(Boolean(fieldErrors.body))} min-h-28`}
          id="tpl-body"
          placeholder="Hi {{client.name}},&#10;Welcome to Nibrexo..."
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {fieldErrors.body ? <p className={hintClass}>{fieldErrors.body}</p> : null}
      </div>

      {submitError ? <ErrorState message={submitError} /> : null}
      {notice ? <p aria-live="polite" className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}

      <button className="btn-primary w-full sm:w-auto" disabled={saving} type="submit">
        {saving ? 'Saving…' : 'Create template'}
      </button>
    </form>
  );
}
