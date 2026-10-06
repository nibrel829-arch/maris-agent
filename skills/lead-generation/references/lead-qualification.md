# Lead Qualification

Implemented by the `qualify_lead` tool in `src/server/tools/crm.ts`.

## Stages

`identified → researched → contacted → qualified → disqualified → converted`

A lead starts at `identified` and moves to `qualified` only after an explicit
`qualify_lead` call scores it against criteria with evidence.

## Scoring

- The caller provides 1–12 criteria; each criterion includes `{ name, met, evidence }`.
- Score = `(met / total) * 100`, rounded.
- `gaps` = criteria with empty/missing evidence strings. These are surfaced,
  not filled in by default.
- `reasons[]` records `MET:` / `NOT MET:` per criterion with the evidence text.
- Stage auto-updates to `qualified` only when score ≥ 60.

## Anti-fabrication

- The system never invents company names, contacts, email addresses or
  qualification signals. Recorded evidence must trace to something the system
  retrieved or the user provided.
- A lead created with `source: "unverified"` is surfaced separately from
  evidence-backed leads.
