'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { OrgRole } from '@/types/domain';
import type { ModuleId } from '@/types/manager';

interface NavItem {
  href: string;
  label: string;
  module: ModuleId;
  description: string;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', module: 'dashboard', description: 'Operational overview' },
  { href: '/ai', label: 'CEO / Manager', module: 'ai', description: 'The Manager workspace' },
  { href: '/clients', label: 'Clients', module: 'clients', description: 'CRM and leads' },
  { href: '/content', label: 'Content', module: 'content', description: 'Library and drafts' },
  { href: '/social', label: 'Social', module: 'social', description: 'Accounts and publishing' },
  { href: '/inbox', label: 'Inbox', module: 'inbox', description: 'Unified messages' },
  { href: '/emails', label: 'Email', module: 'email', description: 'Templates and sequences' },
  { href: '/settings', label: 'Settings', module: 'settings', description: 'Configuration' },
];

/** Modules a role can at least view — mirrors the backend matrix. */
const VISIBLE: Record<OrgRole, ModuleId[]> = {
  owner: ['dashboard', 'ai', 'clients', 'content', 'social', 'inbox', 'email', 'settings'],
  admin: ['dashboard', 'ai', 'clients', 'content', 'social', 'inbox', 'email', 'settings'],
  member: ['dashboard', 'ai', 'clients', 'content', 'social', 'inbox', 'email'],
  client: ['dashboard', 'content', 'inbox', 'clients'],
};

export function Sidebar({ role }: { role: OrgRole }) {
  const pathname = usePathname();
  const allowed = VISIBLE[role] ?? VISIBLE.member;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-surface-border bg-surface">
      <div className="border-b border-surface-border px-5 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-300">Nibrexo OS AI</p>
        <h1 className="mt-1 text-lg font-semibold text-white">CEO / Manager</h1>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.filter((item) => allowed.includes(item.module)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 transition ${
                active
                  ? 'bg-brand-600/20 text-white ring-1 ring-brand-500/40'
                  : 'text-slate-300 hover:bg-surface-raised'
              }`}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="block text-xs text-slate-500">{item.description}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-surface-border p-4 text-xs text-slate-500">
        One central Manager. Skills are capabilities, not separate agents.
      </div>
    </aside>
  );
}
