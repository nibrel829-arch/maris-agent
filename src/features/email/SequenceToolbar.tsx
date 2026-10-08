'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function SequenceToolbar({ search, status }: { search: string; status: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(search);
  const [s, setS] = useState(status);
  const [isPending, startTransition] = useTransition();

  function apply() {
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set('search', q.trim());
    else next.delete('search');
    if (s) next.set('status', s);
    else next.delete('status');
    next.delete('page');
    startTransition(() => router.push(`/email/sequences?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        className="input max-w-xs"
        placeholder="Search sequences..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())}
      />
      <select className="input w-40" value={s} onChange={(e) => setS(e.target.value)}>
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="archived">Archived</option>
        <option value="completed">Completed</option>
      </select>
      <button className="btn-secondary" onClick={apply} disabled={isPending} type="button">
        Filter
      </button>
      {(search || status) && (
        <button className="btn-ghost" onClick={() => { setQ(''); setS(''); router.push('/email/sequences'); }} type="button">
          Clear
        </button>
      )}
    </div>
  );
}
