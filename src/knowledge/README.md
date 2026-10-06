# Nibrexo Knowledge Layer

This directory is the JSON knowledge base consumed by the Manager and its
tools at runtime. It captures the authoritative policies, standards and
frameworks from the 12-document Nibrexo OS AI specification set and the
CEO/Manager V2 spec.

| File | Covers | Source |
|---|---|---|
| `brand-voice.json` | Nibrexo Business Identity — positioning, tone, do/avoid, channel guidance | CEO V2 spec §2, PDF #10 §7 |
| `research-standards.json` | Research/Evidence Standard — required structure, evidence requirements, domain specifics | CEO V2 spec §5, §7 |
| `claim-policy.json` | Anti-fabrication rules, FACT/EVIDENCE/INTERPRETATION/RECOMMENDATION labels | CEO V2 spec §5 |
| `medical-safety.json` | Dental Safety Rules — prohibited patterns, disclaimer, review flag | CEO V2 spec §5 |
| `product-development-framework.json` | Product Architecture reasoning chain — target customer → QC | CEO V2 spec §4 |
| `quality-rubric.json` | Quality Control Checklist — evidence, no-fabrication, uncertainty, medical, action honesty | CEO V2 spec §5, PDF #08 §14 |

Additional knowledge lives in code (not duplicated here to avoid drift):

- **Decision Framework** — implemented by `create_decision_memo` and the
  planner (`src/server/manager/planner.ts`, `src/server/tools/operations.ts`)
  and documented in `docs/CEO_MANAGER_AGENT_V2_SPEC.md` §2 and §5.
- **Lead Qualification** — scoring rules in `qualify_lead`
  (`src/server/tools/crm.ts`) and in
  `skills/lead-generation/references/lead-qualification.md`.
- **Outreach Rules** — provider abstraction, action honesty and approval
  boundaries in `src/server/integrations/email/provider.ts` and
  `skills/sales-outreach-email/references/outreach-rules.md` (PDF #10).
- **Social Content System** — adapter capability rule and content lifecycle
  in `src/server/integrations/social/adapter.ts` and
  `skills/social-community/references/social-rules.md` (PDF #09).
- **Visual Communication System** — enforced by `create_visual_concept`
  (`src/server/tools/research.ts`) and documented in
  `skills/visual-content/SKILL.md`.
- **Reporting Templates** — operational report and decision memo schemas in
  `build_business_report` / `create_decision_memo` and
  `skills/business-reporting/references/reporting-templates.md`.

## Rule of thumb

The 12 PDFs are the authoritative source. When a decision from the PDFs is
needed by runtime code, encode it once (in JSON or in code) and reference it
from the skill SKILL.md and references/ docs. Do not duplicate the same rule
in multiple places.
