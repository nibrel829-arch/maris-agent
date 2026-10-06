import { Card, EmptyState, Stat } from '@/components/ui/primitives';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : (
      <ConfigurationRequired reason={actorResult.error.message} />
    );
  }

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) {
    return <ConfigurationRequired reason={repoResult.error.message} />;
  }

  const actor = actorResult.data;
  const repo = repoResult.data;

  const [counts, approvals, activity] = await Promise.all([
    repo.counts(actor.organizationId),
    repo.approvals.list(actor.organizationId, { limit: 20 }),
    repo.activityLogs.list(actor.organizationId, { limit: 10 }),
  ]);

  const pending = approvals.filter((approval) => approval.status === 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Central operational overview. Counts reflect records that actually exist.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clients" value={counts.clients ?? 0} hint="CRM records" />
        <Stat label="Leads" value={counts.leads ?? 0} hint="Recorded with provenance" />
        <Stat label="Content items" value={counts.content_items ?? 0} hint="Drafts and published" />
        <Stat label="Pending approvals" value={pending.length} hint="Awaiting a human decision" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Pending approvals">
          {pending.length === 0 ? (
            <EmptyState
              title="Nothing awaiting approval"
              description="External, high-impact and destructive actions appear here before they run."
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((approval) => (
                <li
                  key={approval.id}
                  className="rounded-lg border border-surface-border p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-100">{approval.action}</span>
                    <span className="text-xs uppercase text-amber-300">{approval.risk} risk</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{approval.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity">
          {activity.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Manager tasks, approvals and external actions are recorded here."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {activity.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-300">{log.action}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
