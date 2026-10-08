'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

export function EnrollForm({ sequenceId }: { sequenceId: string }) {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [email, setEmail] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/workspace/clients?limit=100')
      .then((r) => r.json())
      .then((payload) => {
        if (payload.ok) setClients(payload.data.clients.map((c: { id: string; name: string; email: string | null }) => ({ id: c.id, name: c.name, email: c.email })));
        else if (payload.data) setClients([]);
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!clientId && !email.trim()) {
      setError('Provide a client or an email address.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/workspace/email/sequences/${sequenceId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIds: clientId ? [clientId] : [],
          emails: clientId ? [] : [email.trim()],
        }),
      });
      const payload = (await res.json()) as { ok: boolean; error?: { message: string }; data?: { enrolled: number } };
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not enroll.');
        return;
      }
      setNotice(`Enrolled ${payload.data?.enrolled ?? 1} recipient(s). First step queued.`);
      setClientId('');
      setEmail('');
      router.refresh();
    } catch {
      setError('Could not reach server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="enroll-client">Client (must have email)</label>
        <select className="input" id="enroll-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">— Select a client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.email ? `(${c.email})` : '(no email)'}
            </option>
          ))}
        </select>
      </div>
      <div className="text-center text-xs text-slate-500">or</div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="enroll-email">Direct email</label>
        <input className="input" id="enroll-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="recipient@example.com" />
      </div>
      <p className="text-[11px] text-slate-500">Only active sequences can enroll. Suppressed/opted-out recipients are skipped and marked unsubscribed. Duplicate enrollment is idempotent.</p>
      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p> : null}
      <button className="btn-primary w-full" disabled={saving} type="submit">
        {saving ? 'Enrolling…' : 'Enroll recipient'}
      </button>
    </form>
  );
}
