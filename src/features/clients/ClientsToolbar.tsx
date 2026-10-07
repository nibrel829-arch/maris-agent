'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchIcon } from '@/components/ui/icons';
import { CLIENT_STATUSES, statusLabel } from './client-statuses';

/**
 * Directory search + status filter. State lives in the URL (`search`,
 * `status`) so the server-rendered list, pagination and browser history stay
 * consistent. Search is debounced; status applies immediately.
 */
export function ClientsToolbar({
  search,
  status,
}: {
  search: string;
  status: string;
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

  function onStatus(nextStatus: string) {
    const next = new URLSearchParams(params.toString());
    if (nextStatus) next.set('status', nextStatus);
    else next.delete('status');
    next.delete('page');
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="relative block flex-1">
        <span className="sr-only">Search clients</span>
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
        <input
          aria-label="Search clients"
          className="input pl-10"
          placeholder="Search name, company, email or phone…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 sm:w-56">
        <span className="sr-only">Filter by status</span>
        <select
          aria-label="Filter by status"
          className="input"
          value={status}
          onChange={(event) => onStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {CLIENT_STATUSES.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
