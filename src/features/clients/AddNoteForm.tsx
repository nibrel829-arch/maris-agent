'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

export function AddNoteForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (subject.trim().length === 0) {
      setError('A note subject is required.');
      return;
    }
    if (subject.trim().length > 200) {
      setError('Note subject must be 200 characters or fewer.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspace/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() || undefined }),
      });

      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not add the note.');
        return;
      }

      setSubject('');
      setBody('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="note-subject">
          Note subject *
        </label>
        <input
          className="input"
          id="note-subject"
          placeholder="Call outcome, follow-up, context…"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="note-body">
          Details
        </label>
        <textarea
          className="input min-h-16"
          id="note-body"
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      {error ? <ErrorState message={error} /> : null}
      <button className="btn-secondary w-full sm:w-auto" disabled={saving} type="submit">
        {saving ? 'Adding…' : 'Add note'}
      </button>
    </form>
  );
}
