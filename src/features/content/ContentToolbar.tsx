'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchIcon } from '@/components/ui/icons';
import { CONTENT_PLATFORMS, CONTENT_STATUSES, platformLabel, statusLabel } from './content-statuses';

/**
 * Draft search + status/platform filter. State lives in the URL (`search`,
 * `status`, `platform`) so the server-rendered list stays consistent.
 */
export function ContentToolbar({
  search,
  status,
  platform,
}: {
  search: string;
  status: string;
  platform: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(search);

  useEffect(() => setValue(search), [search]);

  useEffect(() => {
    if (value === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('search', value.trim());
      else next.delete('search');
      next.delete('page');
      router.replace(`${pathname}?${next.toString()}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [value, search, params, pathname, router]);

  function onSelect(key: 'status' | 'platform', nextValue: string) {
    const next = new URLSearchParams(params.toString());
    if (nextValue) next.set(key, nextValue);
    else next.delete(key);
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <label className="relative block flex-1">
        <span className="sr-only">Search content</span>
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
        <input
          aria-label="Search content"
          className="input pl-10"
          placeholder="Search title, caption or body…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex items-center gap-2 sm:w-44">
          <span className="sr-only">Filter by status</span>
          <select
            aria-label="Filter by status"
            className="input"
            value={status}
            onChange={(event) => onSelect('status', event.target.value)}
          >
            <option value="">All statuses</option>
            {CONTENT_STATUSES.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 sm:w-44">
          <span className="sr-only">Filter by platform</span>
          <select
            aria-label="Filter by platform"
            className="input"
            value={platform}
            onChange={(event) => onSelect('platform', event.target.value)}
          >
            <option value="">All platforms</option>
            {CONTENT_PLATFORMS.map((option) => (
              <option key={option} value={option}>
                {platformLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
