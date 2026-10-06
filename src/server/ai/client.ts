/**
 * AI layer client (PDF #02 §7 AI Layer Architecture, CEO spec §4).
 *
 * Uses the Vercel AI SDK. When no provider key is configured the layer reports
 * itself unavailable and callers fall back to deterministic behaviour. It never
 * emulates a model response.
 */

import { serverEnv } from '@/lib/env';

export function isAiEnabled(): boolean {
  return serverEnv().aiEnabled;
}

export interface AiJsonRequest {
  system: string;
  prompt: string;
  schema: unknown;
  maxTokens?: number;
}

export type AiJsonResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; reason: 'disabled' | 'error'; message: string };

/**
 * Structured generation. Returns `disabled` when no provider key exists, so the
 * caller can record `aiEnabled: false` on the task rather than pretending.
 */
export async function generateStructured<T>(request: AiJsonRequest): Promise<AiJsonResult<T>> {
  const env = serverEnv();
  if (!env.aiEnabled) {
    return {
      ok: false,
      reason: 'disabled',
      message: 'No AI provider key is configured (OPENAI_API_KEY).',
    };
  }

  try {
    const { generateObject } = await import('ai');
    const { createOpenAI } = await import('@ai-sdk/openai');

    const openai = createOpenAI({ apiKey: env.openAiApiKey as string });
    const model = openai(env.aiModel);

    const { object } = await generateObject({
      model,
      system: request.system,
      prompt: request.prompt,
      schema: request.schema as never,
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    });

    return { ok: true, data: object as T, model: env.aiModel };
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'AI generation failed.',
    };
  }
}
