/**
 * Sequences validation — one Zod source of truth (Phase 11).
 * Browser never supplies organization_id.
 */
import { z } from 'zod';

export const sequenceStatus = z.enum(['draft', 'active', 'paused', 'archived', 'completed']);

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const sequenceStepSchema = z.object({
  templateId: z.string().uuid('A valid template id is required.'),
  delayDays: z.number().int().min(0).max(90).default(0),
  delayHours: z.number().int().min(0).max(23).default(0),
  // Optional subject override is not used — template is authoritative
});

export const createSequenceSchema = z.object({
  name: z.string().trim().min(1, 'Sequence name is required.').max(100),
  description: z.string().trim().max(500).optional(),
  trigger: z.string().trim().min(1, 'Trigger is required.').max(200).default('manual'),
  steps: z.array(sequenceStepSchema).min(1, 'At least one step is required.').max(10, 'At most 10 steps.'),
  stopConditions: z.array(z.string().trim().max(200)).max(15).default([]),
  status: sequenceStatus.default('draft').optional(),
});

export const updateSequenceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    trigger: z.string().trim().min(1).max(200).optional(),
    steps: z.array(sequenceStepSchema).min(1).max(10).optional(),
    stopConditions: z.array(z.string().trim().max(200)).max(15).optional(),
    status: sequenceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const sequenceListQuerySchema = z.object({
  search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  status: z.preprocess(emptyToUndefined, sequenceStatus.optional()),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema>;
export type SequenceListQuery = z.infer<typeof sequenceListQuerySchema>;
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;

export const enrollSequenceSchema = z.object({
  clientIds: z.array(z.string().uuid()).max(100).default([]),
  emails: z.array(z.string().trim().email().max(254)).max(100).default([]),
  // Optional per-recipient variables for template rendering at send time
  variables: z.record(z.string(), z.string()).default({}),
});

export type EnrollSequenceInput = z.infer<typeof enrollSequenceSchema>;

export const enrollmentListQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, z.string().trim().max(20).optional()),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type EnrollmentListQuery = z.infer<typeof enrollmentListQuerySchema>;
