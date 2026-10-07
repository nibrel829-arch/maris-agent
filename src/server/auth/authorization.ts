/**
 * Authorization resolution (PDF #06 §5, PDF #11 §4, PDF #12 §15).
 *
 *   SUPABASE AUTH USER -> PROFILE -> ORGANIZATION -> MEMBERSHIP -> ROLE
 *
 * This module holds the *pure* half of that chain: rows already read from the
 * database are turned into an `ActorContext`, or into an explicit, honest
 * failure. Keeping it free of `next/headers` and of the Supabase client means
 * the exact production decision can be unit tested and replayed by the
 * provisioning CLI (`scripts/provision-owner.ts`) against the live project.
 *
 * The database is still the security boundary: every row this function sees
 * was already filtered by RLS policies in `0004_rls_policies.sql` /
 * `0005_rls_hardening.sql`, or read by the service role for diagnosis only.
 */

import { fail, ok, type ServiceResult } from '@/lib/result';
import type { ActorContext, OrgRole, UUID } from '@/types/domain';
import { isOrgRole } from './permissions';

/** The authenticated Supabase Auth user (subset of `auth.users`). */
export interface AuthUserRecord {
  id: UUID;
  email: string | null;
}

/** A `public.memberships` row for the authenticated user. */
export interface MembershipRecord {
  organization_id: UUID;
  role: string;
}

/** A `public.profiles` row keyed by `auth.users.id`. */
export interface ProfileRecord {
  full_name: string | null;
}

/**
 * Exact user-facing wording for a signed-in user without a membership. The
 * workspace layout and the login flow surface it verbatim, so it must not
 * change without updating the operator runbook (`docs/SUPABASE_VERIFICATION.md`).
 */
export const NO_ORGANIZATION_MESSAGE =
  'Your account is not a member of any organization. Ask an owner or admin to invite you.';

/**
 * The membership list could not be read at all (table missing, permission
 * error, network). This is deliberately distinct from an empty membership
 * list: reporting a database failure as "you are not a member" hides a real
 * configuration problem such as unapplied migrations.
 */
export const MEMBERSHIP_LOOKUP_FAILED_MESSAGE =
  'Your organization membership could not be read. If this keeps happening, the database migrations may not be applied to this project.';

export const UNAUTHENTICATED_MESSAGE = 'Your session has expired. Please sign in again.';

/**
 * Resolves the acting identity from rows already read for the signed-in user.
 *
 * A missing membership row is a permission outcome (`NO_ORGANIZATION`), never a
 * fabricated success — the platform intentionally does not auto-assign new
 * users to an organization (PDF #12 §7, `docs/SUPABASE_VERIFICATION.md`).
 */
export function resolveActorFromRecords(input: {
  user: AuthUserRecord;
  membership: MembershipRecord | null | undefined;
  profile?: ProfileRecord | null;
  isDevIdentity?: boolean;
}): ServiceResult<ActorContext> {
  const { user, membership } = input;

  if (!membership) {
    return fail('NO_ORGANIZATION', NO_ORGANIZATION_MESSAGE, {
      severity: 'warning',
      retryable: false,
      errorClass: 'permission',
    });
  }

  // An unrecognized role value can only come from a schema change; fall back to
  // the least-privileged role rather than trusting the raw database value.
  const role: OrgRole = isOrgRole(membership.role) ? membership.role : 'member';

  return ok({
    userId: user.id,
    organizationId: String(membership.organization_id),
    role,
    email: user.email ?? null,
    fullName: input.profile?.full_name ?? null,
    isDevIdentity: input.isDevIdentity ?? false,
  });
}

/** Role used by the owner-bootstrap path (`scripts/provision-owner.ts`). */
export type ElevatedRole = Extract<OrgRole, 'owner' | 'admin'>;

export function isElevatedRole(value: unknown): value is ElevatedRole {
  return value === 'owner' || value === 'admin';
}

/**
 * Describes the authorization chain as ordered, non-secret facts. Used by the
 * provisioning CLI report and by operator diagnostics; it never touches the
 * network.
 */
export interface AuthorizationChain {
  authenticated: boolean;
  hasProfile: boolean;
  organizationName: string | null;
  organizationSlug: string | null;
  hasMembership: boolean;
  role: OrgRole | null;
  elevated: boolean;
}

export function describeAuthorizationChain(input: {
  user: AuthUserRecord | null;
  membership: MembershipRecord | null;
  profile: ProfileRecord | null;
  organization: { name: string; slug: string } | null;
}): AuthorizationChain {
  const hasMembership = Boolean(input.user && input.membership);
  const role = hasMembership && isOrgRole(input.membership?.role) ? input.membership.role : null;

  return {
    authenticated: Boolean(input.user),
    hasProfile: Boolean(input.profile),
    organizationName: input.organization?.name ?? null,
    organizationSlug: input.organization?.slug ?? null,
    hasMembership,
    role,
    elevated: role === 'owner' || role === 'admin',
  };
}
