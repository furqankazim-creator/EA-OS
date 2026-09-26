# Review: "Enhancement & Problem-Solving Strategy" (7 sections)

**Reviewed:** Sep 22, 2026 · against the EA-OS codebase as it stands today (server + mobile)
**Reviewer's stance:** honest, engineering-first. "Good" means *worth building and buildable*; "weak" means it needs rethinking before code.

---

## Verdict in one paragraph

The strategy is **directionally right and ~60% already scaffolded** in the codebase — more than you probably realize. Its strongest parts are the problem-solving loop (Section 4) and the intelligence layer (Sections 1–2), which line up with what makes EA-OS different from a chatbot. Its weakest parts are: (a) **three features that depend on things you don't have** (meeting bots, market data feeds, multi-user accounts), (b) **success metrics borrowed from consumer apps** that don't fit a single-founder tool, and (c) **no measurement of AI quality**, which is the thing most likely to make users stop trusting the system. Fix those three and the plan is solid. Below: what to keep, what to change, and exactly how each item maps onto the code.

**Score: 7.5/10 as a strategy · 5/10 as an execution plan** (the phasing is too optimistic and the order isn't payoff-first).

---

## Section-by-section

### Section 1 — Core improvements

| Feature | Verdict | What exists already | What's missing / how to build |
|---|---|---|---|
| **Intelligent Context Memory** (knowledge graph of people, projects, decisions) | ✅ Good — but don't build a "graph". | Entity linking to staff/clients in the extractor; client profiles (`clientProfile()`); assistant `search_memory` (keyword). | Add **embeddings** (one table `vectors(doc_id, embedding)`; Groq doesn't serve embeddings — use a small local model via `@xenova/transformers` or OpenAI `text-embedding-3-small`). Then `search_memory` becomes semantic and the Solver/assistant get "last time this happened" context. A graph DB adds nothing here; the doc store + embeddings + the `clientContextText()` pattern already gives you the graph edges you need (person↔commitment↔client↔problem). |
| **Predictive Problem Detection** | ✅ Good — partly live. | Escalation ladder (pace + forecast), runway check, overdue scan, invoice ageing, weekly pipeline check — all as jobs. | Two real additions: **staff overallocation** (job: assignments due within 3 days per person > threshold → notify + suggest reassignment) and **trend detection on KPIs** (7-day slope on leads/revenue; alert on a 2-week decline). Both are ~40 lines in `jobs/handlers.ts`. |
| **Outcome Tracking** | ✅ Good — live. | `outcome` on problems (worked / partial / failed), weekly review asks "did it work?" after 7 days. | Close the loop *into the prompt*: feed past outcomes into the Solver ("plans of type X worked 3/4 times for you"). One paragraph in `challenges.ts` built from `problems` with outcomes. |
| **Task Decomposition** ("build MVP by Oct 31" → sprint plan) | ✅ Good, cheap. | Solver already emits `action_items` with `deadline_days` and assignees; Assistant can `create_assignment`. | Add an assistant tool `decompose_goal(goal, deadline)` → milestones → assignments with staggered due dates, gated by a confirm step. Reuse the Solver prompt style. ~1 day. |
| **Collaborative Problem Rooms** | ⚠️ Weak *for now*. | Single-user system; staff interact only via public task links. | Requires accounts, roles, per-user auth, and a real-time layer. Defer to Phase 4. The 80% version that needs none of that: **staff can reply on the task page** (a text box on `/t/:id`) and their replies land in the problem's timeline. Build that instead. |

### Section 2 — Advanced features

| Feature | Verdict | Notes |
|---|---|---|
| **Playbook Builder** (wins → repeatable process) | ✅ Excellent — best idea in the doc. | Mechanism: when a problem's outcome = *worked*, a job asks the LLM to generalize the plan into a **playbook** (trigger conditions, steps, owners, timings) stored in a `playbooks` collection. The Solver checks playbooks *before* running the board: "You have a playbook for this — apply it or run a fresh analysis?" This is how the system gets smarter without more model calls. |
| **Goal Orchestration** (dependencies, conflicts, sequencing) | ✅ Good, medium effort. | Needs a `goals` collection (target, deadline, depends_on). Conflict detection is mostly deterministic: overlapping owners, dates, and cash. The LLM only narrates. Combine with "Goal decomposition" — set 100k → needed leads → needed outreach/day → tracked as daily inputs. |
| **Market Intelligence** (competitor moves, sentiment, trends) | ❌ Weak as specified. | There is no data source. "Auto-enrich" from where? Web search via `groq/compound` is possible but shallow and rate-limited, and for a Pakistani services SME the signal is low. Downgrade to: *optional web context on a Solver run*, behind a toggle. Don't put it on the roadmap as a pillar. |

### Section 3 — Operational improvements

| Feature | Verdict | Notes |
|---|---|---|
| **Auto Meeting Notes** (joins meetings, transcribes) | ⚠️ Overreach. | "Joins meetings" means a Zoom/Meet bot (Recall.ai-style service, ~$0.5–1/hr) or platform APIs — real cost and complexity. The version you can ship: **record the meeting from the phone** (background recording is already configured) + speaker diarization on the server (Deepgram/AssemblyAI, or pyannote). Same output, no bot. |
| **Revenue Forecasting** (90 days, scenarios) | ✅ Good — build it. | You already have: leads with stage + value, invoices with due dates, expenses, payroll, cash. A deterministic **13-week cash-flow model** (`simulate.ts`) with optimistic/base/pessimistic conversion rates is math, not AI — and it makes every Solver answer and morning brief concrete ("180k short in week 6"). Highest-value item in the whole document. |
| **Automated Reporting** | ✅ Already ~70% live. | Morning brief, EOD recap, weekly review, monthly close, investor update draft all exist as jobs. Missing: a **rendered one-page PDF/HTML** (investor/board memo) — one route that composes the existing briefs + KPI chart into HTML, `puppeteer`-free via an HTML email or a shareable `/r/:id` page like the task page. |

### Section 4 — Problem-solving framework

The 8-step loop (Capture → Understand → Explore → Decide → Execute → Measure → Decide again → Close & Learn) is **the right spine**, and here is how it already maps:

| Step | Where it lives today | Gap |
|---|---|---|
| Capture | VoiceRecorder → `/extract` | — |
| Understand | Extraction, entity linking, client context | Add "clarifying question" — when severity is high and description < 20 words, the assistant asks one question before the board runs |
| Explore | Solver: 4 perspectives, disagreements | Add **simulation** of 2–3 candidate plans (see Section 3 forecasting) |
| Decide | Adopt Consensus → decisions + assignments | — |
| Execute | Tasks, WhatsApp link, DONE page, reminders | Staff replies on the task page |
| Measure | Escalation, KPI history, overdue scan | **Tripwires**: measurable failure conditions per adopted plan, checked by the jobs engine |
| Decide again | Weekly review outcome check | Auto-suggest the fallback when a tripwire fires |
| Close & Learn | Outcome chips, correction loop | **Playbooks** (Section 2) |

**Decision Quality Framework** (timeliness, evidence, execution, outcome): good idea, but define it so it's computable, not a survey:
- *Timeliness* = days from problem creation → plan adopted
- *Evidence* = did the plan cite KPI/client data (boolean from the prompt) + were assumptions listed
- *Execution* = % of action items done by their due date
- *Outcome* = the outcome chip
Store as four numbers on the problem; show a trend in the weekly review. Two hours of work once the data is there.

### Section 5 — Technical architecture

Mostly consistent with what's built. Corrections:
- The doc assumes Supabase + n8n. Today it's **SQLite + a jobs engine** with the same shape; the swap is one file (`server/src/db.ts`). Don't add n8n until a workflow actually needs a visual editor — the jobs engine is simpler to debug and already audited.
- Add what the doc omits: **an evaluation harness for the AI** (50 approved notes → accuracy per category on every prompt/model change). Without it, "improvements" to prompts are guesses.
- Add **cost/latency accounting** per model call (tokens, ms) — Groq free-tier limits are the most common failure you'll hit.

### Section 6 — Phased rollout (13+ weeks)

The phases are logical but the **order is by architecture layer, not by founder payoff**. Re-sequenced by value ÷ effort:

| Weeks | Build | Why first |
|---|---|---|
| 1–2 | Cash-flow forecast + scenario simulation; staff overallocation + KPI trend alerts; decision quality scores | All deterministic, all use existing data, all make the Solver concrete |
| 3–4 | Playbooks; tripwires + fallback plans; goal decomposition tool | Turns one-off answers into a system that learns |
| 5–6 | Embeddings memory ("this happened before"); dispute/negotiation evidence builder from client profiles | Biggest quality jump for the Solver and assistant |
| 7–8 | Dev build + hosting (needs your accounts); live-call copilot; phone-recorded meetings with diarization | Unlocks push, live text, meetings |
| 9–12 | Reports page (memo), staff replies on task pages, eval harness UI | Polish + trust |
| 13+ | Accounts/roles → problem rooms; optional market context | Only when there are other users |

### Section 7 — Success criteria

- **"DAU > 80%", "NPS > 50"** — these are consumer-app metrics; for one founder they're meaningless (DAU is 1 or 0). Replace with:
  - Notes captured per working day (target ≥ 5)
  - **Corrections per note** (target < 1 — the real measure of extraction quality)
  - % of commitments with a due date that got closed on time
  - Time from problem logged → plan adopted (target < 24 h for high severity)
  - % of adopted plans with a recorded outcome after 30 days (target > 80%)
  - Receivables > 30 days overdue (target ↓ month over month)
- **"Problems solved 80%+"** — define *solved* as `outcome = worked` within 30 days; otherwise it can't be measured.
- **"Time saved > 10 hrs/week"** — fine as a goal, but instrument it: count entities auto-logged × ~2 min each. Show it on the weekly review.

---

## What's already done (so the plan doesn't rebuild it)

Capture · extraction (9 categories + leads) · entity linking · follow-up detection · duplicate detection · correction learning loop · commit fan-out · reminders T-2/T-0/T+1 · overdue + escalation ladder · runway check · invoice chasing (+1/+7/+14/+30) · morning brief / EOD recap / weekly review / monthly close / investor draft · AI Solver (board, consensus, action items, decisions, outcomes) · assistant with 12 tools · client profiles · leads pipeline · staff DONE page · approve-then-send email · offline sync + audit log · in-app inbox + local notifications.

---

## Recommended next three (build order)

1. **Cash-flow forecast & scenario simulation** — `server/src/simulate.ts` + a Finance tab section + "simulate each plan" in the Solver. ~2 days.
2. **Playbooks + tripwires** — `playbooks` collection, `learn_playbook` job on `outcome=worked`, tripwire evaluation in the jobs engine, fallback draft on fire. ~3 days.
3. **Embeddings memory** — vector table, nightly indexer, semantic `search_memory`, "this happened before" block in the Solver. ~2 days.

Everything else in the strategy either follows from these or waits on accounts you need to create (hosting, EAS, meeting/market data providers).
