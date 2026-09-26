# EA-OS server

Express + SQLite + Groq (or Gemini). Persists everything the app captures, runs the automation engine, and serves the AI features.

```bash
cp .env.example .env      # GROQ_API_KEY required; EA_OS_API_TOKEN and SMTP_* optional
npm install
npm run dev               # http://0.0.0.0:3001 — data in ./data/ea-os.sqlite
```

## Endpoints
| Route | Purpose |
|---|---|
| `GET /health` | provider, model, key, auth, smtp status |
| `POST /api/conversations/extract` | Whisper transcription → structured extraction (entity-linked) + follow-up detection against open commitments |
| `POST /api/challenges/analyze` | AI Solver: 4 board perspectives, root cause, consensus, action items, decisions |
| `POST /api/assistant/chat` | Assistant with tools: create_commitment, create_assignment, mark_done, add_expense, log_kpi, run_solver, draft_email, set_reminder, search_memory, get_status |
| `POST /api/sync/push` · `GET /api/sync/pull?since=` | Offline-first sync (last-write-wins); pushes fire event rules |
| `POST /api/sync/push-token` | Register an Expo push token |
| `GET/PUT /api/settings` | Founder name, goals, cash, notification prefs, email signature |
| `GET /api/emails` · `POST /api/emails/draft` · `POST /api/emails/:id/send` | Approve-then-send email (SMTP) |
| `GET/POST /api/invoices` · `PATCH /api/invoices/:id` | Receivables, chased automatically |
| `GET /api/automation` · `POST /api/automation/run/:kind` | Job queue status, escalation, finance; run any job now |
| `GET /api/brief` | Latest morning brief + snapshot |
| `GET /api/clients/:id/profile` | Everything known about a client (timeline, money, commitments, problems, leads) |
| `GET /t/:id` · `POST /t/:id/done` | **Public** task page for staff (linked from WhatsApp) — no login |

## Automations (jobs engine, `src/jobs/`)
- **Event rules** (on sync push): dated commitment → reminders at T-2 / T-0 / T+1 (and marks overdue); assignment → reminders; high-severity problem → AI Solver; KPI update → escalation check.
- **Schedules**: nightly `learn_corrections` (02:00) turns the founder's edits into extraction rules; Friday `weekly_review` (17:00) with outcome checks on Solver plans; morning brief (07:30), end-of-day recap (18:30), hourly overdue scan, 3-hourly escalation check, daily runway check (08:00), daily invoice chase (10:00: +1 reminder, +7 second, +14 demand notice, +30 → high-severity problem), Monday pipeline review, Friday investor-update draft, monthly close (1st).
- Everything runs through the queue in SQLite (`jobs` table) and is written to the `audit` table.

Swap SQLite for Supabase later by reimplementing `src/db.ts` — nothing else touches storage directly.
