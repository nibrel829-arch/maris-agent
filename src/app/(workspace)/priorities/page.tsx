import Link from 'next/link';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { RecentTasks } from '@/components/cockpit/RecentTasks';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, TargetIcon } from '@/components/ui/icons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import type { ManagerTaskSnapshot } from '@/types/manager';

export const dynamic = 'force-dynamic';

type FocusItem = {
  task: ManagerTaskSnapshot;
  label: string;
  reason: string;
  action: string;
  tone: 'warning' | 'danger' | 'info' | 'success';
};

function focusItems(tasks: ManagerTaskSnapshot[]): FocusItem[] {
  return tasks
    .map((task): FocusItem | null => {
      if (task.state === 'WAITING_APPROVAL') {
        return {
          task,
          label: 'Decision waiting',
          reason: 'The Manager completed the work it can do safely and is paused for your approval.',
          action: 'Review the decision',
          tone: 'warning',
        };
      }
      if (task.state === 'FAILED') {
        return {
          task,
          label: 'Needs attention',
          reason: task.error ?? task.result?.summary ?? 'This work needs review before it can continue.',
          action: 'Review what is blocked',
          tone: 'danger',
        };
      }
      const next = task.result?.nextBestAction?.[0];
      if (next) {
        return {
          task,
          label: task.state === 'COMPLETED' ? 'Follow through' : 'In progress',
          reason: next.rationale,
          action: next.title,
          tone: task.state === 'COMPLETED' ? 'success' : 'info',
        };
      }
      return null;
    })
    .filter((item): item is FocusItem => Boolean(item));
}

export default async function PrioritiesPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const tasks = await repoResult.data.tasks.list(actorResult.data.organizationId, { limit: 30 });
  const focus = focusItems(tasks);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        description="A deliberately short list of work that is blocked, needs follow-through, or represents the strongest next move. Nothing is added just to fill the screen."
        title="Priorities"
        actions={<Link className="btn-primary" href="/manager">Set a new priority <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Priority queue">
          {focus.length === 0 ? (
            <EmptyState
              action={<Link className="btn-primary" href="/manager">Give Nibrexo a priority <ArrowRightIcon size={15} /></Link>}
              description="There are no active priorities on record. The Manager will create a focused queue when it has an objective, a decision or a blocked action to evaluate."
              icon={<TargetIcon size={19} />}
              title="Nothing needs your attention right now"
            />
          ) : (
            <ol className="space-y-3">
              {focus.map((item, index) => (
                <li className="rounded-xl border border-surface-border bg-surface/40 p-4" key={item.task.id}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-xs font-semibold text-slate-300">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold leading-5 text-slate-100">{item.task.intent?.objective ?? item.task.request}</p>
                        <Badge tone={item.tone}>{item.label}</Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{item.reason}</p>
                      <Link className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href={`/manager?task=${item.task.id}`}>
                        {item.action} <ArrowRightIcon size={14} />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Manager context">
          <p className="mb-3 text-sm leading-6 text-slate-400">Recent work is available here so you can choose priorities with context instead of reacting to isolated updates.</p>
          <RecentTasks tasks={tasks.slice(0, 6)} />
        </Card>
      </div>
    </div>
  );
}
