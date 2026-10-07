import Link from 'next/link';
import { Card, EmptyState, KeyValue } from '@/components/ui/primitives';
import { ArrowRightIcon, DocumentIcon } from '@/components/ui/icons';
import { PageHeader } from '@/components/cockpit/PageHeader';
import { EditClientForm } from '@/features/clients/EditClientForm';
import { AddNoteForm } from '@/features/clients/AddNoteForm';
import { ClientActivityTimeline } from '@/features/clients/ClientActivityTimeline';
import { StatusBadge } from '@/features/clients/StatusBadge';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { checkPermission } from '@/server/auth/permissions';
import { getClientDetail } from '@/server/clients/service';
import { clientIdSchema } from '@/server/clients/validation';
import { publicEnv } from '@/lib/env';
import { ConfigurationRequired } from '@/components/layout/ConfigurationRequired';

export const dynamic = 'force-dynamic';

/**
 * Future modules attach here in later phases. Each row is an explicit
 * placeholder — no data is fabricated before its module exists.
 */
const FUTURE_ATTACHMENTS = [
  { label: 'Social accounts', phase: 'Phase 7' },
  { label: 'Conversations', phase: 'Phase 9' },
  { label: 'Email history', phase: 'Phase 10' },
  { label: 'Email sequences', phase: 'Phase 11' },
  { label: 'Content', phase: 'Phase 6' },
  { label: 'AI activity', phase: 'Phase 12' },
] as const;

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ClientNotFound() {
  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <Link className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/clients">
        ← Back to clients
      </Link>
      <PageHeader
        description="The requested record does not exist in this organization."
        title="Client not found"
      />
      <Card>
        <EmptyState
          action={
            <Link className="btn-secondary" href="/clients">
              Back to clients
            </Link>
          }
          description="It may have been removed, or the link points to a record in another organization."
          title="No such client here"
        />
      </Card>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Unknown and malformed ids render the same state: existence is never
  // leaked, and the API remains the strict 404 boundary.
  if (!clientIdSchema.safeParse(id).success) return <ClientNotFound />;

  const actorResult = await resolveActor();
  if (!actorResult.ok) return publicEnv().supabaseConfigured ? null : <ConfigurationRequired reason={actorResult.error.message} />;

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return <ConfigurationRequired reason={repoResult.error.message} />;

  const actor = actorResult.data;
  const repo = repoResult.data;
  if (!checkPermission(actor, { module: 'clients', action: 'view' }).allowed) {
    return <ConfigurationRequired reason="Your role cannot view client records." />;
  }

  const detail = await getClientDetail(actor, repo, id);
  if (!detail.ok) {
    if (detail.error.code === 'CLIENT_NOT_FOUND') return <ClientNotFound />;
    return <ConfigurationRequired reason={detail.error.message} />;
  }

  const { client, activity } = detail.data;
  const canEdit = checkPermission(actor, { module: 'clients', action: 'edit' }).allowed;

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <Link className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/clients">
        ← Back to clients
      </Link>

      <PageHeader
        description={client.company ?? client.email ?? 'Client record'}
        title={client.name}
        actions={<StatusBadge status={client.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-6">
          <Card title="Client information">
            <KeyValue label="Company" value={client.company ?? '—'} />
            <KeyValue label="Email" value={client.email ?? '—'} />
            <KeyValue label="Phone" value={client.phone ?? '—'} />
            <KeyValue label="Status" value={<StatusBadge status={client.status} />} />
            <KeyValue label="Tags" value={client.tags.length > 0 ? client.tags.join(' · ') : '—'} />
            <KeyValue label="Notes" value={client.notes ? <span className="whitespace-pre-wrap">{client.notes}</span> : '—'} />
            <KeyValue label="Created" value={formatDateTime(client.created_at)} />
            <KeyValue label="Last updated" value={formatDateTime(client.updated_at)} />
          </Card>

          <Card title="Activity timeline">
            <ClientActivityTimeline activity={activity} />
            {canEdit ? (
              <div className="mt-6 border-t border-surface-border/60 pt-5">
                <h3 className="card-title mb-3">Add a timeline note</h3>
                <AddNoteForm clientId={client.id} />
              </div>
            ) : null}
          </Card>
        </div>

        <aside className="space-y-6">
          {canEdit ? (
            <Card title="Edit client">
              <EditClientForm client={client} />
            </Card>
          ) : (
            <Card title="Edit client">
              <EmptyState
                description="Your role can view this record but cannot make changes."
                icon={<DocumentIcon size={19} />}
                title="Read-only access"
              />
            </Card>
          )}

          <Card title="Connected records">
            <ul className="divide-y divide-surface-border/65">
              {FUTURE_ATTACHMENTS.map((attachment) => (
                <li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0" key={attachment.label}>
                  <span className="text-sm text-slate-400">{attachment.label}</span>
                  <span className="text-[11px] text-slate-500">{attachment.phase}</span>
                </li>
              ))}
            </ul>
            <Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200" href="/manager">
              Ask the Manager about this client <ArrowRightIcon size={14} />
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
