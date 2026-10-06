import { Badge, EmptyState } from '@/components/ui/primitives';
import { CheckIcon, ClockIcon, DocumentIcon, ShieldCheckIcon, SparkIcon } from '@/components/ui/icons';
import type { ActivityLog } from '@/types/domain';

const ACTION_DETAILS: Record<string, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral'; icon: 'task' | 'approval' | 'artifact' | 'done' }> = {
  'manager.task.created': { label: 'Manager task started', tone: 'info', icon: 'task' },
  'manager.task.resumed': { label: 'Manager task resumed', tone: 'info', icon: 'task' },
  'manager.task.completed': { label: 'Manager task completed', tone: 'success', icon: 'done' },
  'manager.task.failed': { label: 'Manager task needs attention', tone: 'warning', icon: 'task' },
  'manager.step.executed': { label: 'Manager step completed', tone: 'success', icon: 'done' },
  'manager.step.denied': { label: 'Manager step was stopped', tone: 'warning', icon: 'task' },
  'manager.approval.requested': { label: 'Approval requested', tone: 'warning', icon: 'approval' },
  'manager.approval.decided': { label: 'Approval decided', tone: 'success', icon: 'approval' },
  'research.brief_created': { label: 'Research brief saved', tone: 'info', icon: 'artifact' },
  'content.created': { label: 'Content draft created', tone: 'info', icon: 'artifact' },
  'email.prepared': { label: 'Email prepared', tone: 'info', icon: 'artifact' },
  'email.sent': { label: 'Email sent', tone: 'success', icon: 'done' },
  'lead.created': { label: 'Lead recorded', tone: 'info', icon: 'artifact' },
  'lead.qualified': { label: 'Lead qualified', tone: 'success', icon: 'done' },
  'report.generated': { label: 'Business report generated', tone: 'info', icon: 'artifact' },
  'quality.check_run': { label: 'Quality check completed', tone: 'success', icon: 'done' },
};

function EventIcon({ icon }: { icon: 'task' | 'approval' | 'artifact' | 'done' }) {
  const className = 'h-4 w-4';
  if (icon === 'approval') return <ShieldCheckIcon className={className} size={16} />;
  if (icon === 'artifact') return <DocumentIcon className={className} size={16} />;
  if (icon === 'done') return <CheckIcon className={className} size={16} />;
  return <SparkIcon className={className} size={16} />;
}

export function actionDetail(action: string) {
  return ACTION_DETAILS[action] ?? {
    label: action.replace(/[._]/g, ' '),
    tone: 'neutral' as const,
    icon: 'task' as const,
  };
}

export function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  const difference = Date.now() - timestamp;
  if (Number.isNaN(timestamp)) return 'Time unavailable';
  if (difference < 60_000) return 'Just now';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ActivityTimeline({
  activity,
  emptyTitle = 'No decisions recorded yet',
  emptyDescription = 'Manager work, approvals and saved artifacts will form a clear operating record here.',
  limit,
}: {
  activity: ActivityLog[];
  emptyTitle?: string;
  emptyDescription?: string;
  limit?: number;
}) {
  const records = limit ? activity.slice(0, limit) : activity;

  if (records.length === 0) {
    return <EmptyState description={emptyDescription} icon={<ClockIcon size={19} />} title={emptyTitle} />;
  }

  return (
    <ol className="relative space-y-0">
      {records.map((log, index) => {
        const detail = actionDetail(log.action);
        const decision = typeof log.metadata?.decision === 'string' ? log.metadata.decision : null;
        return (
          <li className="relative flex gap-3 pb-5 last:pb-0" key={log.id}>
            {index !== records.length - 1 ? <span className="absolute left-[15px] top-8 h-[calc(100%-13px)] w-px bg-surface-border" /> : null}
            <span
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                detail.tone === 'success'
                  ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
                  : detail.tone === 'warning'
                    ? 'border-amber-300/20 bg-amber-400/10 text-amber-200'
                    : detail.tone === 'info'
                      ? 'border-brand-300/20 bg-brand-400/10 text-brand-200'
                      : 'border-surface-border bg-surface text-slate-400'
              }`}
            >
              <EventIcon icon={detail.icon} />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-200">{detail.label}</p>
                <time className="text-[11px] text-slate-500" dateTime={log.created_at} title={new Date(log.created_at).toLocaleString()}>
                  {relativeTime(log.created_at)}
                </time>
              </div>
              {decision ? <Badge tone={decision === 'approved' ? 'success' : 'warning'}>{decision}</Badge> : null}
              {log.entity_type ? <p className="mt-1 text-xs text-slate-500">{log.entity_type.replace(/_/g, ' ')}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
