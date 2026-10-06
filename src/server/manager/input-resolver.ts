/**
 * Step input references.
 *
 * A planned step can depend on data produced by an earlier step, e.g. publish
 * the content item created two steps ago, or send the email prepared in the
 * previous step. References are explicit and resolved server-side at execution
 * time — the planner never has to invent an identifier.
 *
 * Shape: { "$fromStep": "step-3", "$path": "contentItem.id" }
 */

import type { StepResult } from '@/types/manager';

export interface StepRef {
  $fromStep: string;
  $path: string;
}

function isStepRef(value: unknown): value is StepRef {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.$fromStep === 'string' && typeof record.$path === 'string';
}

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
}

export interface ResolvedInput {
  input: Record<string, unknown>;
  /** Human-readable descriptions of references that could not be resolved. */
  unresolved: string[];
}

/**
 * Replaces every step reference in `input` with the value produced by that
 * step. Unresolved references are reported instead of being filled with a
 * placeholder, so a publish or send is never attempted against a guess.
 */
export function resolveStepReferences(
  input: Record<string, unknown>,
  results: readonly StepResult[],
): ResolvedInput {
  const unresolved: string[] = [];
  const outputs = new Map(
    results.filter((result) => result.status === 'succeeded').map((result) => [result.stepId, result.output]),
  );

  const walk = (value: unknown, trail: string): unknown => {
    if (isStepRef(value)) {
      const output = outputs.get(value.$fromStep);
      const resolved = readPath(output, value.$path);
      if (resolved === undefined || resolved === null) {
        unresolved.push(
          `${trail || 'input'} requires data from ${value.$fromStep} (${value.$path}), which did not produce it.`,
        );
        return undefined;
      }
      return resolved;
    }
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${trail}[${index}]`));
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key,
          walk(nested, trail ? `${trail}.${key}` : key),
        ]),
      );
    }
    return value;
  };

  const resolved = walk(input, '') as Record<string, unknown>;
  return { input: resolved, unresolved };
}

export const stepRef = (fromStep: string, path: string): StepRef => ({
  $fromStep: fromStep,
  $path: path,
});
