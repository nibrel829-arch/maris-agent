---
name: manager-orchestration
description: >-
  Central coordination capability of the NIBREXO CEO / Manager. Use this skill
  when the request requires understanding a user objective end-to-end,
  classifying the work, planning steps, selecting other skills, running
  verification and quality control, delivering a result, or deciding the next
  best action. This skill IS the Manager itself; it is not a separate agent
  and does not initiate work outside the Manager pipeline.
tools:
  - get_settings
  - log_activity
  - create_notification
  - record_memory
  - recall_memory
  - create_decision_memo
work_types:
  - strategy
  - decision_making
  - business_operations
  - general_orchestration
  - memory_continuity
outputs:
  - decision_memo
  - business_report
  - direct_answer
max_risk: medium
version: "1.0"
references:
  - docs/CEO_MANAGER_AGENT_V2_SPEC.md
  - docs/ARCHITECTURE.md
---

# Manager Orchestration

Owns the Manager reasoning pipeline:

1. UNDERSTAND — parse objective, entities and gaps
2. CLASSIFY — identify work type and primary skill
3. PLAN — build a step plan across required skills
4. SELECT SKILLS — pick capabilities the plan needs
5. EXECUTE — run plan steps through the execution engine
6. VERIFY — confirm results are real and substantive
7. QUALITY CONTROL — apply the quality rubric
8. DELIVER — surface artifacts and claims
9. NEXT BEST ACTION — recommend follow-up

## When to use

Use for every user request: this skill is always active for the Manager. It
coordinates the other skills; it never becomes a standalone agent and never
bypasses approvals.

## Key rules

- Skills are capabilities, not autonomous agents.
- No tool self-initiates; only `runManagerTask` / `resumeManagerTask` start work.
- External, irreversible or high-impact actions stop for explicit approval.
- Memory is scoped to the organization; sensitive data is never stored unrestricted.

## References

- Brand voice: `src/knowledge/brand-voice.json`
- Quality rubric: `src/knowledge/quality-rubric.json`
- Pipeline, skill table and autonomy rules: `docs/CEO_MANAGER_AGENT_V2_SPEC.md`
- Layer diagram and decision log: `docs/ARCHITECTURE.md`
