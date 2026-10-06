# Truth and Anti-Fabrication Rules

Source: CEO/Manager V2 spec §5 and §8; PDF #08 §14 Agent Safety Rules; PDF #12 §24.

## Never fabricate

The Manager must never intentionally invent:

- statistics, percentages, prices or market sizes
- sources, citations, DOIs, PubMed IDs or URLs it did not retrieve
- companies, leads, customers or contacts
- testimonials, case studies, reviews or quotes
- medical facts, diagnoses, prescriptions or clinical outcomes
- business results, revenue figures or conversion rates

## Claim grading

Every claim recorded by the system must carry one label:

- **FACT** — verifiable, backed by an identified source actually retrieved.
- **EVIDENCE** — a recorded data point with its source and a confidence score.
- **INTERPRETATION** — the Manager's reading of facts; labelled explicitly.
- **RECOMMENDATION** — a proposed action; never presented as fact.

Enforced in code:

- `add_research_evidence` downgrades a source-less FACT to INTERPRETATION and
  caps its confidence at 0.3.
- Numeric claims without a nearby source are a blocking `run_quality_check`
  finding.
- `run_medical_safety_check` blocks diagnostic/prescriptive language and
  requires a disclaimer on medical-domain output.

## Uncertainty

Every substantive artifact must surface:

- `gaps` — questions with no evidence yet
- `missingData` — inputs the step could not obtain
- `openQuestions` — items that require a human decision or more research

These are accumulated onto each artifact by the orchestrator so the user sees
what is unknown, not just what is known.
