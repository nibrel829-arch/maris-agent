import Link from 'next/link';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { ArrowRightIcon, PulseIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { ConnectButton, DisconnectButton, RefreshButton } from '@/features/social/ConnectionButtons';
import { SocialNotices } from '@/features/social/SocialNotices';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { listAccounts, type SocialAccountView } from '@/server/social/service';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<SocialAccountView['status'], 'success' | 'warning' | 'neutral'> = {
  connected: 'success',
  reconnect_required: 'warning',
  disconnected: 'neutral',
  pending: 'neutral',
};

const STATUS_LABEL: Record<SocialAccountView['status'], string> = {
  connected: 'Connected',
  reconnect_required: 'Reconnect required',
  disconnected: 'Disconnected',
  pending: 'Pending',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function expiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt) - Date.now();
  return ms > 0 && ms < 7 * 24 * 60 * 60 * 1000;
}

function expired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'social', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view social accounts." />;
  }

  const params = await searchParams;
  const canConnect = checkPermission(actor, { module: 'social', action: 'create' }).allowed;
  const canRefresh = checkPermission(actor, { module: 'social', action: 'edit' }).allowed;
  const canDisconnect = checkPermission(actor, { module: 'social', action: 'delete' }).allowed;

  const [connections, plans, community] = await Promise.all([
    listAccounts(actor, repo),
    repo.socialPlans.list(actor.organizationId, { limit: 50 }),
    repo.communityPlans.list(actor.organizationId, { limit: 50 }),
  ]);

  if (!connections.ok) {
    return (
      <div className="mx-auto max-w-[1380px] space-y-6">
        <PageHeader description="Connected accounts and publishing plans." title="Social" />
        <Card>
          <EmptyState
            description={connections.error.message}
            icon={<PulseIcon size={19} />}
            title="Could not load connections"
          />
        </Card>
      </div>
    );
  }

  const { accounts, providers } = connections.data;
  const connectedCount = (platform: string) =>
    accounts.filter((account) => account.platform === platform && account.status === 'connected').length;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <PageHeader
        description="Connect the organization's social accounts over official OAuth. Tokens are encrypted at rest and never leave the server."
        title="Social"
      />

      <SocialNotices connected={params.connected} error={params.error} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-6">
          <Card
            title="Connected accounts"
            action={accounts.length > 0 ? <Badge tone="info">{accounts.length}</Badge> : null}
          >
            {accounts.length === 0 ? (
              <EmptyState
                description="No accounts are connected. Start below — each platform authorizes over its own official login."
                icon={<PulseIcon size={19} />}
                title="No accounts connected"
              />
            ) : (
              <ul className="space-y-3">
                {accounts.map((account) => (
                  <li className="rounded-xl border border-surface-border bg-surface/40 p-4" key={account.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-100">{account.name}</p>
                          <Badge tone={STATUS_TONE[account.status]}>{STATUS_LABEL[account.status]}</Badge>
                          {account.expires_at && !expired(account.expires_at) && expiringSoon(account.expires_at) ? (
                            <Badge tone="warning">Expiring soon</Badge>
                          ) : null}
                          {account.expires_at && expired(account.expires_at) ? (
                            <Badge tone="danger">Expired</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {providers.find((provider) => provider.platform === account.platform)?.label ?? account.platform}
                          {' · '}
                          {account.expires_at ? `tokens expire ${formatDate(account.expires_at)}` : 'tokens do not expire'}
                          {account.scopes.length > 0 ? ` · ${account.scopes.length} scope${account.scopes.length === 1 ? '' : 's'}` : ''}
                        </p>
                        {account.last_error ? (
                          <p className="mt-2 text-xs leading-5 text-amber-100/90">{account.last_error}</p>
                        ) : null}
                      </div>
                    </div>
                    {(canRefresh && account.refresh_supported && (account.status === 'connected' || account.status === 'reconnect_required')) ||
                    (canConnect && account.status !== 'connected') ||
                    (canDisconnect && account.status === 'connected') ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {canRefresh && account.refresh_supported && (account.status === 'connected' || account.status === 'reconnect_required') ? (
                          <RefreshButton id={account.id} label={account.name} />
                        ) : null}
                        {canConnect && account.status !== 'connected' ? (
                          <ConnectButton
                            label={providers.find((provider) => provider.platform === account.platform)?.label ?? account.platform}
                            platform={account.platform}
                          />
                        ) : null}
                        {canDisconnect && account.status === 'connected' ? (
                          <DisconnectButton id={account.id} name={account.name} />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Connect a platform">
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((provider) => {
                const count = connectedCount(provider.platform);
                const actionable = canConnect && provider.connectable && provider.configured;
                return (
                  <div className="rounded-xl border border-surface-border bg-surface/40 p-4" key={provider.platform}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-100">{provider.label}</p>
                      {count > 0 ? <Badge tone="success">{count} connected</Badge> : null}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{provider.note}</p>
                    <div className="mt-3">
                      {actionable ? (
                        <ConnectButton label={provider.label} platform={provider.platform} />
                      ) : (
                        <p className="text-xs leading-5 text-slate-500">
                          {!provider.connectable
                            ? 'Not available for this platform.'
                            : !provider.configured
                              ? 'OAuth credentials are not configured on the server.'
                              : 'Your role cannot connect accounts.'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="Publishing">
            <p className="flex gap-2 text-sm leading-6 text-slate-400">
              <PulseIcon className="mt-1 shrink-0 text-brand-300" size={16} />
              Connections authorize the organization&apos;s accounts. Scheduling and publishing arrive in Phase 8 — nothing posts on its own.
            </p>
            <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/content">
              Open the content library <ArrowRightIcon size={14} />
            </Link>
          </Card>

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
        </aside>
      </div>
    </div>
  );
}
