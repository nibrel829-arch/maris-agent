/**
 * Repository factory.
 *
 * Selection rules:
 *  1. `NIBREXO_DATA_BACKEND=memory` and NODE_ENV != production -> memory store.
 *  2. Otherwise Supabase, bound to the caller's session so RLS applies.
 *  3. If Supabase is not configured, return a structured NOT_CONFIGURED issue.
 *     Nothing in this codebase fabricates a database success (CEO spec §11).
 */

import { serverEnv } from '@/lib/env';
import { classifyError, fail, ok, type ServiceResult } from '@/lib/result';
import { createMemoryRepository } from './memory-repository';
import { createSupabaseRepository } from './supabase-repository';
import { createSupabaseAdminClient, createSupabaseServerClient } from './supabase';
import type { NibrexoRepository } from './types';

/** Process-wide memory store so dev sessions share state across requests. */
const globalForMemory = globalThis as unknown as { __nibrexoMemoryRepo?: NibrexoRepository };

function memoryRepository(): NibrexoRepository {
  if (!globalForMemory.__nibrexoMemoryRepo) {
    globalForMemory.__nibrexoMemoryRepo = createMemoryRepository();
  }
  return globalForMemory.__nibrexoMemoryRepo;
}

/**
 * Repository bound to the current request's Supabase session (RLS enforced).
 * Used by every user-facing API route and server action.
 */
export async function getRequestRepository(): Promise<ServiceResult<NibrexoRepository>> {
  const env = serverEnv();

  if (env.dataBackend === 'memory') {
    return ok(memoryRepository());
  }

  try {
    const client = await createSupabaseServerClient();
    if (!client) {
      return fail(
        'SUPABASE_NOT_CONFIGURED',
        'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or set NIBREXO_DATA_BACKEND=memory for local development.',
        { severity: 'warning', retryable: false, errorClass: 'not_configured' },
      );
    }
    return ok(createSupabaseRepository(client));
  } catch (error) {
    return fail('DB_UNAVAILABLE', classifyError(error).message, {
      errorClass: 'server',
      severity: 'error',
      retryable: true,
    });
  }
}

/**
 * Repository using the service role key. Reserved for server-side job
 * execution (scheduled publishing, sequence workers) where no user session
 * exists. Never exposed to request handlers that a browser can trigger.
 */
export function getJobRepository(): ServiceResult<NibrexoRepository> {
  const env = serverEnv();
  if (env.dataBackend === 'memory') return ok(memoryRepository());

  const client = createSupabaseAdminClient();
  if (!client) {
    return fail(
      'SUPABASE_SERVICE_ROLE_NOT_CONFIGURED',
      'Server-side jobs require SUPABASE_SERVICE_ROLE_KEY. This is a server-only secret.',
      { severity: 'warning', retryable: false, errorClass: 'not_configured' },
    );
  }
  return ok(createSupabaseRepository(client));
}

export type { NibrexoRepository };
