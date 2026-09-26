# EA-OS — Improvement & Automation Roadmap

**Status date:** Sep 19, 2026
**Stack today:** Expo SDK 57 (React Native) · Express + Groq (Whisper large-v3, GPT-OSS 120B) · on-device AsyncStorage
**Goal:** turn the current working prototype into a system that runs the founder's day *without being asked* — capture once, everything else is automatic.

---

## What I'd add next, in order of payoff — **items 1–5 built Sep 21, 2026**

1. ✅ **Correction feedback loop**: Every inline edit/discard in Extract gets logged; nightly job turns them into few-shot examples in the extraction prompt. Accuracy improves from your own usage.
2. ✅ **Leads as a first-class entity**: Extraction category + leads collection + pipeline KPI computed from it (today pipeline is a manually logged number).
3. ✅ **Staff "DONE" loop**: A tiny public web page per assignment (`/t/:id`) linked in the WhatsApp message; tapping it marks done. No Business API needed.
4. ✅ **Client profiles**: Timeline of every mention, invoices, commitments per client; the Solver and assistant pull it as context.
5. ✅ **Weekly review job**: Friday summary of decisions made, outcome check on Solver plans adopted 7+ days ago ("did it work?").
6. ⏳ **Dev build + hosting** (needs your Expo/hosting accounts): Unlocks push notifications and live speech-to-text, and lets the app work outside your Wi-Fi.

---


## 0. Where we are (honest inventory) — updated Sep 19, 2026 (evening)

| Area | Real today | Still placeholder / needs your account |
|---|---|---|
| Voice capture | Mic recording, live waveform, EN/UR, auto-stop (VAD), text mode, quick samples, transcript editing + re-extract | Live speech-to-text needs a dev build (Expo Go falls back to Whisper on stop) |
| Transcription + extraction | Whisper → GPT-OSS 120B, entity-linked to your staff/clients, due dates resolved, **follow-up detection** closes/delays existing commitments | — |
| Review & commit | Inline edit / discard per item, duplicate detection, one-tap commit fans out to Actions / Finance / Solve / Health / KPI / Team tasks | — |
| Storage & sync | Server SQLite + offline-first sync (outbox, last-write-wins), audit log, export JSON | Supabase/Postgres (swap `server/src/db.ts`), hosted HTTPS |
| Automation engine | Jobs queue + schedules: morning brief, EOD recap, reminders T-2/T-0/T+1, overdue scan, escalation ladder, runway check, invoice chasing (+1/+7/+14/+30), weekly investor update, monthly close, Monday pipeline review | — |
| Notifications | In-app inbox with deep links; Expo push registration | Push delivery needs a dev build + physical device |
| AI Solver | Exact board prompt, 4 perspectives, root cause, disagreements, one-click commit → assignments + decisions; auto-runs for high-severity and escalation level 4 | Real Gemini/Claude/GPT/Grok keys (perspectives are simulated by one model) |
| Assistant | **Acts** via tools: delegate, log expense/KPI, mark done, remind, draft email, run Solver, search memory | Voice in/out |
| Comms | Email drafts (AI) with approve-then-send via SMTP; invoices module; WhatsApp task delivery via deep link | SMTP credentials; Gmail OAuth; WhatsApp Business API; Calendar |
| KPI / Finance | Goals in settings, escalation + forecast, real revenue history chart, burn & runway, receivables | Receipt OCR, bank statement import |
| Settings | Profile, goals, cash, notification toggles/hours, run-any-job, email signature, export, reset | Auth UI (token is env-based for now) |
| Security | Bearer-token auth + rate limits (set `EA_OS_API_TOKEN`) | HTTPS hosting, per-user accounts |

Everything below is ordered so that each phase makes the next one cheaper.

---

## 1. Foundation (must happen before anything "automated" can be trusted)

### 1.1 Backend database — Supabase (Postgres)
Why first: automation needs data that exists when the phone is off.

- Tables: `conversations`, `extractions`, `decisions`, `commitments`, `assignments`, `expenses`, `problems`, `problem_analyses`, `health_log`, `kpi_updates`, `staff`, `clients`, `invoices`, `audit_log`, `settings`.
- Row-level security keyed to the founder's user id; staff get a scoped role later.
- Store the raw audio in Supabase Storage (bucket `voice-notes`, 90-day retention) so any log can be re-transcribed with a better model later.
- App: replace the AsyncStorage reducer with an **offline-first sync layer** — keep the reducer, add an outbox queue that pushes mutations when online, pulls changes on focus. (Keep AsyncStorage as the cache.)

### 1.2 Auth + server hardening
- Supabase Auth (email OTP or Google) → JWT passed to the Express server; every route checks it.
- Rate limiting per user, request size caps (audio ≤ 25 MB), structured logging (pino), request ids.
- Deploy the server (Railway / Fly.io / a VPS) behind HTTPS so the app works off-LAN. Keep `EXPO_PUBLIC_API_URL` for the production URL.
- Rotate the Groq key that was shared in chat; move all secrets to the host's secret store.

### 1.3 Release engineering
- EAS Build profiles: `development` (includes expo-speech-recognition → live transcript), `preview`, `production`.
- OTA updates via EAS Update for JS-only changes.
- Basic tests: extraction schema normalizer, commit fan-out reducer, date grouping, hallucination filter. Playwright/Detox smoke test for record → extract → commit.

**Deliverable:** same features as today, but multi-device, backed up, secured, installable. ~2 weeks.

---

## 2. Automation Engine (the heart of "more automated")

Build one generic **Rules & Jobs** service on the server; every automation below is a rule, not custom code.

```
Trigger (event | schedule | threshold)
   → Condition (SQL/JS predicate over the DB)
   → Actions (notify | create entity | draft email | run LLM | escalate)
   → Audit log entry
```

Implementation: a `jobs` table + a worker loop (BullMQ on Redis, or pg-boss on Postgres to avoid another service). Cron via the same worker. n8n can call these as HTTP tools if you want visual workflows on top.

### 2.1 Event-driven automations (fire on commit)
| Event | Automatic action |
|---|---|
| Commitment extracted with a date | Create reminder jobs at T-2 days, T-0 morning, T+1 overdue |
| Instruction with `assigned_to` = staff member | Create Assignment **and** send it to that person (WhatsApp/SMS/email — §6) |
| Problem severity = high | Run AI Solver immediately (exists) → push a notification with the root cause |
| Finance item extracted | If amount > threshold or category unknown → ask a one-tap "office / personal / split?" question |
| KPI update | Recompute escalation level (§2.3); if level rises → notify |
| Health item `injury` / `sleep` < 6h twice in a week | Add a soft nudge to the morning brief, suggest blocking a physio slot |
| Staff mention with negative sentiment | Attach to that staff profile timeline (§7) |

### 2.2 Scheduled automations
| Schedule | Job |
|---|---|
| Daily 07:30 | **Morning Brief** push: commitments due today, overdue items, yesterday's spend, revenue vs target, top problem, health nudge. Also read aloud (TTS) on tap. |
| Daily 18:30 | **End-of-day recap**: what was captured, what is still uncommitted (nudge to review extractions), tomorrow's due items |
| Hourly | Overdue scan → escalate status, notify owner and founder |
| Weekly Fri 16:00 | Draft the **investor update** from KPI + wins + problems (goes to Email drafts for approval) |
| Weekly Mon 09:00 | Pipeline review prompt: "8 leads vs 20 target — run Solver on pipeline?" |
| Monthly 1st | Finance close: expense summary by category, office vs personal split report (PDF), payroll reminder |
| Invoice due date +1, +7, +14, +30 | **Invoice chasing sequence**: reminder → 2nd reminder → demand notice draft → flag as problem (severity high) |

### 2.3 Escalation ladder (goal-miss tone)
Replace the static "Level 3" badge with a computed level:

```
level = f(days_left_in_month, gap_to_target, trend_last_7d)
1  on track          → no action
2  slightly behind   → morning brief mentions it
3  materially behind → daily notification + auto-run Solver weekly
4  critical          → Solver daily, assistant opens with the plan, investor-update draft includes mitigation
```
Tone of assistant/system messages changes by level (prompt variable).

### 2.4 Follow-up detection (closing the loop automatically)
When a new transcript mentions a commitment that already exists ("I sent the deck to Zahoor"), the extractor is asked a second question: *"Does this transcript complete, delay, or cancel any of these open items?"* → auto-mark completed / move due date. This is the biggest reduction of manual work.

### 2.5 Push notifications
`expo-notifications` + Expo push service. Each notification deep-links to the entity (tab + id). Notification preferences page in Settings (replaces the dead row).

---

## 3. Voice Pipeline improvements

- **Dev build by default** so live speech-to-text always works; Expo Go stays for quick UI checks.
- **Streaming transcription**: send 10-second chunks to Whisper while recording → transcript appears live even without on-device STT, and long notes (10–30 min meetings) don't hit upload limits.
- **Voice-activity detection**: auto-stop after 4 s of silence in "quick note" mode; long-press REC for meeting mode (no auto-stop).
- **Background recording** (iOS `UIBackgroundModes: audio` is already set; add Android foreground service via `expo-audio` config) so a call can be logged with the screen off.
- **Speaker diarization** for meetings (Whisper doesn't do it; use `pyannote` on the server or Deepgram/AssemblyAI as an optional provider). Then commitments get the *right* "who".
- **Urdu quality**: Whisper with `language=ur` when the toggle is UR; store both raw and Roman-Urdu normalized text; add a glossary prompt with client/staff names (already started — extend from the DB).
- **Transcript editing**: tap to correct a word → re-extract only changed items (diff view).
- **Confidence surfacing**: Whisper segment `avg_logprob` → highlight low-confidence phrases in the transcript so numbers/names get a second look before commit.
- **Attach context**: optional photo of a receipt or whiteboard with the note (feeds §7 OCR).

---

## 4. Extraction intelligence

- **Entity linking**: map "Furqan", "Furqan bhai", "the backend guy" → `staff.furqan`; "Acme", "Acme Corp" → `clients.acme`. Provide the staff/client list in the prompt; add a resolver step.
- **De-duplication**: before commit, compare new commitments/expenses against open ones (embedding similarity + amount/date match) and show "looks like an existing item — merge?".
- **Long-term memory (RAG)**: embed every transcript + extraction (pgvector). The assistant and the Solver get the top-k relevant past notes ("last time pipeline dried up you did X, it took 3 weeks").
- **Contradiction / drift detection**: decision made in March vs. opposite decision now → flag it ("This reverses the Mar 12 decision to go inbound-first — confirm?").
- **Two-pass extraction for long transcripts**: chunk → extract → merge, with a final consistency pass.
- **Schema versioning**: keep `extraction_version` on each row so re-processing with a new prompt is diffable.
- **Evaluation set**: 50 real anonymized notes with expected JSON; run on every prompt change (simple script + score).

---

## 5. AI Solver upgrades

- **Real multi-vendor panel** when keys exist: Gemini, Anthropic, OpenAI, xAI each answer their own perspective; fall back to the simulated single-call mode otherwise. Show which mode ran.
- **Outcome tracking**: 7 and 30 days after "Adopt Consensus", ask "did it work?" and log the result against the analysis → over time the Solver learns which advisor style pays off for this business.
- **Context injection**: pass related KPI history, open commitments, relevant past problems (RAG) into the prompt — not just title/description.
- **Cost & latency panel** in Settings: tokens per call, monthly spend estimate.
- **Board chat**: after the analysis, ask follow-up questions to a specific perspective ("Grok, what would you cut first?").
- **Convert disagreements into decisions**: each trade-off becomes a one-tap decision ("Speed" vs "Compliance") that is logged in the Decision tracker.

---

## 6. Communications: Email, WhatsApp, Calendar (makes the "Email Integration" row real)

- **Gmail**: OAuth 2.0 on the server (never store tokens on the phone). Scopes `gmail.send`, `gmail.readonly`. Drafts are generated by the LLM from entities (invoice reminder, investor update, client scope-clarification) → shown in Ops › Email for **approve-then-send**; sent mail is logged to the audit trail and linked to the source conversation.
- **Inbound email → extraction**: a Gmail watch (Pub/Sub) on labeled threads runs the same extraction pipeline, so client emails create commitments and problems automatically.
- **WhatsApp** (Twilio or Meta Cloud API): deliver assignments to staff, receive "done" replies that close the assignment, receive voice notes from the founder on the go (they enter the same pipeline).
- **Google Calendar**: commitments with dates create tentative calendar blocks; calendar events (e.g. "Meeting with Zahoor") are pre-attached to the next recording as context for better extraction.
- **Templates**: editable tone/signature per email type; language toggle (EN / Urdu).

---

## 7. Finance automation

- **Receipt OCR**: photo → amount, vendor, date (Groq vision or Google Document AI) → expense with `verified=false` → one-tap confirm. Auto office/personal split learned from history per vendor.
- **Bank SMS / statement import**: parse bank alert SMS (Android `READ_SMS` is restricted — use CSV/PDF statement import instead); reconcile against logged expenses; unmatched → "you spent 3,200 at X, log it?".
- **Invoices module**: create invoices from commitments ("Final Q3 delivery → invoice Acme 850k"), track due/paid, feed the chasing sequence (§2.2).
- **Burn & runway**: real burn from expenses + payroll; runway = cash / burn; runway < 3 months → problem auto-created.
- **Budgets per category** with alerts at 80 / 100 %.
- **Reports**: monthly PDF (office vs personal, by category, by client) emailed automatically.

---

## 8. KPI system

- **Goal setup screen**: define metrics (name, unit, target, period, direction); everything else derives from it. Replace hard-coded "100k".
- **Real data sources**: revenue from invoices (paid), pipeline from a `leads` table (created by extraction: "spoke to a new prospect"), deliverables from assignments.
- **History + trend**: keep every KPI update, draw the weekly chart from real points, compute trend automatically.
- **Escalation ladder** (§2.3) driven from here.
- **Forecast**: simple linear projection to month-end shown next to the target ("at this pace: 84k").

---

## 9. Team / Staff

- **Staff profiles**: role, salary, contact, timeline of mentions (from `staff_mentions`), open assignments, on-time rate.
- **Assignment delivery**: WhatsApp/email with a one-tap "Done" link (§6); founder sees status flip without asking.
- **Staff-side lite app / web link** (later): each person sees only their assignments and can voice-log updates that go to the founder's extraction pipeline tagged with their name.
- **Payroll reminders** and leave tracking (Sana's "on leave" becomes data).
- **Daily standup digest**: auto-compiled from staff updates, in the morning brief.

---

## 10. Assistant → Agent (from answering to acting)

- **Tool use**: give the assistant server-side tools: `create_commitment`, `mark_done`, `add_expense`, `run_solver`, `draft_email`, `search_memory`, `set_reminder`. Confirm destructive actions in-chat.
- **Voice in/out**: hold-to-talk in the assistant, spoken replies (Orpheus TTS on Groq once terms are accepted, or device TTS).
- **Proactive mode**: the assistant opens the day with the brief and a question ("Two commitments due today — want me to message Furqan for a status?").
- **Memory**: RAG over all transcripts (§4) so "what did I promise Acme in July?" works.
- **Persistent threads** stored in the DB, not component state.

---

## 11. UX & product polish

- Onboarding: name, team, currency, goals, connect Gmail, mic permissions — 2 minutes.
- Settings that work: profile, notification preferences, language, provider/model selection, data export (JSON/CSV), delete account.
- **Review queue**: uncommitted extractions badge on the EXTRACT tab; swipe to confirm/edit/discard each item.
- Inline edit for every extracted item before commit (currently only "confirm").
- Offline indicator + queued actions count.
- Urdu UI localization (i18n-js), RTL-safe layouts.
- Accessibility: larger text support, VoiceOver labels on icon-only buttons (bottom nav).
- Home widget / lock-screen quick record (iOS App Intent, Android Quick Settings tile).
- Tablet / web layout (two-pane logs + extraction).

---

## 12. Security & privacy

- Encrypt audio at rest (Supabase Storage with server-side keys); optional "don't keep audio" setting.
- Data export & delete in Settings (GDPR-style), audit log viewer (who/what/when — including automations).
- PII scrubbing option before sending transcripts to third-party LLMs.
- Secrets never in the app bundle; per-user API usage quotas.

---

## Suggested sequencing

| Phase | Weeks | Unlocks |
|---|---|---|
| **A. Foundation** — Supabase, auth, hosted HTTPS server, EAS dev build, tests | 1–2 | Everything else |
| **B. Automation core** — jobs/rules service, push notifications, morning brief, overdue escalation, follow-up detection | 3–4 | "It runs by itself" |
| **C. Comms** — Gmail approve-then-send, invoice chasing sequence, WhatsApp assignments | 5–6 | Closes the loop with staff and clients |
| **D. Intelligence** — entity linking, dedupe, RAG memory, assistant tools | 7–8 | Fewer corrections, real agent |
| **E. Finance & KPI** — goals screen, invoices, receipt OCR, burn/runway, real charts | 9–10 | Trustworthy numbers |
| **F. Voice** — streaming, VAD, background, diarization, transcript editing | 11–12 | Meetings, not just notes |
| **G. Polish** — onboarding, settings, Urdu UI, staff lite app, outcome tracking for Solver | ongoing | Daily-driver quality |

### Next 2 weeks — concrete sprint
1. Supabase project + schema + RLS; migrate the store to sync through it.
2. Deploy `server/` with HTTPS and JWT auth; rotate keys.
3. EAS development build so live transcription is on.
4. `expo-notifications` + Morning Brief job (07:30) + overdue scan (hourly).
5. Follow-up detection pass in `/extract` (auto-complete commitments).
6. Review-queue badge + inline edit of extracted items before commit.

---

## Open decisions (need your call)
- **Hosting**: Supabase + Railway (fastest) vs. own VPS (cheaper, more ops).
- **Messaging channel for staff**: WhatsApp Business API (needs Meta approval, ~1 week) vs. email/SMS first.
- **Multi-vendor Solver**: budget for Gemini/Anthropic/OpenAI/xAI keys, or keep the simulated panel.
- **Audio retention**: keep recordings (better re-processing, privacy risk) or transcript-only.
- **Staff access**: founder-only for now, or plan the staff lite app into phase C.
