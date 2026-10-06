import { serverEnv } from '@/lib/env';

/**
 * Honest configuration state (CEO spec §11: no fake database success).
 * Shown when Supabase is not configured and no dev identity is enabled.
 */
export function ConfigurationRequired({ reason }: { reason: string }) {
  const env = serverEnv();

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="card max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-300">Nibrexo OS AI</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Backend not configured</h1>
        <p className="mt-3 text-sm text-slate-300">{reason}</p>

        <div className="mt-6 space-y-3 text-sm text-slate-400">
          <p>To run the full product, set the Supabase environment variables:</p>
          <ul className="ml-5 list-disc space-y-1 font-mono text-xs text-slate-300">
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
            <li>SUPABASE_SERVICE_ROLE_KEY (server-side jobs only)</li>
          </ul>
          <p>
            For local development without Supabase, set{' '}
            <span className="font-mono text-slate-200">NIBREXO_DATA_BACKEND=memory</span> and{' '}
            <span className="font-mono text-slate-200">NIBREXO_DEV_AUTH=1</span>. The in-memory
            backend is refused in production.
          </p>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-surface-border p-3">
            <dt className="text-xs text-slate-500">Supabase</dt>
            <dd className={env.supabaseConfigured ? 'text-emerald-300' : 'text-amber-300'}>
              {env.supabaseConfigured ? 'configured' : 'not configured'}
            </dd>
          </div>
          <div className="rounded-lg border border-surface-border p-3">
            <dt className="text-xs text-slate-500">AI provider</dt>
            <dd className={env.aiEnabled ? 'text-emerald-300' : 'text-amber-300'}>
              {env.aiEnabled ? env.aiModel : 'not configured'}
            </dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
