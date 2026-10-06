import type { z } from 'zod';
import type { RiskLevel } from '@/types/domain';
import type { ToolContext, ToolDefinition, ToolPermission } from '@/types/manager';

interface ToolSpec<S extends z.ZodTypeAny, TOutput> {
  name: string;
  description: string;
  permission: ToolPermission;
  risk: RiskLevel;
  inputSchema: S;
  /** True for external, irreversible or paid actions. */
  external?: boolean;
  execute: (input: z.output<S>, ctx: ToolContext) => Promise<TOutput>;
}

/**
 * Tool factory (PDF #08 §5).
 *
 * Every capability the Manager can invoke is a registered tool with an explicit
 * name, description, input schema, permission requirement and risk level.
 * Unknown tools are rejected by the execution engine.
 */
export function defineTool<S extends z.ZodTypeAny, TOutput>(
  spec: ToolSpec<S, TOutput>,
): ToolDefinition<z.output<S>, TOutput> {
  return {
    name: spec.name,
    description: spec.description,
    permission: spec.permission,
    risk: spec.risk,
    inputSchema: spec.inputSchema as unknown as ToolDefinition<z.output<S>, TOutput>['inputSchema'],
    external: spec.external ?? false,
    execute: spec.execute as ToolDefinition<z.output<S>, TOutput>['execute'],
  };
}
