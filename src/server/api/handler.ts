/**
 * Shared API plumbing (PDF #06 §4, PDF #12 §16).
 *
 * REQUEST -> AUTHENTICATE -> AUTHORIZE -> VALIDATE INPUT -> BUSINESS SERVICE
 *          -> DATABASE / EXTERNAL API -> NORMALIZE RESULT -> LOG -> RESPONSE
 */

import { NextResponse } from 'next/server';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import type { NibrexoRepository } from '@/server/db/types';
import type { ActorContext } from '@/types/domain';
import type { ManagerIssue } from '@/types/manager';
import type { z } from 'zod';

export interface ApiContext {
  actor: ActorContext;
  repo: NibrexoRepository;
}

export type ApiResult<T> =
  | { ok: true; data: T; status?: number }
  | { ok: false; error: ManagerIssue; status: number };

const STATUS_BY_CLASS: Record<ManagerIssue['errorClass'], number> = {
  validation: 400,
  permission: 403,
  auth: 401,
  not_configured: 503,
  unsupported: 422,
  rate_limit: 429,
  network: 502,
  server: 500,
  unknown: 500,
};

export function errorResponse(issue: ManagerIssue): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: issue.code, message: issue.message, retryable: issue.retryable } },
    { status: STATUS_BY_CLASS[issue.errorClass] ?? 500 },
  );
}

export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

/**
 * Wraps a route handler with authentication and repository resolution.
 * Authorization for the specific action remains the service's responsibility.
 */
/**
 * `Extra` carries App Router route params, which Next passes after the request.
 */
export type ApiHandler<T, Extra = unknown> = (
  context: ApiContext,
  request: Request,
  extra: Extra,
) => Promise<ApiResult<T>>;

export function withApiContext<T, Extra = unknown>(handler: ApiHandler<T, Extra>) {
  return async (request: Request, extra: Extra): Promise<NextResponse> => {
    const actorResult = await resolveActor();
    if (!actorResult.ok) return errorResponse(actorResult.error);

    const repoResult = await getRequestRepository();
    if (!repoResult.ok) return errorResponse(repoResult.error);

    try {
      const result = await handler({ actor: actorResult.data, repo: repoResult.data }, request, extra);
      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: result.error.code,
              message: result.error.message,
              retryable: result.error.retryable,
            },
          },
          { status: result.status ?? (STATUS_BY_CLASS[result.error.errorClass] ?? 500) },
        );
      }
      return successResponse(result.data, result.status ?? 200);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred.',
            retryable: false,
          },
        },
        { status: 500 },
      );
    }
  };
}

/** Parses and validates a JSON body against a Zod schema. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; message: string }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, message: 'Request body must be valid JSON.' };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  return { ok: true, data: parsed.data };
}
