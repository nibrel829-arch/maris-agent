/**
 * Email Studio business service (Phase 16).
 *
 * Same pipeline as every other workspace service (PDF #12 §16):
 *   AUTHENTICATE (actor resolved by the caller) -> AUTHORIZE (permission guard,
 *   organization-scoped) -> VALIDATE INPUT (Zod in design-validation.ts +
 *   render/schema.ts) -> DATABASE (tenant-scoped repository; RLS underneath)
 *   -> EXTERNAL PROVIDER (test sends only, server-side) -> LOG (audit)
 *   -> RESPONSE (ServiceResult).
 *
 * Tenancy rules mirror clients/content/email:
 *  - `organization_id` always comes from `actor.organizationId`;
 *  - reads/updates filter by organization, so another org's row is NOT_FOUND;
 *  - nothing here sends a campaign automatically: the only send path is an
 *    explicit, permission-gated test email through the existing provider
 *    adapter, and promotion into `email_templates` keeps the Phase 10 draft /
 *    active lifecycle and the existing approval gates.
 */

import { newId } from '@/lib/id';
import { fail, ok, type ServiceResult } from '@/lib/result';
import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import { writeAudit } from '@/server/manager/audit';
import { sendEmail } from './service';
import {
  DEFAULT_EMAIL_BRAND_PROFILE,
  type EmailBrandProfile,
  type EmailDesign,
  type EmailDesignDocument,
  type EmailDesignStatus,
  type EmailBrandProfileRecord,
  type EmailSavedSection,
  type EmailValidationReport,
  type RenderedEmail,
} from '@/types/email-design';
import {
  buildSignedAssetUrl,
  resolveRequestOrigin,
  type SignedAssetUrl,
} from './asset-url';
import {
  emailBlockSchema,
  parseBrandProfile,
  parseDesignDocument,
  renderEmail,
  summarizeValidation,
} from './render';
import {
  type BrandProfileInput,
  type CreateDesignInput,
  type DesignListQuery,
  type PromoteDesignInput,
  type SavedSectionInput,
  type TestSendInput,
  type UpdateDesignInput,
} from './design-validation';
import type { ActorContext, EmailTemplate, UUID } from '@/types/domain';
import type { EmailProvider } from '@/server/integrations/email/provider';

export const DESIGN_LIST_WINDOW = 500;

function permissionDenied(actor: ActorContext, action: string): ServiceResult<never> {
  return fail(
    'PERMISSION_DENIED',
    `Role "${actor.role}" does not have "${action}" permission on module "email".`,
    { errorClass: 'permission', severity: 'error' },
  );
}

function notFound(): ServiceResult<never> {
  return fail('DESIGN_NOT_FOUND', 'Email design not found.', {
    errorClass: 'validation',
    severity: 'warning',
  });
}

/** Brand configuration is organization-wide: only owner/admin may change it. */
function canManageBrand(actor: ActorContext): boolean {
  const permitted = checkPermission(actor, { module: 'email', action: 'edit' }).allowed;
  return permitted && (actor.role === 'owner' || actor.role === 'admin');
}

/* -------------------------------------------------------------------------- */
/* Asset URLs                                                                  */
/* -------------------------------------------------------------------------- */

export interface AssetUrlOptions {
  /** Absolute origin used to build URLs a mail client can resolve. */
  baseUrl: string | null;
  ttlSeconds?: number;
}

/**
 * Returns a resolver that turns a Content Library media id into a signed,
 * expiring, organization-scoped URL. The browser canvas and the delivered
 * email use the same URL, so the preview is the artefact.
 */
export function createAssetUrlResolver(
  organizationId: UUID,
  options: AssetUrlOptions,
): (mediaId: string) => string | null {
  const base = options.baseUrl?.trim();
  if (!base) return () => null;
  return (mediaId: string) => {
    const signed: SignedAssetUrl = buildSignedAssetUrl({
      mediaId,
      organizationId,
      baseUrl: base,
      ...(options.ttlSeconds ? { ttlSeconds: options.ttlSeconds } : {}),
    });
    return signed.url;
  };
}

/** Convenience wrapper for route handlers. */
export function assetResolverFromRequest(organizationId: UUID, request: Request) {
  return createAssetUrlResolver(organizationId, { baseUrl: resolveRequestOrigin(request) });
}

/* -------------------------------------------------------------------------- */
/* Designs                                                                     */
/* -------------------------------------------------------------------------- */

export interface DesignListResult {
  designs: EmailDesign[];
  total: number;
  limit: number;
  offset: number;
}

export async function listDesigns(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: DesignListQuery,
): Promise<ServiceResult<DesignListResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const all = await repo.emailDesigns.list(actor.organizationId, { limit: DESIGN_LIST_WINDOW });
  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = all.filter((design) => {
    if (query.status && design.status !== query.status) return false;
    if (query.source && design.source !== query.source) return false;
    if (query.category && design.category !== query.category) return false;
    if (!needle) return true;
    const haystack = [design.name, design.category, design.subject].join(' ').toLowerCase();
    return needle
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  });

  const total = filtered.length;
  return ok({
    designs: filtered.slice(query.offset, query.offset + query.limit),
    total,
    limit: query.limit,
    offset: query.offset,
  });
}

export async function getDesign(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
): Promise<ServiceResult<EmailDesign>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }
  const design = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!design) return notFound();
  return ok(design);
}

export async function createDesign(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: CreateDesignInput,
): Promise<ServiceResult<EmailDesign>> {
  if (!checkPermission(actor, { module: 'email', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }

  const parsed = parseDesignDocument(input.design);
  if (!parsed.ok || !parsed.document) {
    return fail('DESIGN_INVALID', `The design document is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const status: EmailDesignStatus = input.status ?? 'draft';
  const design = await repo.emailDesigns.insert({
    organization_id: actor.organizationId,
    name: input.name.trim(),
    category: input.category.trim(),
    subject: input.subject.trim(),
    design: parsed.document,
    status,
    source: input.source ?? 'studio',
    template_id: null,
    created_by: actor.userId,
  } as unknown as EmailDesign);

  await writeAudit(repo, actor, {
    action: 'email.design.created',
    entityType: 'email_design',
    entityId: design.id,
    metadata: {
      name: design.name,
      category: design.category,
      status: design.status,
      source: design.source,
      blocks: parsed.document.blocks.length,
    },
  });

  return ok(design);
}

export async function updateDesign(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
  input: UpdateDesignInput,
): Promise<ServiceResult<EmailDesign>> {
  if (!checkPermission(actor, { module: 'email', action: 'edit' }).allowed) {
    return permissionDenied(actor, 'edit');
  }

  const existing = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!existing) return notFound();

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.category !== undefined) patch.category = input.category.trim();
  if (input.subject !== undefined) patch.subject = input.subject.trim();
  if (input.status !== undefined) patch.status = input.status;

  if (input.design !== undefined) {
    const parsed = parseDesignDocument(input.design);
    if (!parsed.ok || !parsed.document) {
      return fail('DESIGN_INVALID', `The design document is invalid: ${parsed.errors.join('; ')}`, {
        errorClass: 'validation',
        severity: 'warning',
      });
    }
    patch.design = parsed.document;
  }

  const updated = await repo.emailDesigns.update(designId, actor.organizationId, patch as Partial<EmailDesign>);
  if (!updated) return notFound();

  await writeAudit(repo, actor, {
    action: 'email.design.updated',
    entityType: 'email_design',
    entityId: designId,
    metadata: { changedFields: Object.keys(patch) },
  });

  return ok(updated);
}

export async function deleteDesign(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
): Promise<ServiceResult<{ deleted: true }>> {
  if (!checkPermission(actor, { module: 'email', action: 'delete' }).allowed) {
    return permissionDenied(actor, 'delete');
  }
  const existing = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!existing) return notFound();

  const deleted = await repo.emailDesigns.delete(designId, actor.organizationId);
  if (!deleted) return notFound();

  await writeAudit(repo, actor, {
    action: 'email.design.deleted',
    entityType: 'email_design',
    entityId: designId,
    metadata: { name: existing.name },
  });

  return ok({ deleted: true });
}

/** Copies a design inside the same organization (never across tenants). */
export async function duplicateDesign(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
  name?: string,
): Promise<ServiceResult<EmailDesign>> {
  if (!checkPermission(actor, { module: 'email', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }
  const existing = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!existing) return notFound();

  const copy = await repo.emailDesigns.insert({
    organization_id: actor.organizationId,
    name: (name ?? `${existing.name} (copy)`).trim().slice(0, 120),
    category: existing.category,
    subject: existing.subject,
    design: existing.design,
    status: 'draft',
    source: existing.source,
    template_id: null,
    created_by: actor.userId,
  } as unknown as EmailDesign);

  await writeAudit(repo, actor, {
    action: 'email.design.duplicated',
    entityType: 'email_design',
    entityId: copy.id,
    metadata: { from: designId },
  });

  return ok(copy);
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

export interface RenderDesignResult extends RenderedEmail {
  designId: UUID;
  designName: string;
  status: EmailDesignStatus;
}

export async function renderDesign(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
  options: { variables?: Record<string, string>; baseUrl?: string | null; subject?: string },
): Promise<ServiceResult<RenderDesignResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }
  const design = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!design) return notFound();

  const parsed = parseDesignDocument(design.design);
  if (!parsed.ok || !parsed.document) {
    return fail('DESIGN_INVALID', `Stored design is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const resolveAssetUrl = createAssetUrlResolver(actor.organizationId, {
    baseUrl: options.baseUrl ?? null,
  });

  const rendered = renderEmail(parsed.document, {
    ...(options.variables ? { variables: options.variables } : {}),
    // The stored design subject is the one the recipient will see.
    subject: options.subject ?? design.subject,
    resolveAssetUrl,
  });

  return ok({
    ...rendered,
    designId: design.id,
    designName: design.name,
    status: design.status,
  });
}

/** Renders an in-memory document (used by the studio's live preview). */
export function renderDesignDocument(
  organizationId: UUID,
  document: EmailDesignDocument,
  options: { variables?: Record<string, string>; baseUrl?: string | null; subject?: string },
): RenderedEmail {
  const resolveAssetUrl = createAssetUrlResolver(organizationId, { baseUrl: options.baseUrl ?? null });
  return renderEmail(document, {
    ...(options.variables ? { variables: options.variables } : {}),
    ...(options.subject ? { subject: options.subject } : {}),
    resolveAssetUrl,
  });
}

/**
 * Renders an unsaved document for the studio canvas. Permission is the same as
 * viewing a design; nothing is written to the database. This is what makes the
 * canvas show the real artefact while the user is still editing.
 */
export function renderDraftDesign(
  actor: ActorContext,
  input: { design: unknown; variables?: Record<string, string>; subject?: string },
  options: { baseUrl?: string | null } = {},
): ServiceResult<RenderedEmail> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }
  const parsed = parseDesignDocument(input.design);
  if (!parsed.ok || !parsed.document) {
    return fail('DESIGN_INVALID', `The design document is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }
  return ok(
    renderDesignDocument(actor.organizationId, parsed.document, {
      ...(input.variables ? { variables: input.variables } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Test send (existing provider, never a campaign send)                        */
/* -------------------------------------------------------------------------- */

export interface TestSendResult {
  status: 'SENT' | 'FAILED';
  to: string;
  subject: string;
  provider: string | null;
  providerMessageId: string | null;
  emailLogId: UUID | null;
  errorMessage: string | null;
  validation: EmailValidationReport;
}

/**
 * Sends one test message through the existing provider adapter. This is the
 * only send path in the studio: it requires `email:send`, it is labelled as a
 * test, it is idempotent per (design, recipient) and it records an `email_logs`
 * row with the real provider outcome. A campaign is never sent from here.
 */
export async function sendDesignTestEmail(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
  input: TestSendInput,
  options: { providerOverride?: EmailProvider; baseUrl?: string | null } = {},
): Promise<ServiceResult<TestSendResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) {
    return permissionDenied(actor, 'send');
  }

  const design = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!design) return notFound();

  const parsed = parseDesignDocument(design.design);
  if (!parsed.ok || !parsed.document) {
    return fail('DESIGN_INVALID', `Stored design is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const rendered = renderDesignDocument(actor.organizationId, parsed.document, {
    ...(input.variables ? { variables: input.variables } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });

  if (!rendered.validation.ok) {
    return fail(
      'EMAIL_DESIGN_INVALID',
      `Fix the blocking issues before sending a test: ${summarizeValidation(rendered.validation)}`,
      { errorClass: 'validation', severity: 'warning' },
    );
  }

  const subject = (input.subject ?? `[Test] ${design.subject}`).trim().slice(0, 300);

  const outcome = await sendEmail(
    actor,
    repo,
    {
      to: input.to,
      subject,
      body: rendered.html,
      variables: {},
      idempotencyKey: `design-test:${designId}:${input.to.toLowerCase()}`,
    },
    { ...(options.providerOverride ? { providerOverride: options.providerOverride } : {}) },
  );

  if (!outcome.ok) {
    await writeAudit(repo, actor, {
      action: 'email.design.test_failed',
      entityType: 'email_design',
      entityId: designId,
      metadata: { to: input.to, code: outcome.error.code },
    });
    return fail(outcome.error.code, outcome.error.message, outcome.error);
  }

  await writeAudit(repo, actor, {
    action: 'email.design.test_sent',
    entityType: 'email_design',
    entityId: designId,
    metadata: {
      to: input.to,
      email_log_id: outcome.data.log.id,
      provider: outcome.data.provider,
      provider_message_id: outcome.data.providerMessageId,
      status: outcome.data.status,
    },
  });

  return ok({
    status: outcome.data.status === 'SENT' ? 'SENT' : 'FAILED',
    to: input.to,
    subject,
    provider: outcome.data.provider,
    providerMessageId: outcome.data.providerMessageId,
    emailLogId: outcome.data.log.id,
    errorMessage: outcome.data.log.error_message,
    validation: rendered.validation,
  });
}

/* -------------------------------------------------------------------------- */
/* Promotion into the existing email_templates table                           */
/* -------------------------------------------------------------------------- */

/**
 * Writes the rendered design into the Phase 10 `email_templates` table so the
 * existing composer, sequences, campaigns and send pipeline can use it. The
 * created template keeps the draft/active lifecycle: promotion never activates
 * a template for sending, and sending still requires `email:send` plus the
 * existing approval gates.
 */
export async function promoteDesignToTemplate(
  actor: ActorContext,
  repo: NibrexoRepository,
  designId: UUID,
  input: PromoteDesignInput,
  options: { baseUrl?: string | null } = {},
): Promise<ServiceResult<{ design: EmailDesign; template: EmailTemplate }>> {
  if (!checkPermission(actor, { module: 'email', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }

  const design = await repo.emailDesigns.get(designId, actor.organizationId);
  if (!design) return notFound();

  const parsed = parseDesignDocument(design.design);
  if (!parsed.ok || !parsed.document) {
    return fail('DESIGN_INVALID', `Stored design is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const rendered = renderDesignDocument(actor.organizationId, parsed.document, {
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  if (!rendered.validation.ok) {
    return fail(
      'EMAIL_DESIGN_INVALID',
      `Fix the blocking issues before promoting this design: ${summarizeValidation(rendered.validation)}`,
      { errorClass: 'validation', severity: 'warning' },
    );
  }

  const status = input.status ?? 'draft';
  const name = (input.name ?? design.name).trim().slice(0, 100);
  const category = (input.category ?? design.category).trim().slice(0, 80);

  let template: EmailTemplate;
  const existingTemplateId = design.template_id;
  const existingTemplate = existingTemplateId
    ? await repo.emailTemplates.get(existingTemplateId, actor.organizationId)
    : null;

  if (existingTemplate && existingTemplateId) {
    if (!checkPermission(actor, { module: 'email', action: 'edit' }).allowed) {
      return permissionDenied(actor, 'edit');
    }
    const updated = await repo.emailTemplates.update(existingTemplateId, actor.organizationId, {
      name,
      category,
      subject: design.subject.trim(),
      body: rendered.html,
      variables: rendered.unresolvedVariables,
      archived: false,
      status,
    } as unknown as Partial<EmailTemplate>);
    if (!updated) return notFound();
    template = updated;
  } else {
    template = (await repo.emailTemplates.insert({
      organization_id: actor.organizationId,
      name,
      category,
      subject: design.subject.trim(),
      body: rendered.html,
      variables: rendered.unresolvedVariables,
      archived: false,
      status,
    } as unknown as EmailTemplate)) as EmailTemplate;

    const updatedDesign = await repo.emailDesigns.update(designId, actor.organizationId, {
      template_id: template.id,
    } as unknown as Partial<EmailDesign>);
    if (!updatedDesign) return notFound();

    await writeAudit(repo, actor, {
      action: 'email.design.promoted',
      entityType: 'email_design',
      entityId: designId,
      metadata: { template_id: template.id, status },
    });

    return ok({ design: updatedDesign, template });
  }

  await writeAudit(repo, actor, {
    action: 'email.design.promoted',
    entityType: 'email_design',
    entityId: designId,
    metadata: { template_id: template.id, status },
  });

  const refreshed = (await repo.emailDesigns.get(designId, actor.organizationId)) ?? design;
  return ok({ design: refreshed, template });
}

/* -------------------------------------------------------------------------- */
/* Brand profile + saved sections                                              */
/* -------------------------------------------------------------------------- */

export interface BrandProfileResult {
  profile: EmailBrandProfile;
  /** Null when the organization has never saved a brand profile. */
  recordId: UUID | null;
  updatedAt: string | null;
}

export async function getBrandProfile(
  actor: ActorContext,
  repo: NibrexoRepository,
): Promise<ServiceResult<BrandProfileResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }
  const rows = await repo.emailBrandProfiles.list(actor.organizationId, { limit: 1 });
  const row = rows[0];
  if (!row) {
    return ok({ profile: DEFAULT_EMAIL_BRAND_PROFILE, recordId: null, updatedAt: null });
  }
  const parsed = parseBrandProfile(row.brand);
  if (!parsed.ok) {
    return fail('BRAND_INVALID', `Stored brand profile is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }
  return ok({ profile: parsed.profile, recordId: row.id, updatedAt: row.updated_at });
}

/** Upserts the organization brand profile (owner/admin only). */
export async function updateBrandProfile(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: BrandProfileInput,
): Promise<ServiceResult<BrandProfileResult>> {
  if (!canManageBrand(actor)) {
    return fail(
      'PERMISSION_DENIED',
      'Brand configuration is organization-wide and requires an owner or admin role with email:edit.',
      { errorClass: 'permission', severity: 'error' },
    );
  }

  const current = await getBrandProfile(actor, repo);
  const base = current.ok ? current.data.profile : DEFAULT_EMAIL_BRAND_PROFILE;

  const candidate = {
    brandName: input.brandName,
    logo: input.logo,
    colors: { ...base.colors, ...input.colors },
    typography: { ...base.typography, ...(input.typography ?? {}) },
    button: { ...base.button, ...(input.button ?? {}) },
    headerDefaults: { ...base.headerDefaults, ...(input.headerDefaults ?? {}) },
    footerDefaults: { ...base.footerDefaults, ...(input.footerDefaults ?? {}) },
    savedSections: base.savedSections,
  };

  const parsed = parseBrandProfile(candidate);
  if (!parsed.ok) {
    return fail('BRAND_INVALID', `Brand profile is invalid: ${parsed.errors.join('; ')}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const rows = await repo.emailBrandProfiles.list(actor.organizationId, { limit: 1 });
  const existing = rows[0];

  if (existing) {
    const updated = await repo.emailBrandProfiles.update(existing.id, actor.organizationId, {
      brand: parsed.profile,
    } as unknown as Partial<EmailBrandProfileRecord>);
    if (!updated) return notFound();
    await writeAudit(repo, actor, {
      action: 'email.brand.updated',
      entityType: 'email_brand_profile',
      entityId: existing.id,
      metadata: { brandName: parsed.profile.brandName },
    });
    return ok({ profile: parsed.profile, recordId: existing.id, updatedAt: updated.updated_at });
  }

  const created = await repo.emailBrandProfiles.insert({
    organization_id: actor.organizationId,
    brand: parsed.profile,
    created_by: actor.userId,
  } as unknown as EmailBrandProfileRecord);
  await writeAudit(repo, actor, {
    action: 'email.brand.created',
    entityType: 'email_brand_profile',
    entityId: created.id,
    metadata: { brandName: parsed.profile.brandName },
  });
  return ok({ profile: parsed.profile, recordId: created.id, updatedAt: created.updated_at });
}

/** Saves a block as a reusable section on the organization brand profile. */
export async function saveBrandSection(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: SavedSectionInput,
): Promise<ServiceResult<EmailSavedSection>> {
  if (!canManageBrand(actor)) {
    return fail(
      'PERMISSION_DENIED',
      'Saving reusable sections requires an owner or admin role with email:edit.',
      { errorClass: 'permission', severity: 'error' },
    );
  }

  const blockParsed = emailBlockSchema.safeParse(input.block);
  if (!blockParsed.success) {
    return fail('SECTION_INVALID', `The section block is invalid: ${blockParsed.error.issues[0]?.message ?? ''}`, {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const current = await getBrandProfile(actor, repo);
  if (!current.ok) return current;
  const base = current.data.profile;

  const section: EmailSavedSection = {
    id: newId(),
    name: input.name.trim(),
    block: blockParsed.data,
  };

  const next = { ...base, savedSections: [...base.savedSections, section].slice(-40) };
  const writeResult = await writeBrandProfile(actor, repo, current.data.recordId, next);
  if (!writeResult.ok) return writeResult;

  await writeAudit(repo, actor, {
    action: 'email.brand.section_saved',
    entityType: 'email_brand_profile',
    entityId: current.data.recordId ?? 'none',
    metadata: { section: section.name },
  });

  return ok(section);
}

/** Removes a reusable section from the organization brand profile. */
export async function deleteBrandSection(
  actor: ActorContext,
  repo: NibrexoRepository,
  sectionId: string,
): Promise<ServiceResult<{ deleted: true }>> {
  if (!canManageBrand(actor)) {
    return fail(
      'PERMISSION_DENIED',
      'Managing reusable sections requires an owner or admin role with email:edit.',
      { errorClass: 'permission', severity: 'error' },
    );
  }

  const current = await getBrandProfile(actor, repo);
  if (!current.ok) return current;
  const base = current.data.profile;
  const next = { ...base, savedSections: base.savedSections.filter((section) => section.id !== sectionId) };
  const writeResult = await writeBrandProfile(actor, repo, current.data.recordId, next);
  if (!writeResult.ok) return writeResult;

  await writeAudit(repo, actor, {
    action: 'email.brand.section_deleted',
    entityType: 'email_brand_profile',
    entityId: current.data.recordId ?? 'none',
    metadata: { sectionId },
  });

  return ok({ deleted: true });
}

async function writeBrandProfile(
  actor: ActorContext,
  repo: NibrexoRepository,
  recordId: UUID | null,
  profile: EmailBrandProfile,
): Promise<ServiceResult<BrandProfileResult>> {
  const rows = recordId ? [await repo.emailBrandProfiles.get(recordId, actor.organizationId)] : [];
  const existing = rows[0];
  if (existing) {
    const updated = await repo.emailBrandProfiles.update(existing.id, actor.organizationId, {
      brand: profile,
    } as unknown as Partial<EmailBrandProfileRecord>);
    if (!updated) return notFound();
    return ok({ profile, recordId: existing.id, updatedAt: updated.updated_at });
  }
  const created = await repo.emailBrandProfiles.insert({
    organization_id: actor.organizationId,
    brand: profile,
    created_by: actor.userId,
  } as unknown as EmailBrandProfileRecord);
  return ok({ profile, recordId: created.id, updatedAt: created.updated_at });
}

/* -------------------------------------------------------------------------- */
/* Defaults used by the studio when a new design is created                    */
/* -------------------------------------------------------------------------- */

export { emptyDesignDocument } from '@/features/email/studio/block-defaults';
