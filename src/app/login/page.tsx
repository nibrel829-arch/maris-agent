import { LoginForm } from '@/features/auth/LoginForm';
import { Card, EmptyState } from '@/components/ui/primitives';
import { CommandIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Real Supabase Auth entry point. It deliberately offers no development or
 * memory fallback: development identity is resolved server-side only when the
 * explicit non-production flag is set.
 */
export default function LoginPage() {
  const env = publicEnv();

  return (
    <main className="flex min-h-screen items-center justify-center p-5 sm:p-8">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500 text-lg font-bold text-white shadow-[0_10px_25px_rgba(40,100,221,0.25)]">N</span>
          <p className="mt-4 page-eyebrow">NIBREXO CEO OPERATING COCKPIT</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">Sign in to your workspace</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Your organization role and permissions are verified on the server after authentication.</p>
        </div>

        <Card title="Secure sign in">
          {env.supabaseConfigured ? (
            <>
              <LoginForm />
              <div className="mt-5 flex gap-2 rounded-xl border border-surface-border bg-surface/45 p-3 text-xs leading-5 text-slate-500">
                <ShieldCheckIcon className="mt-0.5 shrink-0 text-emerald-300" size={15} />
                Nibrexo uses your Supabase session to load organization membership and apply database row-level security.
              </div>
            </>
          ) : (
            <EmptyState
              description="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable real authentication. A local development identity is never offered as a production sign-in substitute."
              icon={<CommandIcon size={19} />}
              title="Supabase Auth is not configured"
            />
          )}
        </Card>
      </div>
    </main>
  );
}
