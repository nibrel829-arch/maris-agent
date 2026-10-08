/**
 * Strip provider secrets from messages before they reach logs, traces or the UI.
 * Keys are read only to remove them; they are never returned.
 */

import { serverEnv } from '@/lib/env';

export function redactSecrets(value: string): string {
  let out = value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/X-Subscription-Token:\s*\S+/gi, 'X-Subscription-Token: [redacted]');

  const env = serverEnv();
  for (const secret of [env.openAiApiKey, env.deepseekApiKey, env.braveSearchApiKey, env.supabaseServiceRoleKey]) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  }
  return out;
}
