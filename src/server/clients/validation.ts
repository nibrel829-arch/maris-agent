/**
 * Clients/CRM validation (Phase 5).
 *
 * One Zod source of truth shared by the API routes and the service layer.
 * The browser never supplies `organization_id`, `created_by` or `id`: those
 * keys are absent from every schema, so Zod strips them even if a caller
 * sends them, and the service always takes tenancy from the ActorContext.
 */

import { z } from 'zod';
import {
  CLIENT_STATUSES,
  isClientStatus,
} from '@/features/clients/client-statuses';

export { CLIENT_STATUSES, isClientStatus };

/** Empty form fields arrive as `''`; treat them as "not supplied". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Client name is required.')
  .max(200, 'Client name must be 200 characters or fewer.');

const companySchema = z
  .string()
  .trim()
  .max(200, 'Company must be 200 characters or fewer.');

const emailSchema = z
  .string()
  .trim()
  .max(320, 'Email address is too long.')
  .email('Enter a valid email address.');

const phoneSchema = z
  .string()
  .trim()
  .max(50, 'Phone number must be 50 characters or fewer.')
  .regex(/^[+\d][\d\s\-().]*$/, 'Enter a valid phone number.')
  .refine((value) => value.replace(/\D/g, '').length >= 5, 'Enter a valid phone number.');

const notesSchema = z.string().max(5000, 'Notes must be 5000 characters or fewer.');

const tagsSchema = z
  .array(z.string().trim().min(1).max(50, 'Tags must be 50 characters or fewer.'))
  .max(25, 'A client can have at most 25 tags.');

export const createClientSchema = z.object({
  name: nameSchema,
  company: z.preprocess(emptyToUndefined, companySchema.optional()),
  email: z.preprocess(emptyToUndefined, emailSchema.optional()),
  phone: z.preprocess(emptyToUndefined, phoneSchema.optional()),
  status: z.enum(CLIENT_STATUSES).default('lead'),
  notes: z.preprocess(emptyToUndefined, notesSchema.optional()),
  tags: tagsSchema.default([]),
});

export type CreateClientInput = z.output<typeof createClientSchema>;

export const updateClientSchema = z
  .object({
    name: nameSchema.optional(),
    company: z.preprocess(emptyToUndefined, companySchema.optional()),
    email: z.preprocess(emptyToUndefined, emailSchema.optional()),
    phone: z.preprocess(emptyToUndefined, phoneSchema.optional()),
    status: z.enum(CLIENT_STATUSES).optional(),
    notes: z.preprocess(emptyToUndefined, notesSchema.optional()),
    tags: tagsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'No changes supplied.',
  });

export type UpdateClientInput = z.output<typeof updateClientSchema>;

export const addClientNoteSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, 'A note subject is required.')
    .max(200, 'Note subject must be 200 characters or fewer.'),
  body: z.preprocess(emptyToUndefined, notesSchema.optional()),
});

export type AddClientNoteInput = z.output<typeof addClientNoteSchema>;

export const clientListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ClientListQuery = z.output<typeof clientListQuerySchema>;

export const clientIdSchema = z.string().uuid('Client id must be a valid UUID.');
