import { Card, EmptyState } from '@/components/ui/primitives';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Sign-in entry point.
 *
 * Supabase Auth owns the credential flow. Until Supabase is configured this
 * screen states that plainly instead of presenting a fake login that would
 * grant access to nothing.
 */
export default function LoginPage() {
  const env = publicEnv();

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-brand-300">Nibrexo OS AI</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">CEO / Manager Agent</h1>
        </div>

        <Card title="Sign in">
          {env.supabaseConfigured ? (
            <div className="space-y-3">
              <input className="input" placeholder="Email" type="email" name="email" />
              <input className="input" placeholder="Password" type="password" name="password" />
              <button className="btn-primary w-full" type="button">
                Continue
              </button>
              <p className="text-xs text-slate-500">
                The sign-in form is wired in the auth phase. Session verification, role loading and
                server-side authorization are already enforced on every API route.
              </p>
            </div>
          ) : (
            <EmptyState
              title="Supabase Auth is not configured"
              description="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable real authentication. For local development, set NIBREXO_DEV_AUTH=1 to use the flagged development identity."
            />
          )}
        </Card>
      </div>
    </main>
  );
}
