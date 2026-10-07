'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, EmptyState, ErrorState } from '@/components/ui/primitives';
import type { PublishJob } from '@/types/domain';
import { PublishJobBadge } from './PublishJobBadge';

interface AccountInfo {
  name: string;
  platform: string;
  platformLabel: string;
}

interface ApiResponse {
  ok: boolean;
  error?: { code?: string; message: string };
}

const RETRYABLE = ['failed', 'unknown'] as const;
const CANCELLABLE = ['queued', 'publishing', 'verifying', 'scheduled'] as const;

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PublishJobsList({
  jobs,
  accounts,
  canPublish,
  linkContent,
}: {
  jobs: PublishJob[];
  accounts: Record<string, AccountInfo>;
  canPublish: boolean;
  /** Link each row back to its content item (queue view). */
  linkContent?: boolean;
}) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No publish jobs"
        description="Nothing has been published or scheduled yet."
      />
    );
  }

  async function act(jobId: string, action: 'retry' | 'cancel') {
    if (working) return;
    setWorking(jobId);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/social/publish/${jobId}/${action}`, {
        method: 'POST',
      });
      const payload = (await response.json()) as ApiResponse;
      if (!payload.ok) {
        setError(payload.error?.message ?? `Could not ${action} the job.`);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <ErrorState message={error} /> : null}
      <ul className="space-y-3">
        {jobs.map((job) => {
          const account = accounts[job.account_id];
          return (
            <li className="rounded-xl border border-surface-border bg-surface/40 p-4" key={job.id}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-100">
                  {account ? `${account.platformLabel} · ${account.name}` : job.platform}
                </p>
                <PublishJobBadge status={job.status} />
                {job.status === 'published' && job.verification === 'read_back' ? (
                  <Badge tone="success">Verified</Badge>
                ) : null}
                {job.status === 'published' && job.verification === 'provider_reference' ? (
                  <Badge tone="info">Submitted</Badge>
                ) : null}
              </div>
              {linkContent ? (
                <p className="mt-1 text-xs text-slate-500">
                  <Link
                    className="text-brand-300 hover:text-brand-200"
                    href={`/content/${job.content_id}`}
                  >
                    Open content item
                  </Link>
                  {' · '}
                  {job.payload.title}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">{job.payload.title}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Run {formatDateTime(job.run_at)}
                {job.attempts > 0 ? ` · ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}` : ''}
                {job.provider_ref ? ` · ref ${job.provider_ref.slice(0, 24)}` : ''}
              </p>
              {job.last_error ? (
                <p className="mt-2 text-xs leading-5 text-amber-100/90">{job.last_error}</p>
              ) : null}
              {canPublish &&
              ((RETRYABLE as readonly string[]).includes(job.status) ||
                (CANCELLABLE as readonly string[]).includes(job.status)) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(RETRYABLE as readonly string[]).includes(job.status) ? (
                    <button
                      className="btn-secondary"
                      disabled={working === job.id}
                      onClick={() => act(job.id, 'retry')}
                      type="button"
                    >
                      {working === job.id ? 'Working…' : 'Retry'}
                    </button>
                  ) : null}
                  {(CANCELLABLE as readonly string[]).includes(job.status) ? (
                    <button
                      className="btn-secondary"
                      disabled={working === job.id}
                      onClick={() => act(job.id, 'cancel')}
                      type="button"
                    >
                      {working === job.id ? 'Working…' : 'Cancel'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
