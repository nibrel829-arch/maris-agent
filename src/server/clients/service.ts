/**
 * Clients/CRM business service (Phase 5).
 *
 * Pipeline per call (PDF #12 §16):
 *   AUTHENTICATE (actor resolved by the caller) -> AUTHORIZE (permission
 *   guard, organization-scoped) -> VALIDATE INPUT (Zod, in validation.ts)
 *   -> DATABASE (tenant-scoped repository; RLS underneath) -> LOG (client
 *   timeline + audit log) -> RESPONSE (ServiceResult).
 *
 * Tenancy rules:
 *  - `organization_id` always comes from `actor.organizationId`, never from
 *    the request body (the schemas do not even accept it).
 *  - Reads/updates filter by organization; a row from another organization
 *    resolves to NOT_FOUND so existence is never leaked across tenants.
 */

import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import { writeAudit } from '@/server/manager/audit';
import { fail, ok, type ServiceResult } from '@/lib/result';
import type {
  ActorContext,
  Client,
  ClientActivity,
  ClientStatus,
  UUID,
} from '@/types/domain';
import type {
  AddClientNoteInput,
  ClientListQuery,
  CreateClientInput,
  UpdateClientInput,
} from './validation';

/** Bounded window for server-side search/filter (see listClients). */
export const CLIENT_LIST_WINDOW = 500;

export interface ClientListItem extends Client {
  /** Latest client_activity entry, or null when the timeline is empty. */
  last_activity_at: string | null;
}

export interface ClientListResult {
  clients: ClientListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ClientDetail {
  client: Client;
  activity: ClientActivity[];
}

function permissionDenied(actor: ActorContext, action: string) {
  return fail(
    'PERMISSION_DENIED',
    `Role "${actor.role}" does not have "${action}" permission on module "clients".`,
    { errorClass: 'permission', severity: 'error' },
  );
}

function notFound(): ServiceResult<never> {
  return fail('CLIENT_NOT_FOUND', 'Client not found.', {
    errorClass: 'validation',
    severity: 'warning',
  });
}

/** Normalizes optional text: undefined stays undefined, ''/whitespace becomes null. */
function nullable(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Lists clients with server-side search, status filter and pagination.
 *
 * The repository contract exposes limit/offset listing only, so filtering
 * runs over a bounded window (newest 500 rows) inside the service. That is
 * exact for typical CRM volumes; a database-level search (ilike/trigram) is
 * the documented follow-up when an organization outgrows the window.
 */
export async function listClients(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: ClientListQuery,
): Promise<ServiceResult<ClientListResult>> {
  if (!checkPermission(actor, { module: 'clients', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const [clients, activity] = await Promise.all([
    repo.clients.list(actor.organizationId, { limit: CLIENT_LIST_WINDOW }),
    repo.clientActivity.list(actor.organizationId, { limit: CLIENT_LIST_WINDOW }),
  ]);

  const lastByClient = new Map<string, string>();
  for (const entry of activity) {
    if (!lastByClient.has(entry.client_id)) lastByClient.set(entry.client_id, entry.created_at);
  }

  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = clients.filter((client) => {
    if (query.status && client.status !== query.status) return false;
    if (!needle) return true;
    const haystack = [client.name, client.company, client.email, client.phone]
      .filter((field): field is string => typeof field === 'string' && field.length > 0)
      .join(' ')
      .toLowerCase();
    return needle
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .every((token) => haystack.includes(token));
  });

  const total = filtered.length;
  const items: ClientListItem[] = filtered
    .slice(query.offset, query.offset + query.limit)
    .map((client) => ({
      ...client,
      last_activity_at: lastByClient.get(client.id) ?? null,
    }));

  return ok({ clients: items, total, limit: query.limit, offset: query.offset });
}

export async function createClient(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: CreateClientInput,
): Promise<ServiceResult<Client>> {
  if (!checkPermission(actor, { module: 'clients', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }

  const client = await repo.clients.insert({
    organization_id: actor.organizationId,
    name: input.name.trim(),
    company: nullable(input.company) ?? null,
    email: nullable(input.email) ?? null,
    phone: nullable(input.phone) ?? null,
    status: input.status as ClientStatus,
    tags: input.tags,
    notes: nullable(input.notes) ?? null,
    created_by: actor.userId,
  });

  // Timeline + audit are real events for this action. A logging failure never
  // masks the created record (audit.ts contract): the record stands and the
  // log can be retried from the returned client.
  try {
    await repo.clientActivity.insert({
      organization_id: actor.organizationId,
      client_id: client.id,
      kind: 'lead_created',
      subject: 'Client record created',
      body: `Created by ${actor.fullName ?? actor.email ?? 'a team member'}.`,
      actor_id: actor.userId,
    });
  } catch {
    // Non-fatal by design; see above.
  }
  await writeAudit(repo, actor, {
    action: 'client.created',
    entityType: 'client',
    entityId: client.id,
    metadata: { status: client.status },
  });

  return ok(client);
}

export async function getClientDetail(
  actor: ActorContext,
  repo: NibrexoRepository,
  clientId: UUID,
): Promise<ServiceResult<ClientDetail>> {
  if (!checkPermission(actor, { module: 'clients', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const client = await repo.clients.get(clientId, actor.organizationId);
  if (!client) return notFound();

  const activity = await repo.clientActivity.list(actor.organizationId, {
    limit: CLIENT_LIST_WINDOW,
  });

  return ok({
    client,
    activity: activity.filter((entry) => entry.client_id === clientId),
  });
}

const EDITABLE_LABELS: Record<string, string> = {
  name: 'name',
  company: 'company',
  email: 'email',
  phone: 'phone',
  status: 'status',
  notes: 'notes',
  tags: 'tags',
};

export async function updateClient(
  actor: ActorContext,
  repo: NibrexoRepository,
  clientId: UUID,
  input: UpdateClientInput,
): Promise<ServiceResult<Client>> {
  if (!checkPermission(actor, { module: 'clients', action: 'edit' }).allowed) {
    return permissionDenied(actor, 'edit');
  }

  const existing = await repo.clients.get(clientId, actor.organizationId);
  if (!existing) return notFound();

  const patch: Partial<Client> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.company !== undefined) patch.company = nullable(input.company) ?? null;
  if (input.email !== undefined) patch.email = nullable(input.email) ?? null;
  if (input.phone !== undefined) patch.phone = nullable(input.phone) ?? null;
  if (input.status !== undefined) patch.status = input.status as ClientStatus;
  if (input.notes !== undefined) patch.notes = nullable(input.notes) ?? null;
  if (input.tags !== undefined) patch.tags = input.tags;

  const changedFields = (Object.keys(patch) as Array<keyof typeof EDITABLE_LABELS>).filter(
    (field) => {
      const next = patch[field as keyof Client];
      const current = existing[field as keyof Client];
      return JSON.stringify(next ?? null) !== JSON.stringify(current ?? null);
    },
  );

  const updated = await repo.clients.update(clientId, actor.organizationId, patch);
  if (!updated) return notFound();

  if (changedFields.length > 0) {
    const statusChanged = changedFields.includes('status');
    try {
      await repo.clientActivity.insert({
        organization_id: actor.organizationId,
        client_id: clientId,
        kind: statusChanged ? 'status_change' : 'note',
        subject: statusChanged
          ? `Status changed from ${existing.status} to ${updated.status}`
          : 'Client record updated',
        body: statusChanged
          ? null
          : `Updated: ${changedFields.map((field) => EDITABLE_LABELS[field]).join(', ')}.`,
        actor_id: actor.userId,
      });
    } catch {
      // Non-fatal by design; the update stands.
    }
    await writeAudit(repo, actor, {
      action: 'client.updated',
      entityType: 'client',
      entityId: clientId,
      metadata: { changedFields },
    });
  }

  return ok(updated);
}

export async function addClientNote(
  actor: ActorContext,
  repo: NibrexoRepository,
  clientId: UUID,
  input: AddClientNoteInput,
): Promise<ServiceResult<ClientActivity>> {
  if (!checkPermission(actor, { module: 'clients', action: 'edit' }).allowed) {
    return permissionDenied(actor, 'edit');
  }

  const client = await repo.clients.get(clientId, actor.organizationId);
  if (!client) return notFound();

  const activity = await repo.clientActivity.insert({
    organization_id: actor.organizationId,
    client_id: clientId,
    kind: 'note',
    subject: input.subject.trim(),
    body: nullable(input.body) ?? null,
    actor_id: actor.userId,
  });

  return ok(activity);
}
