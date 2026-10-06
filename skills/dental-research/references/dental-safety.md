# Dental / Medical Safety Rules

Source: CEO/Manager V2 spec §5; enforced by `run_medical_safety_check` in
`src/server/tools/research.ts` and `run_quality_check` in
`src/server/tools/operations.ts`.

## Principle

The agent is informational only. It does not diagnose, prescribe or recommend
treatment for any named person or described condition. Dental output is
educational and requires qualified professional review before external use.

## Prohibited patterns (non-exhaustive)

Diagnostic language:

- "you have", "you likely have", "this is a symptom of", "diagnos(is/ed/es)"

Prescriptive language:

- "take this medication", "prescribe", "dosage", "you should take",
  "stop taking"

Outcome guarantees:

- "this treatment will cure", "guaranteed to heal"

Any match sets `safe: false` and `blocksDelivery: true` until the wording is
corrected.

## Required disclaimer

> This information is general and educational only. It is not a diagnosis or
> medical advice. Consult a qualified dental or medical professional for advice
> about a specific condition.

Attached automatically when the text contains dental/clinical terms or when
`medicalDomain` is set on the quality check.

## Medical review flag

Dental and medical-domain artifacts set `medical_review_required: true` on the
research brief and emit a `medical-review-required` warning in quality control.
This is a visible reminder in the UI; it does not silently downgrade content.
