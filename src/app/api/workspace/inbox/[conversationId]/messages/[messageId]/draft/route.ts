import { withApiContext, parseBody } from '@/server/api/handler';
import { saveReplyDraft } from '@/server/inbox/service';
import { draftSchema } from '@/server/inbox/validation';
import { inboxFailure, invalidInboxInput } from '@/app/api/workspace/inbox/_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ conversationId: string; messageId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PATCH = withApiContext(async ({ actor, repo }, request, extra) => {
  const { conversationId, messageId } = await (extra as RouteParams).params;
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(messageId)) {
    return invalidInboxInput('Conversation and message ids must be valid UUIDs.');
  }
  const body = await parseBody(request, draftSchema);
  if (!body.ok) return invalidInboxInput(body.message);
  const result = await saveReplyDraft(actor, repo, conversationId, messageId, body.data.draft);
  if (!result.ok) return inboxFailure(result.error);
  return { ok: true as const, data: result.data };
});
