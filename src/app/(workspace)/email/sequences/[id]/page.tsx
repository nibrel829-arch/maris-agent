import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowRightIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { EnrollForm } from '@/features/email/EnrollForm';
import { SequenceLifecycleButtons } from '@/features/email/SequenceLifecycleButtons';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getSequence } from '@/server/email/sequence-service';
import { listEnrollments } from '@/server/email/sequence-service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

function formatDate(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) return <ConfigurationRequired reason="Your role cannot view sequences." />;

  const seqResult = await getSequence(actor, repo, id);
  if (!seqResult.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader title="Sequence not found" description="The sequence does not exist in this organization." />
        <ErrorState message={seqResult.error.message} />
        <Link className="btn-secondary" href="/email/sequences">Back to sequences</Link>
      </div>
    );
  }
  const seq = seqResult.data;
  const enrollmentsResult = await listEnrollments(actor, repo, id, { limit: 50, offset: 0 });
  const enrollments = enrollmentsResult.ok ? enrollmentsResult.data.enrollments : [];
  const totalEnrollments = enrollmentsResult.ok ? enrollmentsResult.data.total : 0;

  // Load jobs for this sequence (best-effort)
  let jobs: Array<{ id: string; to_email: string | null; status: string; run_at: string; attempts: number; last_error: string | null }> = [];
  try {
    const allJobs = await repo.emailJobs.list(actor.organizationId, { limit: 200 });
    jobs = (allJobs as unknown as typeof jobs).filter((j) => (j as unknown as { sequence_id: string | null }).sequence_id === id).slice(0, 30);
  } catch {}

  const canEnroll = checkPermission(actor, { module: 'email', action: 'send' }).allowed;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        title={seq.name}
        description={seq.description ?? `Trigger: ${seq.trigger} • ${Array.isArray(seq.steps) ? seq.steps.length : 0} steps`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href="/email/sequences">
              All sequences <ArrowRightIcon size={15} />
            </Link>
            <Link className="btn-ghost" href="/email">
              Email workspace
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Lifecycle">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm text-slate-300">Status:</span>
            <Badge tone={seq.status === 'active' ? 'success' : seq.status === 'paused' ? 'warning' : seq.status === 'archived' ? 'neutral' : 'info'}>{seq.status}</Badge>
          </div>
          <SequenceLifecycleButtons sequenceId={seq.id} status={seq.status} />
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            <p>Trigger: {seq.trigger}</p>
            <p>Steps: {Array.isArray(seq.steps) ? seq.steps.length : 0}</p>
            <p>Created: {formatDate(seq.created_at)}</p>
            <p>Updated: {formatDate(seq.updated_at)}</p>
          </div>
        </Card>

        <Card title="Steps">
          {Array.isArray(seq.steps) && seq.steps.length > 0 ? (
            <ol className="space-y-2">
              {seq.steps.map((step: { templateId: string; delayDays: number; delayHours: number }, idx: number) => (
                <li key={idx} className="rounded-xl border border-surface-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-100">Step {idx + 1}</span>
                    <Badge tone="info">
                      delay {step.delayDays}d {step.delayHours}h
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-500">template {step.templateId.slice(0, 8)}…</p>
                  {idx === 0 && <p className="mt-1 text-[11px] text-slate-500">Runs at enrollment + delay.</p>}
                  {idx > 0 && <p className="mt-1 text-[11px] text-slate-500">Runs after prior step + delay.</p>}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No steps" description="This sequence has no steps." />
          )}
          <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-[11px] leading-5 text-amber-200/90">
            Templates must be active. Archived/draft templates cannot be used for steps — worker will mark the job failed.
          </div>
        </Card>

        <Card title="Enroll a recipient">
          {canEnroll ? (
            <EnrollForm sequenceId={seq.id} />
          ) : (
            <EmptyState title="Enrollment not permitted" description="Requires email:send (owner/admin)." />
          )}
          <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-900/30 p-3 text-[11px] leading-5 text-slate-400">
            Eligible: clients with email in this org, not opted-out, not already enrolled (duplicate enrollment is idempotent). Enrollment fails if sequence is not active.
          </div>
        </Card>
      </div>

      <Card title={`Enrollments (${totalEnrollments})`} action={<Badge tone="info">{totalEnrollments} total</Badge>}>
        {enrollments.length === 0 ? (
          <EmptyState title="No enrollments" description="Enroll a client or email to queue the first step." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="table-header">
                <tr>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Current step</th>
                  <th className="px-2 py-2">Next run</th>
                  <th className="px-2 py-2">Enrolled</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((en) => (
                  <tr key={en.id} className="table-row">
                    <td className="px-2 py-2 font-mono text-xs text-slate-300">{en.email}</td>
                    <td className="px-2 py-2">
                      <Badge tone={en.status === 'active' ? 'success' : en.status === 'completed' ? 'info' : en.status === 'unsubscribed' || en.status === 'bounced' ? 'warning' : 'neutral'}>
                        {en.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-400">{en.current_step}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{formatDate(en.next_run_at)}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{formatDate(en.enrolled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Recent jobs (${jobs.length})`}>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs" description="Jobs appear after enrollment. Worker claims due jobs via /api/cron/email." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="table-header">
                <tr>
                  <th className="px-2 py-2">To</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Run at</th>
                  <th className="px-2 py-2">Attempts</th>
                  <th className="px-2 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="table-row">
                    <td className="px-2 py-2 font-mono text-xs text-slate-300">{job.to_email ?? '—'}</td>
                    <td className="px-2 py-2">
                      <Badge tone={job.status === 'sent' ? 'success' : job.status === 'failed' ? 'warning' : job.status === 'queued' ? 'info' : 'neutral'}>{job.status}</Badge>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">{formatDate(job.run_at)}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{job.attempts}</td>
                    <td className="px-2 py-2 text-xs text-amber-300/80">{job.last_error ? job.last_error.slice(0, 120) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Provider acceptance is not delivery proof. Check email_logs for SENT vs provider events. Rate-limited jobs retry with backoff (2,4,8… min).</p>
      </Card>
    </div>
  );
}
