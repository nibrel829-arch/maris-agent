import Link from 'next/link';
import { ApprovalQueue } from '@/components/cockpit/ApprovalQueue';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, ClockIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { actionsFor } from '@/server/auth/permissions';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const approvals = await repoResult.data.approvals.list(actor.organizationId, { limit: 100 });
  const pending = approvals.filter((approval) => approval.status === 'pending');
  const history = approvals.filter((approval) => approval.status !== 'pending');
  const canDecide = actionsFor(actor.role, 'settings').includes('edit');

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        description="Nibrexo does not take external, high-impact or destructive action without an explicit decision. Each request states what will happen and why it needs you."
        title="Approval center"
        actions={
          <Badge tone={pending.length > 0 ? 'warning' : 'success'}>
            <ShieldCheckIcon size={13} />
            {pending.length === 0 ? 'No decisions waiting' : `${pending.length} decision${pending.length === 1 ? '' : 's'} waiting`}
          </Badge>
        }
      />

      {!canDecide ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-400/[0.07] px-4 py-3 text-sm leading-6 text-amber-100">
          You can review the approval queue. An owner or admin must make the final decision.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card title="Waiting for your decision">
          <ApprovalQueue
            approvals={pending}
            canDecide={canDecide}
            emptyDescription="There are no protected actions waiting to run. Nibrexo will bring the next consequential action here before it proceeds."
            emptyTitle="The decision queue is clear"
          />
        </Card>

        <Card title="How decisions work">
          <div className="space-y-4 text-sm leading-6 text-slate-400">
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-300/15 bg-brand-400/10 text-brand-200">1</span>
              <p><span className="font-medium text-slate-200">Nibrexo prepares the action.</span> It can research, draft and verify before it asks for a decision.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-300/15 bg-brand-400/10 text-brand-200">2</span>
              <p><span className="font-medium text-slate-200">You see the reason and risk.</span> Approval is never a blind confirmation.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-300/15 bg-brand-400/10 text-brand-200">3</span>
              <p><span className="font-medium text-slate-200">Only a valid approval lets work resume.</span> Rejected and expired approvals cannot be reused.</p>
            </div>
          </div>
          <Link className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/manager">
            Open Manager workspace <ArrowRightIcon size={14} />
          </Link>
        </Card>
      </div>

      <Card title="Decision record" action={history.length > 0 ? <Badge>{history.length} recorded</Badge> : null}>
        {history.length === 0 ? (
          <EmptyState description="Approved, rejected, expired and cancelled actions will be retained here as a transparent decision record." icon={<ClockIcon size={19} />} title="No decisions recorded yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="table-header">
                <tr>
                  <th className="px-2 py-3">Action</th>
                  <th className="px-2 py-3">Risk</th>
                  <th className="px-2 py-3">Decision</th>
                  <th className="px-2 py-3">Recorded</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {history.map((approval) => (
                  <tr className="table-row" key={approval.id}>
                    <td className="px-2 py-3 font-medium text-slate-200">{approval.action}</td>
                    <td className="px-2 py-3"><Badge tone={approval.risk === 'high' ? 'warning' : 'neutral'}>{approval.risk}</Badge></td>
                    <td className="px-2 py-3"><Badge tone={approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'danger' : 'neutral'}>{approval.status}</Badge></td>
                    <td className="px-2 py-3 text-xs text-slate-500">{new Date(approval.decided_at ?? approval.created_at).toLocaleString()}</td>
                    <td className="px-2 py-3 text-right">
                      {approval.task_id ? <Link className="text-xs font-medium text-brand-300 hover:text-brand-200" href={`/manager?task=${approval.task_id}`}>View work</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
