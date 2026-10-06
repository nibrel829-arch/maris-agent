import type { ReactNode } from 'react';
import { DocumentIcon } from './icons';

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES = {
  neutral: 'bg-slate-400/10 text-slate-300 ring-1 ring-inset ring-slate-400/15',
  info: 'bg-brand-400/10 text-brand-200 ring-1 ring-inset ring-brand-300/20',
  success: 'bg-emerald-400/10 text-emerald-200 ring-1 ring-inset ring-emerald-300/20',
  warning: 'bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-300/20',
  danger: 'bg-red-400/10 text-red-200 ring-1 ring-inset ring-red-300/20',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? <DocumentIcon size={19} />}</div>
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div aria-live="polite" className="rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
      {message}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent = 'brand',
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'brand' | 'emerald' | 'amber' | 'slate';
}) {
  const accentClass = {
    brand: 'bg-brand-400',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    slate: 'bg-slate-400',
  }[accent];

  return (
    <div className="panel relative overflow-hidden p-4">
      <span className={`absolute left-0 top-0 h-full w-0.5 ${accentClass}`} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-surface-border/60 py-3 last:border-0 last:pb-0 first:pt-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="max-w-[65%] text-right text-sm text-slate-200">{value}</span>
    </div>
  );
}

export function LoadingLines({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton h-4"
          style={{ width: `${index === rows - 1 ? 56 : 100 - index * 9}%` }}
        />
      ))}
    </div>
  );
}
