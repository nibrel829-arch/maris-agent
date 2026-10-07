import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';
import { ErrorState } from '@/components/ui/primitives';
import { InboxWorkspace } from '@/components/inbox/InboxWorkspace';
import { checkPermission } from '@/server/auth/permissions';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { getInboxConversation, listInbox } from '@/server/inbox/service';
import { inboxMessageQuerySchema } from '@/server/inbox/validation';
import { publicEnv } from '@/lib/env';

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
  const listed = await listInbox(actor, repo, { limit: 30, offset: 0 });
  if (!listed.ok) return <ErrorState message={listed.error.message} />;

  const firstConversation = listed.data.conversations[0] ?? null;
  const detail = firstConversation
    ? await getInboxConversation(actor, repo, firstConversation.id, inboxMessageQuerySchema.parse({ limit: 100 }))
    : null;
  const canEdit = checkPermission(actor, { module: 'inbox', action: 'edit' }).allowed;
  const canSend = checkPermission(actor, { module: 'inbox', action: 'send' }).allowed;
  const canViewClients = checkPermission(actor, { module: 'clients', action: 'view' }).allowed;
  const clients = canViewClients
    ? await repo.clients.list(actor.organizationId, { limit: 500, orderBy: 'name', ascending: true })
    : [];

  return (
    <InboxWorkspace
      canAssociateClients={canViewClients}
      canEdit={canEdit}
      canSend={canSend}
      clientOptions={clients.map(({ id, name, company }) => ({ id, name, company }))}
      initialDetail={detail?.ok ? detail.data : null}
      initialList={listed.data}
    />
  );
}
