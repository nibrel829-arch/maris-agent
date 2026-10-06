import Link from 'next/link';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, UserGroupIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { CreateClientForm } from '@/features/clients/CreateClientForm';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'clients', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view the Relationships workspace." />;
  }

  const canCreate = checkPermission(actor, { module: 'clients', action: 'create' }).allowed;
  const [clients, leads] = await Promise.all([
    repo.clients.list(actor.organizationId, { limit: 100 }),
    repo.leads.list(actor.organizationId, { limit: 100 }),
  ]);
  const activeClients = clients.filter((client) => client.status === 'active').length;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="The relationship ledger keeps clients and the opportunity context that belongs with them. Records shown here come directly from your workspace."
        title="Relationships"
        actions={<Link className="btn-secondary" href="/leads">Open leads workspace <ArrowRightIcon size={15} /></Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card title="Client ledger" action={clients.length > 0 ? <Badge tone="info">{clients.length} recorded</Badge> : null}>
          {clients.length === 0 ? (
            <EmptyState
              description="No clients have been recorded. Add a relationship directly, or ask Nibrexo to prepare sourced leads before you start outreach."
              icon={<UserGroupIcon size={19} />}
              title="No client records yet"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="table-header"><tr><th className="px-2 py-3">Client</th><th className="px-2 py-3">Company</th><th className="px-2 py-3">Contact</th><th className="px-2 py-3">Relationship</th><th className="px-2 py-3">Tags</th></tr></thead>
                <tbody>
                  {clients.map((client) => (
                    <tr className="table-row" key={client.id}>
                      <td className="px-2 py-3 font-medium text-slate-200">{client.name}</td>
                      <td className="px-2 py-3 text-slate-400">{client.company ?? '—'}</td>
                      <td className="px-2 py-3 text-slate-400">{client.email ?? '—'}</td>
                      <td className="px-2 py-3"><Badge tone={client.status === 'active' ? 'success' : client.status === 'lead' ? 'info' : 'neutral'}>{client.status}</Badge></td>
                      <td className="px-2 py-3 text-xs text-slate-500">{client.tags.join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <aside className="space-y-6">
          {canCreate ? <Card title="Add a relationship"><CreateClientForm /></Card> : null}
          <Card title="Current context">
            <dl className="divide-y divide-surface-border/65">
              <div className="flex items-center justify-between gap-4 py-3 pt-0"><dt className="text-sm text-slate-400">Active clients</dt><dd className="text-sm font-medium text-slate-200">{activeClients === 0 ? 'None recorded' : activeClients}</dd></div>
              <div className="flex items-center justify-between gap-4 py-3"><dt className="text-sm text-slate-400">Leads linked to workspace</dt><dd className="text-sm font-medium text-slate-200">{leads.length === 0 ? 'No leads recorded' : leads.length}</dd></div>
              <div className="flex items-center justify-between gap-4 py-3 pb-0"><dt className="text-sm text-slate-400">External outreach</dt><dd className="text-right text-sm font-medium text-slate-200">Always approval-gated</dd></div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
