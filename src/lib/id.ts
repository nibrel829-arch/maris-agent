import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

/**
 * Stable idempotency key. Retries reuse the same key so external actions are
 * never duplicated (PDF #09 §16, PDF #10 §15, PDF #06 §11).
 */
export const idempotencyKey = (parts: string[]): string =>
  `idem_${parts.join(':')}`;
