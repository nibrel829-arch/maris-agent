import { withApiContext, parseBody } from '@/server/api/handler';
import { sendInboxReply } from '@/server/inbox/service';
import { replyIdempotencyKeySchema, replySchema } from '@/server/inbox/validation';
import { inboxFailure, invalidInboxInput } from '../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

export const POST = withApiContext(async ({ actor, repo }, request, extra) => {
  const { conversationId } = await (extra as RouteParams).params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return invalidInboxInput('Conversation id must be a valid UUID.');
  }
  const parsedKey = replyIdempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
  if (!parsedKey.success) {
    return invalidInboxInput('A valid Idempotency-Key header is required for replies.');
  }
  const body = await parseBody(request, replySchema);
  if (!body.ok) return invalidInboxInput(body.message);
  const result = await sendInboxReply(actor, repo, conversationId, body.data.body, parsedKey.data);
  if (!result.ok) return inboxFailure(result.error);
  return { ok: true as const, data: result.data };
});
