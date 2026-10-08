'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

export function SequenceLifecycleButtons({ sequenceId, status }: { sequenceId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: 'start' | 'pause' | 'resume' | 'archive') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/email/sequences/${sequenceId}/${action}`, { method: 'POST' });
      const payload = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? `Could not ${action}.`);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' && (
          <button className="btn-primary text-xs" disabled={!!busy} onClick={() => act('start')} type="button">
            {busy === 'start' ? 'Starting…' : 'Start (activate)'}
          </button>
        )}
        {status === 'active' && (
          <button className="btn-secondary text-xs" disabled={!!busy} onClick={() => act('pause')} type="button">
            {busy === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
        )}
        {status === 'paused' && (
          <button className="btn-primary text-xs" disabled={!!busy} onClick={() => act('resume')} type="button">
            {busy === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
        )}
        {(status === 'active' || status === 'paused' || status === 'draft') && (
          <button className="btn-ghost text-xs" disabled={!!busy} onClick={() => act('archive')} type="button">
            {busy === 'archive' ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </div>
      {error ? <ErrorState message={error} /> : null}
      <p className="text-[11px] text-slate-500">
        {status === 'draft' && 'Draft: enroll is blocked until started. Start makes it active.'}
        {status === 'active' && 'Active: jobs are claimable by the worker. Pause prevents further sends until resumed.'}
        {status === 'paused' && 'Paused: due jobs are re-queued hourly; no email is sent while paused.'}
        {status === 'archived' && 'Archived: no further enrollments or sends. Pending jobs cancelled.'}
      </p>
    </div>
  );
}
