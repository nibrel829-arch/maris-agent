import Link from 'next/link';
import { ApprovalQueue } from '@/components/cockpit/ApprovalQueue';
import { ActivityTimeline } from '@/components/cockpit/ActivityTimeline';
import { ManagerCommand } from '@/components/cockpit/ManagerCommand';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { RecentTasks } from '@/components/cockpit/RecentTasks';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, LightbulbIcon, TargetIcon, TrendIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { actionsFor } from '@/server/auth/permissions';
import { getRequestRepository } from '@/server/db';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { publicEnv } from '@/lib/env';
import type { ManagerTaskSnapshot } from '@/types/manager';

export const dynamic = 'force-dynamic';

type Priority = {
  id: string;
  title: string;
  reason: string;
  nextAction: string;
  href: string;
  tone: 'info' | 'warning' | 'danger' | 'success';
};

function prioritiesFrom(tasks: ManagerTaskSnapshot[]): Priority[] {
  const priorities: Priority[] = [];

  for (const task of tasks) {
    if (task.state === 'WAITING_APPROVAL') {
      priorities.push({
        id: `approval-${task.id}`,
        title: task.intent?.objective ?? task.request,
        reason: 'The Manager is paused until you make a decision on a consequential action.',
        nextAction: 'Review the pending approval',
        href: `/manager?task=${task.id}`,
        tone: 'warning',
      });
      continue;
    }

    if (task.state === 'FAILED') {
      priorities.push({
        id: `issue-${task.id}`,
        title: task.intent?.objective ?? task.request,
        reason: task.error ?? 'The Manager could not complete this work as planned.',
        nextAction: 'Review what is needed to continue',
        href: `/manager?task=${task.id}`,
        tone: 'danger',
      });
      continue;
    }

    const action = task.result?.nextBestAction?.[0];
    if (action) {
      priorities.push({
        id: `next-${task.id}`,
        title: action.title,
        reason: action.rationale,
        nextAction: action.requiresApproval ? 'Review the decision path' : 'Continue in the Manager workspace',
        href: `/manager?task=${task.id}`,
        tone: task.state === 'COMPLETED' ? 'success' : 'info',
      });
    }
  }

  return priorities.slice(0, 4);
}

export default async function DashboardPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  }

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  const [counts, approvals, activity, tasks] = await Promise.all([
    repo.counts(actor.organizationId),
    repo.approvals.list(actor.organizationId, { limit: 50 }),
    repo.activityLogs.list(actor.organizationId, { limit: 12 }),
    repo.tasks.list(actor.organizationId, { limit: 12 }),
  ]);

  const pending = approvals.filter((approval) => approval.status === 'pending');
  const priorities = prioritiesFrom(tasks);
  const recommendation = priorities[0] ?? null;
  const canDecide = actionsFor(actor.role, 'settings').includes('edit');
  const leadCount = counts.leads ?? 0;
  const researchCount = counts.research_briefs ?? 0;
  const contentCount = counts.content_items ?? 0;

  return (
    <div className="mx-auto max-w-[1540px] space-y-6">
      <PageHeader
        description="A focused, honest view of what Nibrexo needs to do, what is moving, and where your judgment is needed."
        title="CEO cockpit"
        actions={
          <Link className="btn-secondary" href="/manager">
            Open Manager workspace <ArrowRightIcon size={15} />
          </Link>
        }
      />

      <ManagerCommand
        compact
        description="Set a direction, investigate an opportunity, create a plan or move work forward. Nibrexo will show its progress in human terms and hold guarded actions for your decision."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.8fr)]">
        <div className="space-y-6">
          <Card
            title="What needs attention"
            action={<Link className="text-xs font-medium text-brand-300 hover:text-brand-200" href="/priorities">View all priorities</Link>}
          >
            {priorities.length === 0 ? (
              <EmptyState
                action={<Link className="btn-primary" href="/manager">Give the Manager a priority <ArrowRightIcon size={15} /></Link>}
                description="No active priorities are on record. Start with the one outcome that would make the most useful difference this week."
                icon={<TargetIcon size={19} />}
                title="The runway is clear"
              />
            ) : (
              <div className="divide-y divide-surface-border/65">
                {priorities.map((priority, index) => (
                  <Link className="group flex gap-3 py-4 first:pt-0 last:pb-0" href={priority.href} key={priority.id}>
                    <span
                      className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                        priority.tone === 'warning'
                          ? 'bg-amber-400/10 text-amber-200'
                          : priority.tone === 'danger'
                            ? 'bg-red-400/10 text-red-200'
                            : priority.tone === 'success'
                              ? 'bg-emerald-400/10 text-emerald-200'
                              : 'bg-brand-400/10 text-brand-200'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-sm font-medium leading-5 text-slate-100 group-hover:text-white">{priority.title}</span>
                        <ArrowRightIcon className="mt-0.5 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-brand-300" size={15} />
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">{priority.reason}</span>
                      <span className="mt-2 block text-xs font-medium text-brand-300">Next: {priority.nextAction}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Manager activity"
              action={<Link className="text-xs font-medium text-brand-300 hover:text-brand-200" href="/activity">View timeline</Link>}
            >
              <ActivityTimeline activity={activity} limit={5} />
            </Card>
            <Card
              title="Recent context"
              action={<Link className="text-xs font-medium text-brand-300 hover:text-brand-200" href="/manager">Open workspace</Link>}
            >
              <RecentTasks tasks={tasks} limit={4} />
            </Card>
          </div>
        </div>

        <aside className="space-y-6">
          <Card
            title="Your decisions"
            action={
              pending.length > 0 ? <Badge tone="warning">{pending.length} waiting</Badge> : <Badge tone="success">Clear</Badge>
            }
          >
            <ApprovalQueue approvals={pending.slice(0, 3)} canDecide={canDecide} compact />
            {pending.length > 3 ? (
              <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/approvals">
                See all {pending.length} decisions <ArrowRightIcon size={14} />
              </Link>
            ) : null}
          </Card>

          <Card title="Next best action">
            {recommendation ? (
              <div>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-300/20 bg-brand-400/10 text-brand-200">
                  <LightbulbIcon size={18} />
                </span>
                <h2 className="mt-4 text-base font-semibold leading-6 text-white">{recommendation.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{recommendation.reason}</p>
                <Link className="btn-primary mt-5 w-full" href={recommendation.href}>
                  {recommendation.nextAction} <ArrowRightIcon size={15} />
                </Link>
              </div>
            ) : (
              <EmptyState
                action={<Link className="btn-primary" href="/manager">Choose an outcome <ArrowRightIcon size={15} /></Link>}
                description="Nibrexo will make one evidence-based recommendation after it has work and context to evaluate."
                icon={<LightbulbIcon size={19} />}
                title="No recommendation yet"
              />
            )}
          </Card>

          <Card title="Operating record">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-slate-400">Opportunities</span>
                <span className="text-sm font-medium text-slate-200">
                  {leadCount === 0 ? 'No active opportunities yet' : `${leadCount} recorded lead${leadCount === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-slate-400">Research</span>
                <span className="text-sm font-medium text-slate-200">
                  {researchCount === 0 ? 'No briefs yet' : `${researchCount} saved brief${researchCount === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-slate-400">Marketing</span>
                <span className="text-sm font-medium text-slate-200">
                  {contentCount === 0 ? 'No content in motion' : `${contentCount} content item${contentCount === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
            <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/reports">
              Open business reporting <TrendIcon size={14} />
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
