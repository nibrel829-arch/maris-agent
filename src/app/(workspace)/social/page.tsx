import { Badge, Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { listAdapters, PLATFORM_CAPABILITY_RULE } from '@/server/integrations/social/adapter';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
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

  const [accounts, plans, community] = await Promise.all([
    repo.socialAccounts.list(actor.organizationId, { limit: 50 }),
    repo.socialPlans.list(actor.organizationId, { limit: 50 }),
    repo.communityPlans.list(actor.organizationId, { limit: 50 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Social</h1>
        <p className="mt-1 text-sm text-slate-400">
          Connected accounts, publishing plans and community management.
        </p>
      </div>

      <Card title="Platform capability status">
        <p className="mb-4 text-sm text-slate-400">{PLATFORM_CAPABILITY_RULE}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {listAdapters().map((adapter) => (
            <div key={adapter.platform} className="rounded-lg border border-surface-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-100">{adapter.platform}</p>
                <Badge tone={adapter.configured ? 'success' : 'warning'}>
                  {adapter.configured ? 'configured' : 'not implemented'}
                </Badge>
              </div>
              <div className="mt-2">
                {Object.entries(adapter.capabilities).map(([capability, supported]) => (
                  <KeyValue
                    key={capability}
                    label={capability}
                    value={
                      <span className={supported ? 'text-emerald-300' : 'text-slate-500'}>
                        {supported ? 'supported' : 'unsupported'}
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Connected accounts (${accounts.length})`}>
          {accounts.length === 0 ? (
            <EmptyState
              title="No accounts connected"
              description="OAuth connection requires verified platform credentials and scopes. Until then publishing reports unsupported rather than simulating."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between rounded-lg border border-surface-border p-3">
                  <span className="text-slate-100">{account.name}</span>
                  <Badge tone={account.status === 'connected' ? 'success' : 'warning'}>
                    {account.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title={`Social plans (${plans.length})`}>
            {plans.length === 0 ? (
              <EmptyState title="No plans" description="Ask the Manager to create a social plan." />
            ) : (
              <ul className="space-y-2 text-sm">
                {plans.map((plan) => (
                  <li key={plan.id} className="rounded-lg border border-surface-border p-3">
                    <p className="text-slate-100">{plan.title}</p>
                    <p className="mt-1 text-xs text-slate-400">Cadence: {plan.cadence}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Community plans (${community.length})`}>
            {community.length === 0 ? (
              <EmptyState
                title="No community plans"
                description="Ask the Manager to create a community management plan."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {community.map((plan) => (
                  <li key={plan.id} className="rounded-lg border border-surface-border p-3">
                    <p className="text-slate-100">{plan.title}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
