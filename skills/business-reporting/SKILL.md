---
name: business-reporting
description: >-
  Operational reports and decision memos built from real recorded workspace
  activity. Use this skill when the request asks for a business report,
  dashboard summary, pipeline numbers, activity counts or a decision memo.
  Reports contain only data that exists in the workspace; missing data is
  reported as missing — never estimated, extrapolated or invented.
tools:
  - build_business_report
  - list_clients
  - list_leads
  - list_content_items
  - list_email_templates
  - create_notification
work_types:
  - reporting
  - business_operations
  - decision_making
outputs:
  - business_report
  - decision_memo
max_risk: low
version: "1.0"
references:
  - references/reporting-templates.md
---

# Business Reporting

Aggregates real recorded workspace activity into operational reports and
supports decision memos.

## When to use

- "Give me a 30-day report", "How many qualified leads do we have?"
- Dashboard summaries, activity counts, pipeline numbers
- Decision memos that separate facts, evidence, interpretations,
  recommendations and risks
- Listing clients, leads, content items or email templates for review

## When NOT to use

- Research into external market data not in the workspace → `research-intelligence`
- Creating new content or campaigns → `content-marketing`

## Hard rules

- Every number is a count of records that actually exist in the workspace.
  No estimation, no extrapolation, no "typical" benchmarks injected.
- If no records exist, the metric is reported as `0` and `missingData` lists
  what is absent (e.g. "No lead records exist for this period").
- Reports do not fabricate revenue, conversion rates or outcomes.
- Decision memos use the strict FACT / EVIDENCE / INTERPRETATION /
  RECOMMENDATION split.
- Reports never expose secret configuration values.

## Report structure (default)

- title, period, generatedAt
- metrics (counts per entity type)
- clientStatusBreakdown, contentByStatus
- leadCount, qualifiedLeads, pendingApprovals
- missingData[]
- note confirming no estimation was performed

## References

- Brand voice: `src/knowledge/brand-voice.json`
- Claim policy: `src/knowledge/claim-policy.json`
- Reporting templates: `references/reporting-templates.md`
- PDF #11 (testing/observability) and PDF #12 §24
