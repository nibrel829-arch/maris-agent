import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { CreateClientForm } from '@/features/clients/CreateClientForm';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const actorResult = await resolveActor();
  if (!actorResult.ok) {
    return publicEnv().supabaseConfigured ? null : (
      <ConfigurationRequired reason={actorResult.error.message} />
    );
  }

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;

  if (!checkPermission(actor, { module: 'clients', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view the Clients module." />;
  }

  const canCreate = checkPermission(actor, { module: 'clients', action: 'create' }).allowed;

  const [clients, leads] = await Promise.all([
    repo.clients.list(actor.organizationId, { limit: 100 }),
    repo.leads.list(actor.organizationId, { limit: 100 }),
  ]);

  const byStatus = clients.reduce<Record<string, number>>((acc, client) => {
    acc[client.status] = (acc[client.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Clients & CRM</h1>
        <p className="mt-1 text-sm text-slate-400">
          Client profiles, leads and qualification. Every lead records its source.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clients" value={clients.length} />
        <Stat label="Active" value={byStatus.active ?? 0} />
        <Stat label="Leads" value={leads.length} />
        <Stat label="Qualified leads" value={leads.filter((l) => l.stage === 'qualified').length} />
      </div>

      {canCreate ? (
        <Card title="Add a client">
          <CreateClientForm />
        </Card>
      ) : null}

      <Card title="Client records">
        {clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Ask the Manager to prepare leads, or add a client above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Name</th>
                  <th className="py-2">Company</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-t border-surface-border/60">
                    <td className="py-2 text-slate-100">{client.name}</td>
                    <td className="py-2 text-slate-400">{client.company ?? '—'}</td>
                    <td className="py-2 text-slate-400">{client.email ?? '—'}</td>
                    <td className="py-2">
                      <Badge tone={client.status === 'active' ? 'success' : 'neutral'}>
                        {client.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-slate-400">{client.tags.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
