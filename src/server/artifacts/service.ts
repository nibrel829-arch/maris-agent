/**
 * Deliverable storage and authorized download (Phase 17).
 *
 * Bytes are stored in the `manager_artifacts` table with organization and task
 * linkage, a SHA-256 digest and the size. Downloads are authorized by the
 * actor's role (`ai:create`, which excludes the client role), by organization
 * scope, and by the task the artifact belongs to. The digest is verified before
 * bytes are returned, so a corrupted row is an error, not a delivered file.
 */

import { createHash } from 'node:crypto';
import type { ActorContext, UUID } from '@/types/domain';
import type { NibrexoRepository } from '@/server/db/types';
import type { ManagerArtifactRecord } from '@/types/manager';
import { checkPermission } from '@/server/auth/permissions';
import { newId } from '@/lib/id';
import { buildDocx } from './docx';
import type { DeliverableSpec } from '@/server/manager/deliverables';

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

export type ArtifactSummary = Omit<ManagerArtifactRecord, 'content_base64'>;

export type ArtifactError =
  | { code: 'PERMISSION_DENIED'; message: string; status: 403 }
  | { code: 'NOT_FOUND'; message: string; status: 404 }
  | { code: 'INTEGRITY_FAILED'; message: string; status: 500 }
  | { code: 'TOO_LARGE'; message: string; status: 413 };

export function renderSpecBytes(spec: DeliverableSpec): Uint8Array {
  const { body } = spec;
  if (body.type === 'docx') return buildDocx(body.document);
  if (body.type === 'csv') return new TextEncoder().encode(body.csv);
  return new TextEncoder().encode(body.html);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function toSummary(record: ManagerArtifactRecord): ArtifactSummary {
  const { content_base64: _omit, ...summary } = record;
  void _omit;
  return summary;
}

/**
 * Renders and stores every spec as an immutable artifact row. Any failure
 * throws, so the caller marks the task FAILED instead of reporting delivery.
 */
export async function persistDeliverables(input: {
  repo: NibrexoRepository;
  actor: ActorContext;
  taskId: UUID;
  specs: readonly DeliverableSpec[];
}): Promise<ManagerArtifactRecord[]> {
  const records: ManagerArtifactRecord[] = [];
  for (const spec of input.specs) {
    const bytes = renderSpecBytes(spec);
    if (bytes.length === 0) throw new Error(`Deliverable "${spec.title}" rendered no bytes.`);
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`Deliverable "${spec.title}" exceeds the size limit.`);

    const record = await input.repo.managerArtifacts.insert({
      id: newId(),
      organization_id: input.actor.organizationId,
      task_id: input.taskId,
      step_id: spec.stepId,
      kind: spec.kind,
      format: spec.format,
      title: spec.title,
      file_name: spec.fileName,
      mime_type: spec.mimeType,
      size_bytes: bytes.length,
      sha256: sha256Hex(bytes),
      content_base64: Buffer.from(bytes).toString('base64'),
      created_by: input.actor.userId,
    } as never);
    records.push(record);
  }
  return records;
}

/** Lists deliverables for one task. Content bytes are omitted. */
export async function listTaskDeliverables(input: {
  repo: NibrexoRepository;
  actor: ActorContext;
  taskId: UUID;
}): Promise<{ ok: true; data: ArtifactSummary[] } | { ok: false; error: ArtifactError }> {
  const decision = checkPermission(input.actor, { module: 'ai', action: 'view' });
  if (!decision.allowed) return { ok: false, error: { code: 'PERMISSION_DENIED', message: decision.reason, status: 403 } };
  const rows = await input.repo.managerArtifacts.list(input.actor.organizationId, { limit: 500 });
  return {
    ok: true,
    data: rows
      .filter((row) => row.task_id === input.taskId && row.organization_id === input.actor.organizationId)
      .map(toSummary),
  };
}

/**
 * Authorizes a download and returns the verified bytes. The check order is
 * role, then organization-scoped lookup, then digest verification.
 */
export async function authorizeArtifactDownload(input: {
  repo: NibrexoRepository;
  actor: ActorContext;
  artifactId: UUID;
}): Promise<
  | { ok: true; data: { record: ManagerArtifactRecord; bytes: Uint8Array } }
  | { ok: false; error: ArtifactError }
> {
  // Downloading generated deliverables is internal work product. The client
  // role has ai:view only, so it is refused here.
  const decision = checkPermission(input.actor, { module: 'ai', action: 'create' });
  if (!decision.allowed) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Your role cannot download generated deliverables.', status: 403 } };
  }

  const record = await input.repo.managerArtifacts.get(input.artifactId, input.actor.organizationId);
  if (!record || record.organization_id !== input.actor.organizationId) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Deliverable not found.', status: 404 } };
  }

  const task = await input.repo.tasks.get(record.task_id, input.actor.organizationId);
  if (!task) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Deliverable not found.', status: 404 } };
  }

  const bytes = new Uint8Array(Buffer.from(record.content_base64, 'base64'));
  if (bytes.length !== record.size_bytes || sha256Hex(bytes) !== record.sha256) {
    return {
      ok: false,
      error: { code: 'INTEGRITY_FAILED', message: 'The stored file failed its integrity check and was not delivered.', status: 500 },
    };
  }
  return { ok: true, data: { record, bytes } };
}
