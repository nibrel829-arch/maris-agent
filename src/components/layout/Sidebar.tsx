'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ComponentType } from 'react';
import type { OrgRole } from '@/types/domain';
import type { ModuleId } from '@/types/manager';
import {
  CheckIcon,
  CloseIcon,
  CommandIcon,
  DocumentIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  LightbulbIcon,
  MenuIcon,
  PulseIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrendIcon,
  UserGroupIcon,
} from '@/components/ui/icons';

interface NavItem {
  href: string;
  label: string;
  module: ModuleId;
  icon: ComponentType<{ size?: number; className?: string }>;
  primary?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAVIGATION: NavGroup[] = [
  {
    label: 'Command',
    items: [
      { href: '/dashboard', label: 'CEO cockpit', module: 'dashboard', icon: HomeIcon },
      { href: '/manager', label: 'Manager workspace', module: 'ai', icon: CommandIcon, primary: true },
    ],
  },
  {
    label: 'Focus',
    items: [
      { href: '/priorities', label: 'Priorities', module: 'ai', icon: TargetIcon },
      { href: '/approvals', label: 'Approval center', module: 'ai', icon: ShieldCheckIcon },
      { href: '/activity', label: 'Decision timeline', module: 'dashboard', icon: PulseIcon },
    ],
  },
  {
    label: 'Workspaces',
    items: [
      { href: '/research', label: 'Research', module: 'ai', icon: SearchIcon },
      { href: '/product', label: 'Product', module: 'ai', icon: LightbulbIcon },
      { href: '/leads', label: 'Leads', module: 'clients', icon: UserGroupIcon },
      { href: '/marketing', label: 'Marketing', module: 'content', icon: LayersIcon },
      { href: '/reports', label: 'Business reporting', module: 'ai', icon: TrendIcon },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/clients', label: 'Relationships', module: 'clients', icon: UserGroupIcon },
      { href: '/emails', label: 'Email', module: 'email', icon: DocumentIcon },
      { href: '/social', label: 'Channels', module: 'social', icon: PulseIcon },
      { href: '/inbox', label: 'Inbox', module: 'inbox', icon: InboxIcon },
    ],
  },
  {
    label: 'System',
    items: [{ href: '/settings', label: 'Settings', module: 'settings', icon: SettingsIcon }],
  },
];

/** Modules a role can at least view — mirrors the backend permission matrix. */
const VISIBLE: Record<OrgRole, ModuleId[]> = {
  owner: ['dashboard', 'ai', 'clients', 'content', 'social', 'inbox', 'email', 'settings'],
  admin: ['dashboard', 'ai', 'clients', 'content', 'social', 'inbox', 'email', 'settings'],
  member: ['dashboard', 'ai', 'clients', 'content', 'social', 'inbox', 'email'],
  client: ['dashboard', 'content', 'inbox', 'clients', 'email', 'ai'],
};

function NibrexoMark() {
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-500 text-sm font-bold text-white shadow-[0_7px_18px_rgba(40,100,221,0.26)]">
      N
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-tl-lg bg-emerald-300/90" />
    </span>
  );
}

export function Sidebar({ role }: { role: OrgRole }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const allowed = VISIBLE[role] ?? VISIBLE.member;

  const isActive = (href: string) => {
    if (href === '/manager') return pathname === '/manager' || pathname === '/ai';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <button
        aria-expanded={mobileOpen}
        aria-label="Open navigation"
        className="icon-button fixed left-4 top-4 z-40 bg-surface/95 lg:hidden"
        onClick={() => setMobileOpen(true)}
        type="button"
      >
        <MenuIcon size={20} />
      </button>

      {mobileOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-[#030815]/70 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-surface-border bg-[#0b1425]/95 shadow-[18px_0_50px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-5 pt-6">
          <Link className="flex items-center gap-3" href="/manager" onClick={() => setMobileOpen(false)}>
            <NibrexoMark />
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.17em] text-brand-300">
                NIBREXO
              </span>
              <span className="mt-0.5 block text-sm font-semibold tracking-tight text-white">
                CEO Operating Cockpit
              </span>
            </span>
          </Link>
          <button
            aria-label="Close navigation"
            className="icon-button h-8 w-8 border-transparent lg:hidden"
            onClick={() => setMobileOpen(false)}
            type="button"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="mx-4 mb-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.055] px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-100">
            <span className="status-dot bg-emerald-300 shadow-[0_0_0_3px_rgba(110,231,183,0.08)]" />
            Human-in-the-loop Manager
          </div>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">One operating brain, with guarded actions.</p>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 pb-5">
          {NAVIGATION.map((group) => {
            const items = group.items.filter((item) => allowed.includes(item.module));
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-5 last:mb-0">
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {items.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        aria-current={active ? 'page' : undefined}
                        key={item.href}
                        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                          active
                            ? 'bg-brand-500/13 text-white ring-1 ring-inset ring-brand-300/20'
                            : item.primary
                              ? 'bg-white/[0.035] text-slate-200 hover:bg-white/[0.07] hover:text-white'
                              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                        }`}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                      >
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                            active
                              ? 'bg-brand-400/15 text-brand-200'
                              : 'text-slate-500 group-hover:bg-surface-raised group-hover:text-slate-300'
                          }`}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="flex-1 font-medium">{item.label}</span>
                        {item.primary && !active ? <span className="h-1.5 w-1.5 rounded-full bg-brand-300" /> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="m-4 rounded-xl border border-surface-border/80 bg-surface/55 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <CheckIcon className="text-emerald-300" size={15} />
            Human approval stays in control
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
            External, high-impact actions wait for your decision.
          </p>
        </div>
      </aside>
    </>
  );
}
