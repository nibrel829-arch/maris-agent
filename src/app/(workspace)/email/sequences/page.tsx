import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { CreateSequenceForm } from '@/features/email/CreateSequenceForm';
import { SequenceToolbar } from '@/features/email/SequenceToolbar';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { listSequences } from '@/server/email/sequence-service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;

function pageHref(search: string, status: string, page: number): string {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `/email/sequences?${text}` : '/email/sequences';
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'success' : status === 'paused' ? 'warning' : status === 'archived' ? 'neutral' : status === 'draft' ? 'info' : 'neutral';
  return <Badge tone={tone as never}>{status}</Badge>;
}

export default async function EmailSequencesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;
  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view email sequences." />;
  }

  const raw = await searchParams;
  const search = (raw.search ?? '').trim().slice(0, 200);
  const status = (raw.status ?? '').trim();
  const page = Math.max(1, Number.parseInt(raw.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const canCreate = checkPermission(actor, { module: 'email', action: 'create' }).allowed;

  const result = await listSequences(actor, repo, {
    search: search || undefined,
    status: (status as never) || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader description="Automated follow-ups with delays, enrollment, and suppression." title="Email sequences" />
        <ErrorState message={result.error.message} />
      </div>
    );
  }

  const { sequences, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, safePage * PAGE_SIZE);
  const isFiltered = Boolean(search || status);

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        title="Email sequences"
        description="Organization-scoped automation — steps, delays, enrollment, pause/resume/archive, worker scheduling, suppression & audit. Uses Phase 10 templates and Resend delivery."
        actions={
          <div className="flex gap-2">
            <Link className="btn-secondary" href="/email">
              Back to email <ArrowRightIcon size={15} />
            </Link>
            <Link className="btn-ghost" href="/email/templates">
              Templates
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card title="Sequence directory" action={total > 0 ? <Badge tone="info">{total} sequence{total === 1 ? '' : 's'}</Badge> : null}>
          <div className="mb-4">
            <SequenceToolbar search={search} status={status} />
          </div>

          {sequences.length === 0 ? (
            <EmptyState
              title={isFiltered ? 'No matching sequences' : 'No sequences yet'}
              description={
                isFiltered
                  ? 'No sequences match this filter. Clear it or create a new one.'
                  : 'Create the first automated follow-up. Manual enrollment only — no bulk campaigns in Phase 11.'
              }
              icon={<DocumentIcon size={19} />}
              action={isFiltered ? <Link className="btn-secondary" href="/email/sequences">Clear filter</Link> : undefined}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="table-header">
                    <tr>
                      <th className="px-2 py-3">Sequence</th>
                      <th className="px-2 py-3">Steps</th>
                      <th className="px-2 py-3">Status</th>
                      <th className="px-2 py-3">Trigger</th>
                      <th className="px-2 py-3">Updated</th>
                      <th className="px-2 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequences.map((seq) => (
                      <tr key={seq.id} className="table-row">
                        <td className="px-2 py-3">
                          <Link className="font-medium text-slate-100 hover:underline" href={`/email/sequences/${seq.id}`}>
                            {seq.name}
                          </Link>
                          {seq.description ? <p className="mt-0.5 text-xs text-slate-500">{seq.description.slice(0, 80)}</p> : null}
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-400">{Array.isArray(seq.steps) ? seq.steps.length : 0}</td>
                        <td className="px-2 py-3">
                          <StatusBadge status={seq.status} />
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-500">{seq.trigger}</td>
                        <td className="px-2 py-3 text-xs text-slate-500">{formatDate(seq.updated_at)}</td>
                        <td className="px-2 py-3 text-right">
                          <Link className="btn-ghost text-xs" href={`/email/sequences/${seq.id}`}>
                            View <ArrowRightIcon size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border/60 pt-4">
                <p className="text-xs text-slate-500">
                  Showing {from}–{to} of {total}
                </p>
                <div className="flex items-center gap-2">
                  {safePage > 1 ? (
                    <Link className="btn-secondary px-3 py-1.5 text-xs" href={pageHref(search, status, safePage - 1)}>
                      Previous
                    </Link>
                  ) : null}
                  <span className="text-xs text-slate-500">Page {safePage} of {totalPages}</span>
                  {safePage < totalPages ? (
                    <Link className="btn-secondary px-3 py-1.5 text-xs" href={pageHref(search, status, safePage + 1)}>
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Card>

        <aside className="space-y-6">
          {canCreate ? (
            <Card title="New sequence">
              <CreateSequenceForm />
            </Card>
          ) : (
            <Card title="New sequence">
              <EmptyState title="Creation not permitted" description="Requires email:create (owner/admin). Ask an owner." />
            </Card>
          )}
          <Card title="Worker & scheduling">
            <ul className="space-y-2 text-xs leading-5 text-slate-400">
              <li>• Execution is via cron `GET/POST /api/cron/email` with `CRON_SECRET` (Vercel Cron or pg_cron + pg_net). No new scheduler.</li>
              <li>• Single-flight `claim_due_email_jobs()` with `FOR UPDATE SKIP LOCKED` prevents duplicate sends.</li>
              <li>• Delays are from enrollment / prior step. Paused sequences re-queue hourly.</li>
              <li>• Suppressed recipients (email_preferences opted_out or Resend bounce/complaint) are skipped; remaining jobs cancelled.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
