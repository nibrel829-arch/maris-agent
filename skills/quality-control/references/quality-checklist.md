# Quality Control Checklist

Source: `src/knowledge/quality-rubric.json`; enforced by `run_quality_check` in
`src/server/tools/operations.ts` and invoked by the orchestrator after every
execution run.

## Blocking (delivery-preventing)

- [ ] Every factual claim in the output has an identified source, OR is
      explicitly labelled INTERPRETATION / RECOMMENDATION with confidence.
- [ ] No statistics, prices, market sizes, percentages or business results
      appear without a source near them in the text.
- [ ] No diagnostic or prescriptive language in dental/medical output
      ("you have", "take this", "this will cure", "dosage", "prescribe").
- [ ] Drafts and prepared actions never say "has been sent", "was sent",
      "has been published" or "published successfully" unless a provider
      result is recorded.
- [ ] Medical-domain output carries the standard disclaimer and flags
      `medical_review_required`.

## Warnings (surfaced, not blocking)

- [ ] Substantive output (>~800 characters) includes an explicit uncertainty,
      assumptions or gaps section.
- [ ] Recommendations are labelled as recommendations, not facts.
- [ ] Approved actions are distinguished from prepared actions.

## After the run

- `findings[]` lists every rule hit with `severity`, `detail` and `remediation`.
- `score` is 0–100.
- `blocking` indicates whether the orchestrator must halt delivery.
- A `quality_reports` row is persisted for audit.
