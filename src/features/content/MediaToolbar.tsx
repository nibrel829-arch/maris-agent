'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchIcon } from '@/components/ui/icons';

const KINDS = [
  { value: '', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documents' },
] as const;

/**
 * Media search + type filter. Uses its own URL params (`msearch`, `mkind`,
 * `mpage`) so it never collides with the drafts toolbar on the same page.
 */
export function MediaToolbar({ search, kind }: { search: string; kind: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(search);

  useEffect(() => setValue(search), [search]);

  useEffect(() => {
    if (value === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('msearch', value.trim());
      else next.delete('msearch');
      next.delete('mpage');
      router.replace(`${pathname}?${next.toString()}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [value, search, params, pathname, router]);

  function onKind(nextKind: string) {
    const next = new URLSearchParams(params.toString());
    if (nextKind) next.set('mkind', nextKind);
    else next.delete('mkind');
    next.delete('mpage');
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="relative block flex-1">
        <span className="sr-only">Search media</span>
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
        <input
          aria-label="Search media"
          className="input pl-10"
          placeholder="Search filename or type…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 sm:w-44">
        <span className="sr-only">Filter by media type</span>
        <select
          aria-label="Filter by media type"
          className="input"
          value={kind}
          onChange={(event) => onKind(event.target.value)}
        >
          {KINDS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
