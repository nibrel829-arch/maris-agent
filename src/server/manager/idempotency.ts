/**
 * Tool-result idempotency on the existing memory collection.
 *
 * Successful external or paid calls store their output under
 * scope `tool.idempotency`. A retry with the same task/step key returns that
 * output instead of calling the provider again. Blocked results are not stored,
 * so a later retry can run after configuration is added.
 */

import type { ToolContext } from '@/types/manager';

const SCOPE = 'tool.idempotency';

export async function readIdempotentOutput<T>(ctx: ToolContext): Promise<T | null> {
  const rows = await ctx.repo.memory.list(ctx.organizationId, { limit: 200 });
  const hit = rows.find((row) => row.scope === SCOPE && row.key === ctx.idempotencyKey);
  return hit ? (hit.value as T) : null;
}

export async function storeIdempotentOutput(ctx: ToolContext, value: unknown): Promise<void> {
  const existing = await readIdempotentOutput(ctx);
  if (existing) return;
  await ctx.repo.memory.insert({
    organization_id: ctx.organizationId,
    scope: SCOPE,
    key: ctx.idempotencyKey,
    value,
    created_by: ctx.actor.userId,
  });
}
