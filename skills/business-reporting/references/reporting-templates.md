# Reporting Templates

Implemented by `build_business_report` in `src/server/tools/operations.ts`.

## Operational report

```json
{
  "title": "<string>",
  "period": "7d | 30d | 90d | all",
  "generatedAt": "<ISO-8601>",
  "metrics": {
    "clients": <count>,
    "leads": <count>,
    "contentItems": <count>,
    "approvals": <count>,
    "activityLogs": <count>
  },
  "clientStatusBreakdown": { "<status>": <count> },
  "contentByStatus":      { "<status>": <count> },
  "leadCount":            <count>,
  "qualifiedLeads":       <count>,
  "pendingApprovals":     <count>,
  "missingData": ["<string>"]
}
```

## Decision memo

Created via `create_decision_memo`, stored in organization memory with
`scope: decision_memo`:

```json
{
  "decision": "<string>",
  "facts":            ["<verifiable, sourced>"],
  "interpretations":  ["<Manager reading>"],
  "recommendations":  ["<proposed action>"],
  "risks":            ["<downside / uncertainty>"],
  "createdAt": "<ISO-8601>"
}
```

## Honesty rule

Both report types contain only records that exist in the workspace. Missing
data is listed explicitly in `missingData`; nothing is estimated or filled in
with defaults that look like real numbers.
