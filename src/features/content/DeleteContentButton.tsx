'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

export function DeleteContentButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (deleting) return;
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/content/${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not delete the item.');
        return;
      }
      router.push('/content');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-danger w-full" disabled={deleting} onClick={remove} type="button">
        {deleting ? 'Deleting…' : 'Delete this item'}
      </button>
      {error ? <ErrorState message={error} /> : null}
      <p className="text-[11px] leading-4 text-slate-500">
        Attached media files are kept — they may back other drafts.
      </p>
    </div>
  );
}
