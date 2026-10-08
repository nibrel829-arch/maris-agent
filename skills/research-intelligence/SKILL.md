---
name: research-intelligence
description: >-
  Structured research and evidence gathering. Use this skill when the request
  asks for market research, competitor analysis, background investigation,
  evidence gathering, or any output that must separate FACT, EVIDENCE,
  INTERPRETATION and RECOMMENDATION. Never use it for dental or clinical topics
  (use dental-research instead, which adds medical safety controls).
tools:
  - create_research_brief
  - add_research_evidence
  - conduct_sourced_research
  - list_research_briefs
  - log_activity
work_types:
  - research
  - strategy
  - market
  - decision_making
outputs:
  - research_brief
max_risk: low
version: "1.0"
references:
  - references/truth-rules.md
---

# Research Intelligence

Structures a research question, defines evidence requirements, records sourced
findings, surfaces uncertainty, and labels every claim.

## When to use

- "Research X", "Look into Y", "What do we know about Z"
- Competitor or market landscape questions
- Evidence-gathering for a product, campaign, or decision
- Any output where claims must be cited or explicitly marked as gaps

## When NOT to use

- Dental, oral-health, clinical or medical topics → use `dental-research`.
- Product ideation chains → use `product-development`.
- Internal reporting on recorded workspace data → use `business-reporting`.

## Hard rules

- Every FACT requires an identified source.
- A claim with no source is downgraded to INTERPRETATION with low confidence.
- Numeric claims (prices, market sizes, statistics) without a nearby source are
  a BLOCKING quality finding.
- Never fabricate sources, statistics, companies, testimonials or market demand.
- Gaps, open questions and uncertainty must be surfaced in every artifact.

## Claim labels

| Label | Meaning |
|---|---|
| FACT | Verifiable, backed by an identified source the system retrieved |
| EVIDENCE | Recorded data point with source and confidence |
| INTERPRETATION | Manager's reading of facts (must be labelled) |
| RECOMMENDATION | Proposed action (must be labelled) |

## References

- Research standard: `src/knowledge/research-standards.json`
- Claim policy: `src/knowledge/claim-policy.json`
- Brand voice: `src/knowledge/brand-voice.json`
- Truth and fabrication rules: `references/truth-rules.md`
