'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowUpRightIcon, CheckIcon, ClockIcon, CloseIcon, ShieldCheckIcon } from '@/components/ui/icons';
import type { ApprovalRecord } from '@/types/domain';

interface ApiEnvelope {
  ok: boolean;
  error?: { message?: string };
}

function approvalTone(status: ApprovalRecord['status'] | 'expired') {
  if (status === 'approved') return 'success' as const;
  if (status === 'rejected' || status === 'cancelled') return 'danger' as const;
  if (status === 'pending' || status === 'expired') return 'warning' as const;
  return 'neutral' as const;
}

function expirationLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Expiry unavailable';
  const difference = date.getTime() - Date.now();
  if (difference <= 0) return 'Expired';
  if (difference < 3_600_000) return `Expires in ${Math.max(1, Math.ceil(difference / 60_000))}m`;
  if (difference < 86_400_000) return `Expires in ${Math.ceil(difference / 3_600_000)}h`;
  return `Expires ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function ApprovalQueue({
  approvals,
  canDecide,
  compact = false,
  emptyTitle = 'Nothing is waiting for you',
  emptyDescription = 'Nibrexo will bring external, high-impact and destructive actions here before they run.',
  onDecisionComplete,
}: {
  approvals: ApprovalRecord[];
  canDecide: boolean;
  compact?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onDecisionComplete?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approval: ApprovalRecord, decision: 'approved' | 'rejected') {
    setWorkingId(approval.id);
    setError(null);

    try {
      const response = await fetch(`/api/manager/approvals/${approval.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const payload = (await response.json()) as ApiEnvelope;
      if (!response.ok || !payload.ok) {
        setError(payload.error?.message ?? 'Could not save that decision.');
        return;
      }

      if (decision === 'approved' && approval.task_id) {
        const resumed = await fetch(`/api/manager/tasks/${approval.task_id}/resume`, { method: 'POST' });
        const resumePayload = (await resumed.json()) as ApiEnvelope;
        if (!resumed.ok || !resumePayload.ok) {
          setError(
            resumePayload.error?.message ??
              'Your approval was saved, but the Manager could not resume automatically. Open the task to retry.',
          );
        }
      }

      router.refresh();
      await onDecisionComplete?.();
    } catch {
      setError('Network error while recording your decision. Try again.');
    } finally {
      setWorkingId(null);
    }
  }

  if (approvals.length === 0) {
    return <EmptyState description={emptyDescription} icon={<ShieldCheckIcon size={19} />} title={emptyTitle} />;
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorState message={error} /> : null}
      {approvals.map((approval) => {
        const expired = approval.status === 'pending' && new Date(approval.expires_at).getTime() <= Date.now();
        const displayStatus = expired ? 'expired' : approval.status;
        const busy = workingId === approval.id;
        return (
          <article className={`rounded-xl border border-surface-border bg-surface/45 ${compact ? 'p-3.5' : 'p-4'}`} key={approval.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">{approval.action}</h3>
                  <Badge tone={approvalTone(displayStatus)}>{displayStatus}</Badge>
                  <Badge tone={approval.risk === 'high' ? 'warning' : approval.risk === 'medium' ? 'info' : 'neutral'}>
                    {approval.risk} risk
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{approval.summary || approval.reason}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
                <ClockIcon size={13} />
                {expirationLabel(approval.expires_at)}
              </span>
            </div>

            {!compact ? (
              <div className="mt-3 rounded-lg border border-surface-border/70 bg-[#0a1323]/65 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Why this needs you</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{approval.reason}</p>
              </div>
            ) : null}

            {approval.status === 'pending' && !expired ? (
              canDecide ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button className="btn-primary min-h-9 rounded-lg px-3 text-xs" disabled={busy} onClick={() => void decide(approval, 'approved')} type="button">
                    <CheckIcon size={15} />
                    {busy ? 'Saving…' : 'Approve & continue'}
                  </button>
                  <button className="btn-danger min-h-9 rounded-lg px-3 text-xs" disabled={busy} onClick={() => void decide(approval, 'rejected')} type="button">
                    <CloseIcon size={15} />
                    Reject
                  </button>
                  {approval.task_id ? (
                    <a className="ml-auto inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200" href={`/manager?task=${approval.task_id}`}>
                      Open task <ArrowUpRightIcon size={13} />
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-xs leading-5 text-amber-200">Your role can review this decision, but an owner or admin must approve or reject it.</p>
              )
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
