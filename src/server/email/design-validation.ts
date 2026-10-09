/**
 * Email Studio — API input schemas (Phase 16).
 *
 * The browser never supplies `organization_id`, `created_by`, `id` or the
 * design `status` transitions it is not allowed to make. Everything else is
 * validated here, including the design document itself (Zod, in
 * `render/schema.ts`), so a malformed payload fails before it reaches the
 * renderer or the database.
 */

import { z } from 'zod';
import { emailSocialPlatform } from './render/schema';

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const emailDesignStatus = z.enum(['draft', 'active', 'archived']);
export const emailDesignSource = z.enum(['studio', 'manager', 'starter', 'template']);

export const createDesignSchema = z.object({
  name: z.string().trim().min(1, 'Design name is required.').max(120),
  category: z.string().trim().min(1, 'Category is required.').max(80),
  subject: z.string().trim().min(1, 'Subject is required.').max(300),
  /** The full design document (blocks + brand + settings). */
  design: z.unknown(),
  status: emailDesignStatus.default('draft').optional(),
  source: emailDesignSource.default('studio').optional(),
});

export const updateDesignSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    category: z.string().trim().min(1).max(80).optional(),
    subject: z.string().trim().min(1).max(300).optional(),
    design: z.unknown().optional(),
    status: emailDesignStatus.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

export const designListQuerySchema = z.object({
  search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  category: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  status: z.preprocess(emptyToUndefined, emailDesignStatus.optional()),
  source: z.preprocess(emptyToUndefined, emailDesignSource.optional()),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const renderDesignSchema = z.object({
  variables: z.record(z.string(), z.string()).default({}),
});

export const testSendSchema = z.object({
  to: z.string().trim().email('A valid recipient email is required.').max(254),
  variables: z.record(z.string(), z.string()).default({}),
  /** Optional explicit subject override for the test message. */
  subject: z.string().trim().min(1).max(300).optional(),
});

export const promoteDesignSchema = z.object({
  /** Target template name (defaults to the design name). */
  name: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  /** Activate the created template immediately (default: draft). */
  status: z.enum(['draft', 'active']).default('draft').optional(),
});

export const brandProfileSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  logo: z.object({
    mediaId: z.string().uuid().nullable(),
    url: z.string().trim().max(2048).nullable(),
    alt: z.string().trim().max(300),
  }),
  colors: z.record(z.string(), z.string()).default({}),
  typography: z
    .object({
      headingFont: z.string().trim().max(160),
      bodyFont: z.string().trim().max(160),
      baseSize: z.coerce.number().int().min(12).max(20),
    })
    .optional(),
  button: z
    .object({
      radius: z.coerce.number().int().min(0).max(40),
      uppercase: z.boolean(),
      fontWeight: z.enum(['normal', 'bold']),
    })
    .optional(),
  headerDefaults: z
    .object({
      brandName: z.string().trim().max(120),
      navLinks: z.array(z.object({ label: z.string().trim().max(120), url: z.string().trim().max(2048) })).max(8),
      showNav: z.boolean(),
    })
    .optional(),
  footerDefaults: z
    .object({
      companyName: z.string().trim().max(160),
      addressLine: z.string().trim().max(300),
      contactEmail: z.string().trim().max(160),
      contactPhone: z.string().trim().max(60),
      preferencesUrl: z.string().trim().max(2048),
      unsubscribeUrl: z.string().trim().max(2048),
      legalText: z.string().trim().max(600),
      socialLinks: z.array(z.object({ platform: emailSocialPlatform, url: z.string().trim().max(2048) })).max(10),
    })
    .optional(),
});

export const savedSectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  block: z.unknown(),
});

export const deleteSectionSchema = z.object({
  sectionId: z.string().trim().min(1).max(80),
});

export type CreateDesignInput = z.infer<typeof createDesignSchema>;
export type UpdateDesignInput = z.infer<typeof updateDesignSchema>;
export type DesignListQuery = z.infer<typeof designListQuerySchema>;
export type RenderDesignInput = z.infer<typeof renderDesignSchema>;
export type TestSendInput = z.infer<typeof testSendSchema>;
export type PromoteDesignInput = z.infer<typeof promoteDesignSchema>;
export type BrandProfileInput = z.infer<typeof brandProfileSchema>;
export type SavedSectionInput = z.infer<typeof savedSectionSchema>;
