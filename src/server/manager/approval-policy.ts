/**
 * Approval Manager policy engine (PDF #08 §8, CEO spec §9).
 *
 *   AI PLANS ACTION -> RISK CHECK -> NO APPROVAL NEEDED -> EXECUTE
 *                                 -> APPROVAL NEEDED    -> SHOW PLAN -> USER APPROVES -> EXECUTE
 *
 * Rules:
 *  - Approval must be explicit.
 *  - Rejected actions are not executed.
 *  - Expired approvals cannot be reused.
 *  - Internal preparation (research, drafting, analysis) never requires approval.
 */

import policy from '@/config/approval-policy.json';
import type { RiskLevel } from '@/types/manager';

interface ApprovalPolicyConfig {
  defaultTtlMinutes: number;
  riskByAction: Record<string, RiskLevel>;
  requireApproval: Array<{
    id: string;
    action: string;
    reason: string;
    appliesTo: string[];
  }>;
  neverRequireApprovalFor: string[];
}

const config = policy as unknown as ApprovalPolicyConfig;

export const APPROVAL_TTL_MINUTES = config.defaultTtlMinutes;

/** Tools that always stop for approval, regardless of declared risk. */
const APPROVAL_REQUIRED_TOOLS: ReadonlyMap<string, { id: string; reason: string }> = new Map(
  config.requireApproval.flatMap((rule) =>
    rule.appliesTo.map((tool) => [tool, { id: rule.id, reason: rule.reason }] as const),
  ),
);

export function riskForAction(action: string): RiskLevel {
  return config.riskByAction[action] ?? 'low';
}

export interface ApprovalDecision {
  required: boolean;
  risk: RiskLevel;
  reason: string;
  ruleId: string | null;
  expiresAt: string;
}

/**
 * Decides whether a planned action must stop for human approval.
 *
 * `declaredRisk` comes from the tool definition; the policy can only raise it,
 * never lower it — a tool cannot quietly mark itself safe.
 */
export function evaluateApproval(
  toolName: string,
  declaredRisk: RiskLevel,
  action: string,
  now: Date = new Date(),
): ApprovalDecision {
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MINUTES * 60_000).toISOString();
  const policyRisk = riskForAction(action);
  const risk = maxRisk(declaredRisk, policyRisk);

  const rule = APPROVAL_REQUIRED_TOOLS.get(toolName);
  if (rule) {
    return { required: true, risk: 'high', reason: rule.reason, ruleId: rule.id, expiresAt };
  }

  if (risk === 'high') {
    return {
      required: true,
      risk,
      reason: 'High-impact actions require explicit approval (CEO spec §9).',
      ruleId: null,
      expiresAt,
    };
  }

  return {
    required: false,
    risk,
    reason: 'Internal preparation or low-risk action; no approval required.',
    ruleId: null,
    expiresAt,
  };
}

export function isExpired(isoDate: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return true;
  return parsed <= now.getTime();
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}
