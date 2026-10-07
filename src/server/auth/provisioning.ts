/**
 * Owner membership provisioning (PDF #11 §5 multi-tenant security,
 * `docs/SUPABASE_VERIFICATION.md`).
 *
 * Production problem this solves: Supabase Auth can authenticate a user while
 * no `public.memberships` row exists, so `resolveActor()` correctly returns
 * `NO_ORGANIZATION`. The row cannot be created by the user, because
 * `0004_rls_policies.sql` only allows membership writes by an existing
 * owner/admin of that same organization (`memberships_admin_write`) — a
 * deliberate chicken-and-egg boundary, not a bug. Bootstrapping the *first*
 * owner is therefore an operator action performed with the service role (or in
 * the Supabase SQL editor), never a self-serve signup flow.
 *
 * This module is the pure decision layer: given what already exists, it says
 * exactly which rows must be created or promoted — and it refuses to guess when
 * the project is ambiguous. It creates at most ONE organization, ONE profile and
 * ONE membership, and it never deletes or downgrades anything.
 */

import { fail, ok, type ServiceResult } from '@/lib/result';
import type { OrgRole, UUID } from '@/types/domain';
import { isOrgRole } from './permissions';
import { isElevatedRole, type ElevatedRole } from './authorization';

/** `public.organizations` row (subset). */
export interface OrganizationRecord {
  id: UUID;
  name: string;
  slug: string;
}

/** `public.memberships` row belonging to the target user (subset). */
export interface MembershipRecordForUser {
  organization_id: UUID;
  role: string;
}

export interface ProvisionOwnerSnapshot {
  /** `public.profiles` row for the target user, or `null` when it is missing. */
  profile: { id: UUID } | null;
  /** Every organization in the project — used to detect duplicates. */
  organizations: OrganizationRecord[];
  /** Every membership of the target user, in any organization. */
  memberships: MembershipRecordForUser[];
}

export interface ProvisionOwnerRequest {
  userId: UUID;
  organizationName: string;
  organizationSlug: string;
  /** Elevated role to grant. Defaults to `owner`. Members/clients are refused. */
  role?: ElevatedRole;
  /** Optional profile name. An existing profile is never overwritten. */
  fullName?: string | null;
}

export type ProvisionOwnerStep =
  | { kind: 'create_organization'; name: string; slug: string }
  | { kind: 'reuse_organization'; organizationId: UUID; name: string; slug: string }
  | { kind: 'create_profile'; userId: UUID; fullName: string | null }
  | { kind: 'keep_profile'; userId: UUID }
  | { kind: 'create_membership'; organizationId: UUID; userId: UUID; role: ElevatedRole }
  | { kind: 'promote_membership'; organizationId: UUID; userId: UUID; from: OrgRole; to: ElevatedRole }
  | { kind: 'keep_membership'; organizationId: UUID; userId: UUID; role: ElevatedRole };

export interface ProvisionOwnerPlan {
  userId: UUID;
  role: ElevatedRole;
  /** `id` is null only while the organization still has to be created. */
  organization: { id: UUID | null; name: string; slug: string; willBeCreated: boolean };
  profileWillBeCreated: boolean;
  membershipWillBeCreated: boolean;
  /** Set when an existing membership is promoted to the intended role. */
  membershipRoleChange: { from: OrgRole; to: ElevatedRole } | null;
  /** True when the authorization chain already matches the intent. */
  alreadyAuthorized: boolean;
  /** True when at least one row must be written. */
  requiresWrite: boolean;
  steps: ProvisionOwnerStep[];
  /** Operator-facing facts and warnings. Never contains secrets. */
  notes: string[];
}

/** `public.organizations.slug` check constraint from `0001_core_identity.sql`. */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function roleOf(value: string): OrgRole {
  return isOrgRole(value) ? value : 'member';
}

/**
 * Plans the owner bootstrap. Idempotent: running it twice produces the same
 * plan, and the second run reports `alreadyAuthorized: true`.
 */
export function planOwnerProvisioning(
  request: ProvisionOwnerRequest,
  snapshot: ProvisionOwnerSnapshot,
): ServiceResult<ProvisionOwnerPlan> {
  const userId = request.userId?.trim() ?? '';
  const slug = request.organizationSlug?.trim() ?? '';
  const name = request.organizationName?.trim() ?? '';
  const role: ElevatedRole = request.role ?? 'owner';

  if (!isUuid(userId)) {
    return fail(
      'INVALID_USER_ID',
      'A Supabase Auth user UUID is required. Resolve the signed-in user by email or pass the id from auth.users.',
      { errorClass: 'validation', severity: 'error' },
    );
  }

  if (!isElevatedRole(role)) {
    return fail(
      'INVALID_ROLE',
      'Owner bootstrap only grants "owner" or "admin". Members and clients are invited through the application, not provisioned here.',
      { errorClass: 'validation', severity: 'error' },
    );
  }

  if (!ORGANIZATION_SLUG_PATTERN.test(slug)) {
    return fail(
      'INVALID_ORG_SLUG',
      `Organization slug "${slug}" does not satisfy the database constraint (2-61 characters, lowercase letters, digits and hyphens, starting with a letter or digit).`,
      { errorClass: 'validation', severity: 'error' },
    );
  }

  if (name.length < 1 || name.length > 200) {
    return fail('INVALID_ORG_NAME', 'Organization name must be between 1 and 200 characters.', {
      errorClass: 'validation',
      severity: 'error',
    });
  }

  const notes: string[] = [];
  const organizations = snapshot.organizations ?? [];

  // ---- resolve the single target organization -----------------------------
  let target: OrganizationRecord | null = null;
  let willBeCreated = false;

  if (organizations.length === 0) {
    willBeCreated = true;
    notes.push(
      `No organization exists in this project. The single intended organization "${slug}" will be created.`,
    );
  } else if (organizations.length === 1) {
    const only = organizations[0] as OrganizationRecord;
    target = only;
    notes.push(
      only.slug === slug
        ? `Organization "${only.slug}" already exists and is reused.`
        : `One organization exists ("${only.slug}"); it is reused rather than creating a second one for "${slug}".`,
    );
  } else {
    const matches = organizations.filter(
      (organization) => organization.slug.toLowerCase() === slug.toLowerCase(),
    );
    const match = matches[0];

    if (matches.length !== 1 || !match) {
      return fail(
        'AMBIGUOUS_ORGANIZATION',
        `This project has ${organizations.length} organizations and none uniquely matches slug "${slug}". Refusing to guess: pass the exact slug of the intended Nibrexo organization (--org-slug) or resolve the duplicate manually. No organization was created.`,
        { errorClass: 'validation', severity: 'error' },
      );
    }

    target = match;
    notes.push(
      `Multiple organizations exist; the one matching slug "${slug}" is reused. ${organizations.length - 1} other organization(s) are left untouched.`,
    );
  }

  const profileWillBeCreated = snapshot.profile === null;

  // ---- resolve the membership --------------------------------------------
  const existingMembership = target
    ? (snapshot.memberships.find((membership) => membership.organization_id === target?.id) ?? null)
    : null;

  const otherMemberships = snapshot.memberships.filter(
    (membership) => !target || membership.organization_id !== target.id,
  );
  if (otherMemberships.length > 0) {
    notes.push(
      `The user keeps ${otherMemberships.length} membership(s) in other organizations; nothing is modified or removed there.`,
    );
  }

  let membershipWillBeCreated = false;
  let membershipRoleChange: { from: OrgRole; to: ElevatedRole } | null = null;
  let keptRole: ElevatedRole = role;

  if (!target || !existingMembership) {
    membershipWillBeCreated = true;
  } else {
    const current = roleOf(existingMembership.role);

    if (current === role) {
      notes.push(`The user is already "${role}" of this organization; the membership is left as it is.`);
    } else if (current === 'owner') {
      // Never downgrade an existing owner.
      keptRole = 'owner';
      notes.push('The user is already "owner"; the requested lower role is ignored to avoid a downgrade.');
    } else {
      membershipRoleChange = { from: current, to: role };
      keptRole = role;
    }
  }

  // ---- build the ordered step list ---------------------------------------
  const steps: ProvisionOwnerStep[] = [];

  if (target) {
    steps.push({
      kind: 'reuse_organization',
      organizationId: target.id,
      name: target.name,
      slug: target.slug,
    });
  } else {
    steps.push({ kind: 'create_organization', name, slug });
  }

  steps.push(
    profileWillBeCreated
      ? { kind: 'create_profile', userId, fullName: request.fullName ?? null }
      : { kind: 'keep_profile', userId },
  );

  if (membershipWillBeCreated) {
    steps.push({
      kind: 'create_membership',
      // The organization id is resolved after the insert during execution.
      organizationId: target?.id ?? '',
      userId,
      role,
    });
  } else if (membershipRoleChange && target) {
    steps.push({
      kind: 'promote_membership',
      organizationId: target.id,
      userId,
      from: membershipRoleChange.from,
      to: membershipRoleChange.to,
    });
  } else if (target) {
    steps.push({ kind: 'keep_membership', organizationId: target.id, userId, role: keptRole });
  }

  const requiresWrite = steps.some(
    (step) =>
      step.kind === 'create_organization' ||
      step.kind === 'create_profile' ||
      step.kind === 'create_membership' ||
      step.kind === 'promote_membership',
  );

  return ok({
    userId,
    role,
    organization: {
      id: target?.id ?? null,
      name: target?.name ?? name,
      slug: target?.slug ?? slug,
      willBeCreated,
    },
    profileWillBeCreated,
    membershipWillBeCreated,
    membershipRoleChange,
    alreadyAuthorized: !requiresWrite,
    requiresWrite,
    steps,
    notes,
  });
}
