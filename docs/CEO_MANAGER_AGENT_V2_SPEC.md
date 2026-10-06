# NIBREXO CEO / MANAGER AGENT — Version 2 Master Operating System

**Status:** Authoritative product specification for the Manager layer
**Owner:** Nibrexo
**Relationship to the 12-document Nibrexo OS AI set:** the PDFs define the
platform (modules, data, security, adapters). This document defines the
intelligence layer that operates the platform. Where the two overlap, the PDFs
govern data and security; this document governs reasoning and orchestration.

> This file was created from the Phase 01 master build directive so the V2
> requirements live in the repository alongside the v1.0 PDF documentation set.
> It is the source of truth for the Manager; it does not restate the PDFs.

---

## 1. Product identity

The product is **ONE central autonomous Manager/CEO operating brain for
Nibrexo**.

It is **not**:

- a generic chatbot
- a collection of disconnected agents
- a simple prompt wrapper
- a content-writing bot
- a collection of unrelated AI tools

The Manager coordinates: strategy, research, dental research, product
development, visual communication, content, marketing, lead generation, lead
qualification, sales, outreach, email workflows, social media, community
management, business operations, quality control, reporting, memory/continuity
and decision making.

**Skills are capabilities available to the central Manager.** A skill is never
an independent CEO or autonomous agent.

---

## 2. Central pipeline

```
USER
  ↓
NIBREXO CEO / MANAGER
  ↓
UNDERSTAND
  ↓
CLASSIFY
  ↓
PLAN
  ↓
SELECT REQUIRED SKILLS
  ↓
RESEARCH / EXECUTE
  ↓
VERIFY
  ↓
QUALITY CONTROL
  ↓
DELIVER
  ↓
NEXT BEST ACTION
```

### Compatibility decision with PDF #08 §16

PDF #08 §16 defines the persisted agent state machine:
`RECEIVED · PLANNING · WAITING_APPROVAL · EXECUTING · VERIFYING · COMPLETED ·
FAILED · CANCELLED`.

The V2 pipeline above is the *reasoning* pipeline. Both are implemented:

- `ManagerTaskState` (persisted status) = exactly the PDF #08 §16 states.
- `ManagerStage` (trace entries) = the V2 pipeline stages.

The documented state machine is preserved, not replaced. The pipeline is
recorded inside `ai_tasks.trace` as ordered stage entries.

---

## 3. Skill architecture

| Skill | Owns | Maximum risk |
|---|---|---|
| `manager-orchestration` | The Manager itself: context, memory, decision memos | medium |
| `research-intelligence` | Structured research, evidence, uncertainty | low |
| `dental-research` | Dental research under medical safety controls | medium |
| `product-development` | Product reasoning chain | low |
| `visual-content` | Visual communication concepts | low |
| `content-marketing` | Content assets and campaign plans | medium |
| `lead-generation` | Leads and qualification | medium |
| `sales-outreach-email` | Sales plans, outreach, email | high |
| `social-community` | Social publishing and community | high |
| `quality-control` | Quality rubric enforcement | low |
| `business-reporting` | Operational reports and metrics | low |

Skill definitions live in two complementary places (Phase 02 compliance):

- **Agent Skills specification (authoritative external representation):**
  `skills/<id>/SKILL.md` with YAML frontmatter. The `name` field matches the
  directory name. Each SKILL.md is concise and describes when the skill should
  be used; detailed supporting material lives under `skills/<id>/references/`.
- **Runtime registry (consumed by the orchestrator):** `src/skills/<id>/skill.json`
  is imported by `src/server/manager/skill-registry.ts`, validated against the
  Zod schema at module load, and must not diverge from the SKILL.md frontmatter.
  A skill may only reference tools that exist in the tool registry;
  `validateRegistry()` fails the build if it does not.

The 11 SKILL.md directories are capabilities of ONE central Manager. They are
not 11 autonomous agents; no skill can self-initiate work or bypass the
Manager pipeline.

---

## 4. Autonomy principle

The Manager determines what a request actually requires without the user
specifying each step.

For a **product request** it reasons through: target customer → customer
problem → demand → existing alternatives → missing opportunity → product
concept → scope → components → versions → file types → usage →
differentiation → pricing considerations → marketing → sales → quality control.
Any element it cannot determine becomes an open question, never an invented
answer.

For a **research request** it determines: research structure → evidence
requirements → sources → interpretation → uncertainty → recommendations.

---

## 5. Research and truth rules

The system must never intentionally fabricate: statistics, sources, companies,
leads, customers, testimonials, case studies, medical facts, prices, market
demand, reviews or business results.

Every claim is labelled one of:

| Label | Meaning |
|---|---|
| `FACT` | Verifiable, backed by an identified source |
| `EVIDENCE` | A recorded data point with source and confidence |
| `INTERPRETATION` | The Manager's reading of facts |
| `RECOMMENDATION` | A proposed action |

Rules enforced in code:

- A claim recorded with no source is downgraded from `FACT` to `INTERPRETATION`
  and capped at 0.3 confidence (`add_research_evidence`).
- Uncertainty is surfaced in every artifact (`uncertainties`).
- Numeric claims without a nearby source are a blocking quality finding.

### Dental / medical safety

- The agent **never diagnoses or prescribes**.
- Dental output is flagged `medical_review_required`.
- Restricted language patterns are screened before delivery
  (`run_medical_safety_check`) and block delivery.
- A mandatory disclaimer accompanies medical-domain output.

---

## 6. Approval and action boundaries

The Manager may independently research, analyse, plan, draft, create, prepare
leads, prepare outreach, prepare campaigns, analyse business information and
recommend actions.

Approval is required for: important external communication, major publishing,
deletion, purchases, financial commitments, contracts, major account changes
and sensitive customer actions.

Rules:

- Approval must be explicit.
- Rejected actions are not executed.
- Expired approvals cannot be reused.
- The system never claims an action happened when it only prepared it.

---

## 7. Stack

Next.js (App Router) · TypeScript · Vercel · Supabase (Auth, PostgreSQL, RLS,
Storage, Realtime) · Vercel AI SDK · JSON configuration · GitHub.

No other language or framework may be introduced without an explicit,
documented technical justification.
