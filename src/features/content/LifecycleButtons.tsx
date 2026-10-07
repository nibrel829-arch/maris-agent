'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';
import type { ContentStatus } from '@/types/domain';
import { isDraftLifecycleStatus } from './content-statuses';

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

/** One-click DRAFT <-> READY transitions (Phase 6 draft lifecycle). */
export function LifecycleButtons({ id, status }: { id: string; status: ContentStatus }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isDraftLifecycleStatus(status)) return null;
  const next = status === 'DRAFT' ? 'READY' : 'DRAFT';

  async function transition() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not change the status.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        className={next === 'READY' ? 'btn-primary w-full' : 'btn-secondary w-full'}
        disabled={working}
        onClick={transition}
        type="button"
      >
        {working ? 'Saving…' : next === 'READY' ? 'Mark ready' : 'Back to draft'}
      </button>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
