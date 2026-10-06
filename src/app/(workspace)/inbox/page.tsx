import { Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
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

  const [accounts, community] = await Promise.all([
    repo.socialAccounts.list(actor.organizationId, { limit: 50 }),
    repo.communityPlans.list(actor.organizationId, { limit: 20 }),
  ]);

  const dmCapable = accounts.filter((account) => account.capabilities.readDm);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Unified Inbox</h1>
        <p className="mt-1 text-sm text-slate-400">
          Supported DMs, comments and mentions in one place.
        </p>
      </div>

      <Card title="Ingestion status">
        <KeyValue
          label="Accounts connected"
          value={accounts.length === 0 ? 'None' : accounts.length}
        />
        <KeyValue
          label="Accounts with DM read capability"
          value={dmCapable.length === 0 ? 'None' : dmCapable.length}
        />
        <KeyValue
          label="Community guidelines"
          value={community.length === 0 ? 'Not defined' : `${community.length} plan(s)`}
        />
      </Card>

      <Card title="Conversations">
        <EmptyState
          title="No conversations ingested yet"
          description="Inbox ingestion requires connected accounts whose official API grants read access to messages and comments. Where an official API does not support it, Nibrexo reports the capability as unsupported instead of scraping the platform."
        />
      </Card>
    </div>
  );
}
