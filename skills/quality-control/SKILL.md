---
name: quality-control
description: >-
  Quality rubric enforcement. Use this skill (invoked automatically by the
  orchestrator after every execution stage) to verify Manager output against
  the documented quality rules: evidence presence, claim labelling,
  uncertainty surfacing, medical/dental safety, action honesty, and
  deliverable completeness. Blocking findings prevent delivery; warnings are
  surfaced on the result.
tools:
  - run_quality_check
  - log_activity
  - create_notification
work_types:
  - quality_control
  - business_operations
outputs:
  - quality_report
max_risk: low
version: "1.0"
references:
  - references/quality-checklist.md
---

# Quality Control

Applies the quality rubric to Manager output. This skill is invoked
automatically by the orchestrator at the QUALITY CONTROL stage; users may also
invoke it directly to re-check a deliverable.

## When to use

- After every execution run by the orchestrator (automatic).
- Explicitly: "Check this output for quality/safety/compliance".

## Checks (from the rubric)

1. **evidence-present** — every factual claim has a source or is marked
   unverified. (blocking)
2. **no-fabricated-numbers** — no unsourced statistics, prices, market sizes or
   business results. (blocking)
3. **uncertainty-surfaced** — substantive output mentions uncertainty,
   assumptions or gaps. (warning)
4. **medical-safety** — dental/medical output carries no diagnostic or
   prescriptive language, includes the required disclaimer, and flags
   `medical_review_required`. (blocking on violations)
5. **action-honesty** — drafts do not claim an external action (sent,
   published) happened unless a provider result confirms it. (blocking)

## Scoring

- score = 100 − (errors × 30) − (warnings × 10), floor 0.
- `blocking = true` if any `error`-severity finding matches a blocking rule id.
- A blocking finding sets the task state to FAILED in the orchestrator.

## References

- Quality rubric: `src/knowledge/quality-rubric.json`
- Claim policy: `src/knowledge/claim-policy.json`
- Medical safety: `src/knowledge/medical-safety.json`
- Checklist: `references/quality-checklist.md`
