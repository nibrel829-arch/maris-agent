---
name: product-development
description: >-
  Structured product concept development. Use this skill when the request asks
  to design, outline, scope or conceptualise a new product, feature, offer or
  package. It walks the documented reasoning chain from target customer through
  quality control, records missing elements as open questions (never inventing
  them), and produces a product concept.
tools:
  - create_product_concept
  - list_product_concepts
  - create_research_brief
  - log_activity
work_types:
  - product_development
  - strategy
outputs:
  - product_concept
max_risk: low
version: "1.0"
---

# Product Development

Turns a product request into a structured concept by walking the reasoning
chain defined in the CEO/Manager V2 spec.

## When to use

- "Design a product for…", "Create an offer around…", "Outline a feature that…"
- Scoping or conceptualising a new offering, package, workflow or tool
- Turning a vague idea into a structured concept with open questions

## When NOT to use

- Pure research about an existing market without a new concept → `research-intelligence`
- Marketing copy or campaign assets for an existing product → `content-marketing`
- Visual layout or asset specification → `visual-content`

## Reasoning chain

Each concept walks these elements; any element that cannot be determined from
the request or from recorded evidence is stored as an open question, not
invented:

1. target_customer
2. customer_problem
3. demand
4. existing_alternatives
5. missing_opportunity
6. product_concept
7. product_scope
8. components
9. versions
10. file_types
11. usage
12. differentiation
13. pricing_considerations
14. marketing
15. sales
16. quality_control

## Hard rules

- Never invent demand signals, competitors, prices or customer names.
- Open questions are first-class outputs — they drive follow-up research.
- Demand without a recorded source is recorded as an open question.
- The chain always ends with quality_control so QC is applied to concept output.

## References

- Reasoning chain and defaults: `src/knowledge/product-development-framework.json`
- Claim policy: `src/knowledge/claim-policy.json`
- Brand voice: `src/knowledge/brand-voice.json`
