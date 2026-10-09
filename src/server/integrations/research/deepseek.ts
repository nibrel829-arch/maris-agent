/**
 * DeepSeek chat completions — server-side only.
 *
 * Official API, verified 2026-10-08 against https://api-docs.deepseek.com/ :
 *   POST https://api.deepseek.com/chat/completions
 *   Authorization: Bearer $DEEPSEEK_API_KEY
 *   Models: deepseek-flash (default), deepseek-v4-pro
 *
 * DeepSeek does not browse the web. Callers must supply retrieved sources.
 * This client never turns unsourced model text into facts.
 */

import { serverEnv } from '@/lib/env';
import { redactSecrets } from '@/server/integrations/redact';

export const DEEPSEEK_CHAT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type DeepSeekResult =
  | { status: 'ok'; content: string; model: string }
  | { status: 'needs_configuration'; missing: string[]; message: string }
  | { status: 'error'; message: string; retryable: boolean };

export async function deepseekChat(input: {
  messages: DeepSeekMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
}): Promise<DeepSeekResult> {
  const env = serverEnv();
  if (!env.allowPaidSynthesis || !env.deepseekApiKey) {
    return {
      status: 'needs_configuration',
      missing: env.allowPaidSynthesis ? ['DEEPSEEK_API_KEY'] : ['NIBREXO_ALLOW_PAID_SYNTHESIS'],
      message:
        'DeepSeek synthesis is disabled. It is a paid chat API and is not a source-retrieval engine. Set NIBREXO_ALLOW_PAID_SYNTHESIS=1 and DEEPSEEK_API_KEY only if you accept token charges. No model text was generated.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(DEEPSEEK_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: env.deepseekModel,
        messages: input.messages,
        temperature: 0.2,
        max_tokens: input.maxTokens ?? 1200,
        stream: false,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        status: 'error',
        retryable: response.status === 429 || response.status >= 500,
        message: `DeepSeek returned HTTP ${response.status}. ${redactSecrets(raw).slice(0, 240)}`.trim(),
      };
    }
    const parsed = JSON.parse(raw) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = parsed.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      return {
        status: 'error',
        retryable: true,
        message: 'DeepSeek returned an empty completion. No findings were invented from it.',
      };
    }
    return { status: 'ok', content, model: parsed.model || env.deepseekModel };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'error',
      retryable: true,
      message: aborted
        ? 'DeepSeek timed out or was cancelled. It can be retried.'
        : `DeepSeek request failed: ${redactSecrets(error instanceof Error ? error.message : 'network error')}`,
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}
