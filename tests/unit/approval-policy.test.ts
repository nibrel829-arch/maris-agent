import { describe, expect, it } from 'vitest';
import { evaluateApproval, isExpired, maxRisk } from '@/server/manager/approval-policy';

describe('Approval engine (PDF #08 §8, CEO spec §9)', () => {
  it('requires approval for external email sending', () => {
    const decision = evaluateApproval('send_email', 'high', 'send');
    expect(decision.required).toBe(true);
    expect(decision.risk).toBe('high');
  });

  it('requires approval for publishing', () => {
    expect(evaluateApproval('publish_post', 'high', 'publish').required).toBe(true);
    expect(evaluateApproval('schedule_post', 'high', 'publish').required).toBe(true);
  });

  it('requires approval for deletion', () => {
    expect(evaluateApproval('delete_client', 'high', 'delete').required).toBe(true);
  });

  it('does not require approval for internal preparation', () => {
    expect(evaluateApproval('create_research_brief', 'low', 'create').required).toBe(false);
    expect(evaluateApproval('prepare_email', 'low', 'create').required).toBe(false);
    expect(evaluateApproval('create_product_concept', 'low', 'create').required).toBe(false);
  });

  it('cannot lower a declared risk — a tool cannot mark itself safe', () => {
    expect(evaluateApproval('create_client', 'high', 'create').risk).toBe('high');
  });

  it('raises risk to the policy level when the policy is stricter', () => {
    expect(evaluateApproval('update_client', 'low', 'delete').risk).toBe('high');
    expect(evaluateApproval('update_client', 'low', 'delete').required).toBe(true);
  });

  it('sets an expiry so approvals cannot be reused indefinitely', () => {
    const decision = evaluateApproval('send_email', 'high', 'send');
    expect(isExpired(decision.expiresAt)).toBe(false);
    expect(isExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true);
  });

  it('treats an unparseable date as expired', () => {
    expect(isExpired('not-a-date')).toBe(true);
  });

  it('selects the maximum of two risk levels', () => {
    expect(maxRisk('low', 'high')).toBe('high');
    expect(maxRisk('high', 'low')).toBe('high');
    expect(maxRisk('medium', 'low')).toBe('medium');
  });
});
