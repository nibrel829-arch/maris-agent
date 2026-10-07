import { z } from 'zod';
import { SOCIAL_PLATFORMS } from '@/server/social/validation';

const uuidSchema = z.string().uuid();

export const inboxListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  platform: z.enum(SOCIAL_PLATFORMS).optional(),
  accountId: uuidSchema.optional(),
  unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  status: z.enum(['open', 'closed', 'archived']).optional(),
  query: z.string().trim().max(120).optional(),
});

export type InboxListQueryInput = z.infer<typeof inboxListQuerySchema>;

export const inboxMessageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  before: z.string().datetime({ offset: true }).optional(),
});

export const updateConversationSchema = z
  .object({
    is_read: z.boolean().optional(),
    status: z.enum(['open', 'closed', 'archived']).optional(),
    client_id: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one inbox field to update.' });

export const replySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply first.').max(10_000, 'Reply must be 10,000 characters or fewer.'),
});

export const draftSchema = z.object({
  draft: z.string().trim().max(10_000).nullable(),
});

export const accountSyncSchema = z.object({
  accountId: uuidSchema,
});

export const replyIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid idempotency key.');
