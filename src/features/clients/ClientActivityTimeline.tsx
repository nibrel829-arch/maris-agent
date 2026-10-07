import { EmptyState } from '@/components/ui/primitives';
import { ClockIcon } from '@/components/ui/icons';
import { relativeTime } from '@/components/cockpit/ActivityTimeline';
import type { ClientActivity } from '@/types/domain';

const KIND_LABEL: Record<string, string> = {
  note: 'Note',
  email: 'Email',
  call: 'Call',
  meeting: 'Meeting',
  status_change: 'Status change',
  lead_created: 'Record created',
  lead_qualified: 'Qualified',
  task: 'Task',
};

/**
 * Client timeline. The `kind` column is free text, so future modules (email
 * sends, conversations, social interactions, automation events, AI actions)
 * attach new entries without a schema change — they only need a label here.
 */
export function ClientActivityTimeline({ activity }: { activity: ClientActivity[] }) {
  if (activity.length === 0) {
    return (
      <EmptyState
        description="Timeline entries appear here as the record is created, updated and worked."
        icon={<ClockIcon size={19} />}
        title="No activity yet"
      />
    );
  }

  return (
    <ol className="relative">
      {activity.map((entry, index) => (
        <li className="relative flex gap-3 pb-5 last:pb-0" key={entry.id}>
          {index !== activity.length - 1 ? (
            <span className="absolute left-[15px] top-8 h-[calc(100%-13px)] w-px bg-surface-border" />
          ) : null}
          <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface text-slate-400">
            <ClockIcon size={15} />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-200">{entry.subject}</p>
              <time
                className="text-[11px] text-slate-500"
                dateTime={entry.created_at}
                title={new Date(entry.created_at).toLocaleString()}
              >
                {relativeTime(entry.created_at)}
              </time>
            </div>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-slate-500">
              {KIND_LABEL[entry.kind] ?? entry.kind.replace(/_/g, ' ')}
            </p>
            {entry.body ? (
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-400">{entry.body}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
