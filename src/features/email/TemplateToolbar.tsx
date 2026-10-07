'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function TemplateToolbar({
  search,
  status,
  category,
}: {
  search: string;
  status: string;
  category: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(search);
  const [cat, setCat] = useState(category);

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete('page');
    const text = params.toString();
    router.push(text ? `/email/templates?${text}` : '/email/templates');
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        className="input max-w-[260px]"
        placeholder="Search templates…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply({ search: q.trim(), status, category: cat.trim() });
        }}
      />
      <input
        className="input max-w-[160px]"
        placeholder="Category"
        value={cat}
        onChange={(e) => setCat(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply({ search: q.trim(), status, category: cat.trim() });
        }}
      />
      <select
        className="input max-w-[150px]"
        value={status}
        onChange={(e) => apply({ search: q.trim(), status: e.target.value, category: cat.trim() })}
      >
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      <button className="btn-secondary" type="button" onClick={() => apply({ search: q.trim(), status, category: cat.trim() })}>
        Filter
      </button>
      {(search || status || category) && (
        <button className="btn-ghost" type="button" onClick={() => router.push('/email/templates')}>
          Clear
        </button>
      )}
    </div>
  );
}
