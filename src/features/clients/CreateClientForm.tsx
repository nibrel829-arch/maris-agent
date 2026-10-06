'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

export function CreateClientForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length === 0) {
      setError('A client name is required.');
      return;
    }
    setStatus('saving');
    setError(null);

    const response = await fetch('/api/workspace/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
      }),
    });

    const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
    if (!payload.ok) {
      setError(payload.error?.message ?? 'Could not create the client.');
      setStatus('idle');
      return;
    }

    setName('');
    setCompany('');
    setEmail('');
    setStatus('idle');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          className="input"
          placeholder="Client name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="input"
          placeholder="Company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
        <input
          className="input"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {error ? <ErrorState message={error} /> : null}

      <button className="btn-primary" onClick={submit} disabled={status === 'saving'}>
        {status === 'saving' ? 'Saving…' : 'Add client'}
      </button>
    </div>
  );
}
