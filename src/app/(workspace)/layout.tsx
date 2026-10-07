import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

/**
 * Workspace shell.
 *
 * Identity is resolved server-side. The shell presents an honest configuration
 * state when neither a real session nor explicitly enabled local development
 * identity is available.
 */
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const actorResult = await resolveActor();
  const env = publicEnv();

  if (!actorResult.ok) {
    if (!env.supabaseConfigured) {
      return <ConfigurationRequired reason={actorResult.error.message} />;
    }
    return (
      <main className="flex min-h-screen items-center justify-center p-6 sm:p-8">
        <div className="card max-w-md text-center">
          <p className="page-eyebrow">Nibrexo CEO Operating Cockpit</p>
          <h1 className="mt-2 text-xl font-semibold text-white">Sign in required</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{actorResult.error.message}</p>
          <a href="/login" className="btn-primary mt-5 inline-flex">
            Go to sign in
          </a>
        </div>
      </main>
    );
  }

  const actor = actorResult.data;
  let pendingApprovals = 0;
  let managerState: 'ready' | 'working' | 'attention' | 'unavailable' = 'ready';

  const repository = await getRequestRepository();
  if (repository.ok) {
    try {
      const [approvals, tasks] = await Promise.all([
        repository.data.approvals.list(actor.organizationId, { limit: 50 }),
        repository.data.tasks.list(actor.organizationId, { limit: 8 }),
      ]);
      pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length;
      if (pendingApprovals > 0) managerState = 'attention';
      else if (tasks.some((task) => ['RECEIVED', 'PLANNING', 'EXECUTING', 'VERIFYING'].includes(task.state))) {
        managerState = 'working';
      }
    } catch {
      // Page-level data loaders retain the detailed error path. The shell must
      // remain usable when its small status summary cannot be read.
      managerState = 'unavailable';
    }
  } else {
    managerState = 'unavailable';
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar role={actor.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar actor={actor} managerState={managerState} pendingApprovals={pendingApprovals} />
        <main className="flex-1 overflow-x-hidden p-5 pt-6 sm:p-7 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
