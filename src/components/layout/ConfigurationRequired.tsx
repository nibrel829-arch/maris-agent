import { serverEnv } from '@/lib/env';
import { CommandIcon, ShieldCheckIcon } from '@/components/ui/icons';

/** Honest setup state: no fake database or authentication success is shown. */
export function ConfigurationRequired({ reason }: { reason: string }) {
  const env = serverEnv();

  return (
    <main className="flex min-h-screen items-center justify-center p-5 sm:p-8">
      <div className="card w-full max-w-2xl p-6 sm:p-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-300/20 bg-brand-400/10 text-brand-200">
          <CommandIcon size={19} />
        </span>
        <p className="mt-5 page-eyebrow">NIBREXO CEO OPERATING COCKPIT</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">Backend not configured</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{reason}</p>

        <div className="mt-6 rounded-xl border border-surface-border bg-surface/45 p-4">
          <p className="text-sm font-medium text-slate-200">To run the full product, configure Supabase:</p>
          <ul className="mt-3 space-y-1.5 font-mono text-xs leading-5 text-slate-400">
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
            <li>SUPABASE_SERVICE_ROLE_KEY <span className="font-sans text-slate-500">(server-side jobs only)</span></li>
          </ul>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-400">
          For local development only, set <span className="font-mono text-slate-300">NIBREXO_DATA_BACKEND=memory</span> and{' '}
          <span className="font-mono text-slate-300">NIBREXO_DEV_AUTH=1</span>. The in-memory backend is refused in production.
        </p>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-surface-border bg-surface/35 p-3.5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Supabase</dt>
            <dd className={`mt-2 flex items-center gap-2 text-sm font-medium ${env.supabaseConfigured ? 'text-emerald-200' : 'text-amber-200'}`}><ShieldCheckIcon size={15} />{env.supabaseConfigured ? 'Configured' : 'Not configured'}</dd>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface/35 p-3.5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">AI provider</dt>
            <dd className={`mt-2 text-sm font-medium ${env.aiEnabled ? 'text-emerald-200' : 'text-amber-200'}`}>{env.aiEnabled ? env.aiModel : 'Not configured'}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
