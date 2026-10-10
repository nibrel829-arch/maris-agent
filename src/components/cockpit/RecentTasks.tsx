import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { ArrowUpRightIcon, CommandIcon, ClockIcon } from '@/components/ui/icons';
import { relativeTime } from './ActivityTimeline';
import type { ManagerTaskSnapshot } from '@/types/manager';
import { TASK_TONE, taskStateLabel } from '@/features/manager/status';

const STATE_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = TASK_TONE;

function humanState(state: string): string {
  return taskStateLabel(state);
}

export function RecentTasks({
  tasks,
  limit,
  emptyTitle = 'No Manager work yet',
  emptyDescription = 'Give Nibrexo an outcome to create your first operating record.',
}: {
  tasks: ManagerTaskSnapshot[];
  limit?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const records = limit ? tasks.slice(0, limit) : tasks;
  if (records.length === 0) {
    return <EmptyState description={emptyDescription} icon={<CommandIcon size={19} />} title={emptyTitle} />;
  }

  return (
    <div className="space-y-1.5">
      {records.map((task) => {
        const nextAction = task.result?.nextBestAction?.[0];
        return (
          <Link
            className="group flex items-start gap-3 rounded-xl border border-transparent px-3 py-3 transition hover:border-surface-border hover:bg-surface/55"
            href={`/manager?task=${task.id}`}
            key={task.id}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-300/15 bg-brand-400/10 text-brand-200">
              <CommandIcon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-200 group-hover:text-white">{task.intent?.objective ?? task.request}</span>
                <Badge tone={STATE_TONE[task.state] ?? 'neutral'}>{humanState(task.state)}</Badge>
              </span>
              <span className="mt-1 block line-clamp-1 text-xs leading-5 text-slate-500">
                {nextAction ? nextAction.title : task.request}
              </span>
              <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-600">
                <ClockIcon size={12} />
                {relativeTime(task.updatedAt || task.createdAt)}
              </span>
            </span>
            <ArrowUpRightIcon className="mt-1 shrink-0 text-slate-600 transition group-hover:text-brand-300" size={15} />
          </Link>
        );
      })}
    </div>
  );
}

export { STATE_TONE, humanState };
