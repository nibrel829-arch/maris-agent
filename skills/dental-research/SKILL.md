---
name: dental-research
description: >-
  Dental and clinical-adjacent research under additional medical safety
  controls. Use this skill when the request is about dentistry, oral health,
  clinical workflows, dental products/devices, or any topic where the output
  could be interpreted as medical or clinical advice. It applies all
  research-intelligence truth rules plus dental safety: no diagnosis, no
  prescription, mandatory disclaimer, and a medical-review flag.
tools:
  - create_research_brief
  - add_research_evidence
  - run_medical_safety_check
  - list_research_briefs
work_types:
  - dental_research
  - research
outputs:
  - research_brief
max_risk: medium
version: "1.0"
references:
  - references/dental-safety.md
---

# Dental Research

Research skill for dental and clinical-adjacent topics. Runs the full research
structure (question → scope → method → evidence → gaps → uncertainty →
interpretation → recommendation) and then applies dental-specific safety
controls before delivery.

## When to use

- Questions about dentistry, oral hygiene, tooth/gum conditions
- Dental product, device or workflow research
- Clinical-adjacent topics touching patients or treatment
- Any research flagged as `domain: dental` by the classifier

## When NOT to use

- Non-clinical business questions even if they mention dentistry (e.g. "market
  size for dental practices" is market research; the classifier may still
  trigger medical safety checks at the content level).
- Pure commercial content about Nibrexo itself → use `content-marketing`.

## Hard rules

- The agent **never diagnoses** a condition and **never prescribes** treatment,
  medication, dosage or a cure.
- Restricted language patterns are screened by `run_medical_safety_check` and
  block delivery if found (e.g. "you have", "this is a symptom of",
  "take this medication", "guaranteed to heal").
- Every dental artifact carries `medical_review_required: true`.
- The mandatory medical disclaimer must accompany external output.
- All general truth rules (claim labels, sources, uncertainty) still apply.

## References

- Medical safety patterns and disclaimer: `src/knowledge/medical-safety.json`
- Research standards: `src/knowledge/research-standards.json`
- Claim policy: `src/knowledge/claim-policy.json`
- Safety rules detail: `references/dental-safety.md`
