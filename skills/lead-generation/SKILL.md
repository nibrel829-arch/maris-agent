---
name: lead-generation
description: >-
  Lead identification, recording and qualification. Use this skill when the
  request asks to find, research, list or qualify sales leads. Every lead
  carries its source and evidence; the system never invents leads, companies,
  contacts, testimonials or case studies. Qualification is evidence-based, with
  unscored criteria reported as gaps, not assumed.
tools:
  - create_lead
  - list_leads
  - qualify_lead
  - create_research_brief
  - log_activity
work_types:
  - lead_generation
  - lead_qualification
  - sales
outputs:
  - lead_list
  - qualification_assessment
max_risk: medium
version: "1.0"
references:
  - references/lead-qualification.md
---

# Lead Generation

Identifies, records and qualifies leads against explicit, evidencable criteria.

## When to use

- "Find leads for…", "Build a prospect list for…", "Qualify this lead"
- Recording a researched lead into the workspace
- Scoring a lead against documented qualification criteria

## When NOT to use

- Writing outreach copy or emails to leads → `sales-outreach-email`
- Reporting on existing pipeline metrics → `business-reporting`

## Hard rules

- **No invented leads.** Every lead requires a `source`; unknown provenance is
  stored as `"unverified"`, never hidden.
- Qualification criteria must carry a written evidence string per criterion.
- Criteria without evidence are reported as `gaps`, not assumed to be met.
- A lead is marked `qualified` only when its score reaches the threshold
  (currently ≥ 60% of criteria met with evidence).
- Research required to substantiate a criterion is done through the research
  tools (not by fabricating data).

## References

- Claim policy (no fabrication): `src/knowledge/claim-policy.json`
- Research standards for supporting evidence: `src/knowledge/research-standards.json`
- Qualification scoring detail: `references/lead-qualification.md`
- Lead / client lifecycle: PDF #04
