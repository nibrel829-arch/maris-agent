'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/primitives';

interface PageCandidate {
  id: string;
  name: string;
  tasks: string[];
}

interface ApiResponse {
  ok: boolean;
  error?: { message: string };
}

/** Binds a Facebook connection to one Page. Page tokens never touch this form. */
export function FacebookSelectForm({
  stateToken,
  pages,
}: {
  stateToken: string;
  pages: PageCandidate[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(pages[0]?.id ?? '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (working || !selected) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace/social/facebook/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: stateToken, page_id: selected }),
      });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not complete the connection.');
        return;
      }
      router.push('/social?connected=facebook');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-slate-300">
          Choose the Page to connect
        </legend>
        {pages.map((page) => (
          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
              selected === page.id
                ? 'border-brand-300/50 bg-brand-400/10'
                : 'border-surface-border bg-surface/40 hover:border-slate-500/50'
            }`}
            key={page.id}
          >
            <input
              checked={selected === page.id}
              className="accent-brand-400"
              name="page"
              type="radio"
              value={page.id}
              onChange={() => setSelected(page.id)}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-100">{page.name}</span>
              <span className="block text-[11px] text-slate-500">
                Content permission granted
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {error ? <ErrorState message={error} /> : null}

      <button className="btn-primary w-full sm:w-auto" disabled={working || !selected} type="submit">
        {working ? 'Connecting…' : 'Connect selected Page'}
      </button>
    </form>
  );
}
