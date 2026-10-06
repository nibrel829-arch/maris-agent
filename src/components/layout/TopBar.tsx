'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { ArrowUpRightIcon, ClockIcon, CommandIcon, ShieldCheckIcon } from '@/components/ui/icons';
import type { ActorContext } from '@/types/domain';
import { roleLabel } from '@/server/auth/permissions';

const PAGE_CONTEXT: Array<{ match: string; title: string; subtitle: string }> = [
  { match: '/manager', title: 'Manager workspace', subtitle: 'Your operating command center' },
  { match: '/ai', title: 'Manager workspace', subtitle: 'Your operating command center' },
  { match: '/dashboard', title: 'CEO cockpit', subtitle: 'What matters now' },
  { match: '/priorities', title: 'Priorities', subtitle: 'Work that deserves attention' },
  { match: '/approvals', title: 'Approval center', subtitle: 'Decisions waiting on you' },
  { match: '/activity', title: 'Decision timeline', subtitle: 'A clear operating record' },
  { match: '/research', title: 'Research workspace', subtitle: 'Evidence, gaps and next moves' },
  { match: '/product', title: 'Product workspace', subtitle: 'Concepts moving toward proof' },
  { match: '/leads', title: 'Leads workspace', subtitle: 'Provenance before outreach' },
  { match: '/marketing', title: 'Marketing workspace', subtitle: 'Content and campaigns in motion' },
  { match: '/reports', title: 'Business reporting', subtitle: 'The facts currently on record' },
  { match: '/clients', title: 'Relationships', subtitle: 'Clients and CRM context' },
  { match: '/emails', title: 'Email operations', subtitle: 'Prepared, approved and delivered work' },
  { match: '/social', title: 'Channels', subtitle: 'Connected capability, honestly reported' },
  { match: '/inbox', title: 'Inbox', subtitle: 'Conversations when supported' },
  { match: '/settings', title: 'Settings', subtitle: 'Environment and permissions' },
];

function useClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const interval = window.setInterval(update, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

export function TopBar({
  actor,
  pendingApprovals = 0,
  managerState = 'ready',
}: {
  actor: ActorContext;
  pendingApprovals?: number;
  managerState?: 'ready' | 'working' | 'attention' | 'unavailable';
}) {
  const pathname = usePathname();
  const now = useClock();
  const page = PAGE_CONTEXT.find((item) => pathname === item.match || pathname.startsWith(`${item.match}/`)) ?? {
    title: 'Nibrexo',
    subtitle: 'CEO Operating Cockpit',
  };

  const manager = {
    ready: { label: 'Manager ready', tone: 'success' as const, dot: 'bg-emerald-300' },
    working: { label: 'Manager in progress', tone: 'info' as const, dot: 'bg-brand-300' },
    attention: { label: 'Decision needed', tone: 'warning' as const, dot: 'bg-amber-300' },
    unavailable: { label: 'Status unavailable', tone: 'warning' as const, dot: 'bg-amber-300' },
  }[managerState];

  return (
    <header className="sticky top-0 z-30 flex min-h-[76px] items-center justify-between border-b border-surface-border/80 bg-[#09101f]/88 px-5 py-4 backdrop-blur-xl sm:px-7 lg:px-8">
      <div className="min-w-0 pl-12 lg:pl-0">
        <p className="truncate text-base font-semibold tracking-[-0.015em] text-white sm:text-lg">{page.title}</p>
        <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">{page.subtitle}</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {now ? (
          <div className="hidden items-center gap-1.5 text-xs text-slate-500 xl:flex">
            <ClockIcon size={15} />
            <time dateTime={now.toISOString()}>
              {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
              {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </time>
          </div>
        ) : null}

        <Badge tone={manager.tone}>
          <span className={`status-dot ${manager.dot}`} />
          <span className="hidden sm:inline">{manager.label}</span>
          <span className="sm:hidden">Manager</span>
        </Badge>

        {pendingApprovals > 0 ? (
          <Link
            aria-label={`${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting for your decision`}
            className="hidden items-center gap-1.5 rounded-lg border border-amber-300/20 bg-amber-400/10 px-2.5 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-400/15 sm:flex"
            href="/approvals"
          >
            <ShieldCheckIcon size={14} />
            {pendingApprovals} waiting
          </Link>
        ) : null}

        <Link className="btn-primary hidden min-h-9 rounded-lg px-3 py-1.5 text-xs sm:inline-flex" href="/manager">
          <CommandIcon size={15} />
          Ask Nibrexo
          <ArrowUpRightIcon size={14} />
        </Link>

        <div className="hidden border-l border-surface-border pl-3 text-right lg:block">
          <p className="max-w-32 truncate text-xs font-medium text-slate-200">{actor.fullName ?? 'Nibrexo user'}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">{roleLabel(actor.role)}</p>
        </div>

        {actor.isDevIdentity ? <Badge tone="warning">Dev</Badge> : null}
      </div>
    </header>
  );
}
