/**
 * Publishing validation (Phase 8).
 *
 * Zod source of truth shared by the API routes and the publish service. The
 * browser never supplies `organization_id`, `created_by` or job ids: those
 * keys are absent from every schema. Per-target provider options are parsed
 * here (shape) and interpreted by each publisher (meaning).
 */

import { z } from 'zod';

export const publishTargetOptionSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string().max(500), z.boolean()]),
);

export const publishTargetSchema = z.object({
  accountId: z.string().uuid('Account id must be a valid UUID.'),
  /** Per-target provider options (boardId, privacyStatus, categoryId...). */
  options: publishTargetOptionSchema.default({}),
  /** Library image used as the Pinterest video-Pin cover. */
  coverMediaId: z.string().uuid('Cover media id must be a valid UUID.').optional(),
});

export type PublishTargetInput = z.output<typeof publishTargetSchema>;

const runAtSchema = z
  .string()
  .datetime({ offset: true, message: 'runAt must be an ISO datetime with offset.' })
  .refine((value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms < Date.now() + 366 * 24 * 60 * 60 * 1000;
  }, 'Scheduled time must be within one year.');

export const createPublishSchema = z.object({
  contentId: z.string().uuid('Content id must be a valid UUID.'),
  /** Library media override. Defaults to the content item's own media. */
  mediaId: z.string().uuid('Media id must be a valid UUID.').nullable().optional(),
  /** External link for link-style posts. Defaults to the item's media URL when absolute. */
  linkUrl: z.string().trim().url('Link must be a valid URL.').max(2048).nullable().optional(),
  targets: z
    .array(publishTargetSchema)
    .min(1, 'Choose at least one account.')
    .max(10, 'A publish request targets at most 10 accounts.')
    .refine((targets) => new Set(targets.map((t) => t.accountId)).size === targets.length, {
      message: 'Each account may appear once per request.',
    }),
  /** Omitted = publish now. */
  runAt: runAtSchema.optional(),
  timezone: z.string().min(1).max(64).default('UTC'),
  /** Client idempotency key; a derived key is used when omitted. */
  idempotencyKey: z
    .string()
    .trim()
    .min(8, 'Idempotency key must be at least 8 characters.')
    .max(128, 'Idempotency key must be 128 characters or fewer.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key may only contain letters, digits, - and _.')
    .optional(),
});

export type CreatePublishInput = z.output<typeof createPublishSchema>;

export const validatePublishSchema = createPublishSchema.omit({ idempotencyKey: true });

export type ValidatePublishInput = z.output<typeof validatePublishSchema>;

export const publishListQuerySchema = z.object({
  contentId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  status: z
    .enum(['queued', 'publishing', 'verifying', 'scheduled', 'published', 'failed', 'unknown', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type PublishListQuery = z.output<typeof publishListQuerySchema>;

export const publishJobIdSchema = z.string().uuid('Job id must be a valid UUID.');

/** Maximum immediate steps the executor runs inside one claim/invocation. */
export const MAX_IMMEDIATE_STEPS = 6;
/** Jobs claimed per sweeper invocation. */
export const SWEEP_CLAIM_LIMIT = 10;
/** Claim lock lease (seconds). Must exceed one job's worst-case step time. */
export const SWEEP_LOCK_SECONDS = 300;
