/**
 * Authentication boundary (PDF #06 §5, PDF #11 §4).
 *
 *   USER LOGIN -> SUPABASE AUTH -> SESSION TOKEN -> BACKEND VERIFY
 *   -> LOAD USER ROLE -> ALLOW ACCESS
 *
 * Authentication is not authorization: resolving an ActorContext establishes
 * identity and organization membership only. Permission decisions are made
 * separately by the permission guard.
 */

import { cookies } from 'next/headers';
import { serverEnv } from '@/lib/env';
import { fail, ok, type ServiceResult } from '@/lib/result';
import type { ActorContext, Membership, OrgRole, Profile, UUID } from '@/types/domain';
import { createSupabaseServerClient } from '@/server/db/supabase';
import {
  MEMBERSHIP_LOOKUP_FAILED_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
  resolveActorFromRecords,
} from './authorization';

const DEV_USER_ID = '00000000-0000-0000-0000-0000000000d0';

/**
 * Resolves the acting identity from the Supabase session.
 *
 * When Supabase is unavailable, an explicit, non-production escape hatch
 * (`NIBREXO_DEV_AUTH=1`) provides a local identity so the application can be
 * exercised end to end. It is refused in production, and every dev identity is
 * flagged with `isDevIdentity: true` so it is visible downstream.
 */
export async function resolveActor(): Promise<ServiceResult<ActorContext>> {
  const env = serverEnv();

  const client = await createSupabaseServerClient();

  if (!client) {
    if (!env.devAuthEnabled) {
      return fail(
        'AUTH_NOT_CONFIGURED',
        'Supabase Auth is not configured and the development identity is disabled. Set Supabase environment variables, or NIBREXO_DEV_AUTH=1 outside production.',
        { severity: 'warning', retryable: false, errorClass: 'not_configured' },
      );
    }

    return ok({
      userId: DEV_USER_ID,
      organizationId: env.devOrgId,
      role: 'owner' as OrgRole,
      email: 'dev@nibrexo.local',
      fullName: 'Development User',
      isDevIdentity: true,
    });
  }

  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user) {
    return fail('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE, {
      severity: 'warning',
      retryable: false,
      errorClass: 'auth',
    });
  }

  const { data: membershipRow, error: membershipError } = await client
    .from('memberships')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // A read failure is not the same as "not a member": an unapplied migration or
  // a permission error must never be reported as a missing invitation.
  if (membershipError) {
    return fail('MEMBERSHIP_LOOKUP_FAILED', MEMBERSHIP_LOOKUP_FAILED_MESSAGE, {
      severity: 'error',
      retryable: true,
      errorClass: 'server',
    });
  }

  // The profile is presentation data only; a missing row never blocks access.
  const { data: profile } = await client
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  return resolveActorFromRecords({
    user: { id: user.id, email: user.email ?? null },
    membership: membershipRow,
    profile: profile as Pick<Profile, 'full_name'> | null,
    isDevIdentity: false,
  });
}

/**
 * Resolves an actor from an explicit bearer token. Used by job runners and
 * webhook handlers where no cookie session exists.
 */
export async function resolveActorFromToken(token: string): Promise<ServiceResult<ActorContext>> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return fail('AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured.', {
      errorClass: 'not_configured',
      severity: 'warning',
    });
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return fail('UNAUTHENTICATED', 'Invalid or expired token.', {
      errorClass: 'auth',
      severity: 'warning',
    });
  }

  const { data: membershipRow, error: membershipError } = await client
    .from('memberships')
    .select('organization_id, role')
    .eq('user_id', data.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return fail('MEMBERSHIP_LOOKUP_FAILED', MEMBERSHIP_LOOKUP_FAILED_MESSAGE, {
      severity: 'error',
      retryable: true,
      errorClass: 'server',
    });
  }

  return resolveActorFromRecords({
    user: { id: data.user.id, email: data.user.email ?? null },
    membership: membershipRow,
    profile: null,
    isDevIdentity: false,
  });
}

export async function currentOrganizationCookie(): Promise<UUID | null> {
  const store = await cookies();
  return store.get('nibrexo_org')?.value ?? null;
}

export type { Membership };
