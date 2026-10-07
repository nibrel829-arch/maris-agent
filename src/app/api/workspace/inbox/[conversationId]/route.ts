import { parseBody, withApiContext } from '@/server/api/handler';
import { getInboxConversation, updateInboxConversation } from '@/server/inbox/service';
import { inboxMessageQuerySchema, updateConversationSchema } from '@/server/inbox/validation';
import { inboxFailure, invalidInboxInput } from '../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

async function getId(extra: unknown): Promise<string | null> {
  const { conversationId } = await (extra as RouteParams).params;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)
    ? conversationId
    : null;
}

export const GET = withApiContext(async ({ actor, repo }, request, extra) => {
  const conversationId = await getId(extra);
  if (!conversationId) return invalidInboxInput('Conversation id must be a valid UUID.');
  const url = new URL(request.url);
  const parsed = inboxMessageQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    before: url.searchParams.get('before') ?? undefined,
  });
  if (!parsed.success) return invalidInboxInput(parsed.error.issues.map((issue) => issue.message).join('; '));
  const result = await getInboxConversation(actor, repo, conversationId, parsed.data);
  if (!result.ok) return inboxFailure(result.error);
  return { ok: true as const, data: result.data };
});

export const PATCH = withApiContext(async ({ actor, repo }, request, extra) => {
  const conversationId = await getId(extra);
  if (!conversationId) return invalidInboxInput('Conversation id must be a valid UUID.');
  const body = await parseBody(request, updateConversationSchema);
  if (!body.ok) return invalidInboxInput(body.message);
  const result = await updateInboxConversation(actor, repo, conversationId, body.data);
  if (!result.ok) return inboxFailure(result.error);
  return { ok: true as const, data: result.data };
});
