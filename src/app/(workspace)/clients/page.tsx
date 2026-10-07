import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { ArrowRightIcon, UserGroupIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { relativeTime } from '@/components/cockpit/ActivityTimeline';
import { CreateClientForm } from '@/features/clients/CreateClientForm';
import { ClientsToolbar } from '@/features/clients/ClientsToolbar';
import { StatusBadge } from '@/features/clients/StatusBadge';
import { isClientStatus } from '@/features/clients/client-statuses';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { listClients } from '@/server/clients/service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import type { ClientStatus } from '@/types/domain';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

function pageHref(search: string, status: string, page: number): string {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/clients?${query}` : '/clients';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function ClientsPage({
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
  if (!checkPermission(actor, { module: 'clients', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view the Clients workspace." />;
  }

  const params = await searchParams;
  const search = (params.search ?? '').trim().slice(0, 200);
  const statusFilter = isClientStatus(params.status) ? (params.status as ClientStatus) : '';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const canCreate = checkPermission(actor, { module: 'clients', action: 'create' }).allowed;
  const [directory, counts] = await Promise.all([
    listClients(actor, repo, {
      search: search || undefined,
      status: statusFilter || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    repo.counts(actor.organizationId),
  ]);

  if (!directory.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader
          description="Client profiles, contact details and the activity record for every relationship in this organization."
          title="Clients"
        />
        <ErrorState message={directory.error.message} />
      </div>
    );
  }

  const { clients, total } = directory.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, safePage * PAGE_SIZE);
  const isFiltered = search.length > 0 || statusFilter.length > 0;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Client profiles, contact details and the activity record for every relationship in this organization."
        title="Clients"
        actions={<Link className="btn-secondary" href="/leads">Open leads workspace <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card
          title="Client directory"
          action={total > 0 ? <Badge tone="info">{total} recorded</Badge> : null}
        >
          <div className="mb-4">
            <ClientsToolbar search={search} status={statusFilter} />
          </div>

          {clients.length === 0 ? (
            <EmptyState
              description={
                isFiltered
                  ? 'No clients match this search. Clear the search or choose a different status.'
                  : 'No clients have been recorded. Add the first relationship to start building the directory.'
              }
              icon={<UserGroupIcon size={19} />}
              title={isFiltered ? 'No matching clients' : 'No client records yet'}
              action={
                isFiltered ? (
                  <Link className="btn-secondary" href="/clients">
                    Clear search
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="table-header">
                    <tr>
                      <th className="px-2 py-3">Client</th>
                      <th className="px-2 py-3">Contact</th>
                      <th className="px-2 py-3">Status</th>
                      <th className="px-2 py-3">Last activity</th>
                      <th className="px-2 py-3">Created</th>
                      <th className="px-2 py-3"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr className="table-row" key={client.id}>
                        <td className="px-2 py-3">
                          <Link className="font-medium text-slate-100 hover:text-white hover:underline" href={`/clients/${client.id}`}>
                            {client.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-slate-500">{client.company ?? 'No company recorded'}</p>
                        </td>
                        <td className="px-2 py-3">
                          <p className="text-slate-300">{client.email ?? '—'}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{client.phone ?? 'No phone recorded'}</p>
                        </td>
                        <td className="px-2 py-3"><StatusBadge status={client.status} /></td>
                        <td className="px-2 py-3 text-xs text-slate-400">
                          {client.last_activity_at ? relativeTime(client.last_activity_at) : '—'}
                        </td>
                        <td className="px-2 py-3 text-xs text-slate-500">{formatDate(client.created_at)}</td>
                        <td className="px-2 py-3 text-right">
                          <Link className="btn-ghost text-xs" href={`/clients/${client.id}`}>
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
                    <Link className="btn-secondary px-3 py-1.5 text-xs" href={pageHref(search, statusFilter, safePage - 1)}>
                      Previous
                    </Link>
                  ) : null}
                  <span className="text-xs text-slate-500">Page {safePage} of {totalPages}</span>
                  {safePage < totalPages ? (
                    <Link className="btn-secondary px-3 py-1.5 text-xs" href={pageHref(search, statusFilter, safePage + 1)}>
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Card>

        <aside className="space-y-6">
          {canCreate ? <Card title="Add a client"><CreateClientForm /></Card> : null}
          <Card title="Current context">
            <dl className="divide-y divide-surface-border/65">
              <div className="flex items-center justify-between gap-4 py-3 pt-0">
                <dt className="text-sm text-slate-400">Clients in directory</dt>
                <dd className="text-sm font-medium text-slate-200">
                  {(counts.clients ?? 0) === 0 ? 'None recorded' : counts.clients}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-sm text-slate-400">Leads linked to workspace</dt>
                <dd className="text-sm font-medium text-slate-200">
                  {(counts.leads ?? 0) === 0 ? 'No leads recorded' : counts.leads}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 pb-0">
                <dt className="text-sm text-slate-400">External outreach</dt>
                <dd className="text-right text-sm font-medium text-slate-200">Always approval-gated</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
