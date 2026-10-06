import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { resolveActor } from '@/server/auth/actor';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

/**
 * Workspace shell (PDF #07 §5).
 *
 * The shell resolves identity server-side. When Supabase is not configured and
 * the development identity is disabled, it shows a configuration state rather
 * than rendering an empty dashboard (PDF #04 §4 loading/empty/error states).
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const actorResult = await resolveActor();
  const env = publicEnv();

  if (!actorResult.ok) {
    if (!env.supabaseConfigured) {
      return <ConfigurationRequired reason={actorResult.error.message} />;
    }
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="card max-w-md text-center">
          <h1 className="text-lg font-semibold text-white">Sign in required</h1>
          <p className="mt-2 text-sm text-slate-400">{actorResult.error.message}</p>
          <a href="/login" className="btn-primary mt-4 inline-flex">
            Go to sign in
          </a>
        </div>
      </main>
    );
  }

  const actor = actorResult.data;

  return (
    <div className="flex min-h-screen">
      <Sidebar role={actor.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          actor={actor}
          title="Nibrexo OS AI"
          subtitle="Central CEO / Manager operating system"
        />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
