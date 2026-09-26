// Rules & Jobs engine: a persistent queue in SQLite + a worker loop + recurring schedules.
// Every automation is a job kind with a handler; nothing runs outside this loop, so it's all in the audit log.
import { db, uid, audit } from '../db.js'

export type JobKind = 'reminder' | 'morning_brief' | 'eod_recap' | 'overdue_scan' | 'investor_update' | 'monthly_close'
  | 'invoice_chase' | 'analyze_problem' | 'escalation_check' | 'runway_check' | 'weekly_pipeline' | 'learn_corrections' | 'weekly_review' | 'recommend' | 'reindex_memory' | 'staff_load' | 'kpi_trend' | 'tripwire_check' | 'plan_adopted' | 'learn_playbook' | 'ask_clarification'
export type Handler = (payload: Record<string, unknown>) => Promise<string | void>
const handlers = new Map<JobKind, Handler>()
export const register = (kind: JobKind, h: Handler) => handlers.set(kind, h)

const q = {
  due: db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT 10"),
  insert: db.prepare('INSERT OR IGNORE INTO jobs (id, kind, run_at, payload, created_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)'),
  start: db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?"),
  done: db.prepare("UPDATE jobs SET status = 'done', finished_at = ?, last_error = ? WHERE id = ?"),
  fail: db.prepare("UPDATE jobs SET status = ?, last_error = ?, run_at = ? WHERE id = ?"),
  cancelByKey: db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status = 'pending' AND dedupe_key LIKE ?"),
  pendingOfKind: db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'pending' AND kind = ?"),
  list: db.prepare('SELECT id, kind, run_at, status, attempts, last_error, dedupe_key, payload FROM jobs ORDER BY run_at DESC LIMIT ?'),
  recover: db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'running'"),
}

export function enqueue(kind: JobKind, runAt: Date | number, payload: Record<string, unknown> = {}, dedupeKey?: string) {
  const at = typeof runAt === 'number' ? runAt : runAt.getTime()
  const r = q.insert.run(uid(), kind, at, JSON.stringify(payload), Date.now(), dedupeKey ?? null)
  return r.changes > 0
}
export const cancelJobs = (dedupePrefix: string) => q.cancelByKey.run(`${dedupePrefix}%`).changes
export const listJobs = (limit = 50) => (q.list.all(limit) as { payload: string }[]).map(j => ({ ...j, payload: JSON.parse(j.payload) }))

// ─── Recurring schedules ───
// Each schedule computes its next run; after a run completes it re-enqueues itself.
type Schedule = { kind: JobKind; next: (from: Date) => Date; payload?: Record<string, unknown> }
const schedules: Schedule[] = []
export const schedule = (s: Schedule) => schedules.push(s)

export const atHour = (hour: number, minute = 0) => (from: Date) => {
  const d = new Date(from); d.setHours(hour, minute, 0, 0)
  if (d <= from) d.setDate(d.getDate() + 1)
  return d
}
export const weeklyAt = (dow: number, hour: number) => (from: Date) => {
  const d = new Date(from); d.setHours(hour, 0, 0, 0)
  let diff = (dow - d.getDay() + 7) % 7
  if (diff === 0 && d <= from) diff = 7
  d.setDate(d.getDate() + diff); return d
}
export const monthlyOn = (day: number, hour: number) => (from: Date) => {
  const d = new Date(from.getFullYear(), from.getMonth(), day, hour)
  if (d <= from) d.setMonth(d.getMonth() + 1)
  return d
}
export const everyMinutes = (m: number) => (from: Date) => new Date(from.getTime() + m * 60_000)

function ensureScheduled() {
  for (const s of schedules) {
    const n = (q.pendingOfKind.get(s.kind) as { n: number }).n
    if (n === 0) enqueue(s.kind, s.next(new Date()), s.payload ?? {}, `sched:${s.kind}`)
  }
}

// ─── Worker loop ───
let running = false
async function tick() {
  if (running) return
  running = true
  try {
    const jobs = q.due.all(Date.now()) as { id: string; kind: JobKind; payload: string; attempts: number }[]
    for (const j of jobs) {
      const h = handlers.get(j.kind)
      q.start.run(j.id)
      try {
        if (!h) throw new Error(`no handler for ${j.kind}`)
        const note = await h(JSON.parse(j.payload))
        q.done.run(Date.now(), note ?? null, j.id)
        audit('jobs', `run:${j.kind}`, note ?? 'ok')
      } catch (e) {
        const msg = (e as Error).message
        const retry = j.attempts < 3
        q.fail.run(retry ? 'pending' : 'failed', msg, Date.now() + 5 * 60_000 * j.attempts, j.id)
        audit('jobs', `fail:${j.kind}`, msg)
        console.error(`job ${j.kind} failed (attempt ${j.attempts}):`, msg)
      }
    }
    ensureScheduled()
  } finally { running = false }
}

export function startEngine(intervalMs = 20_000) {
  q.recover.run()
  ensureScheduled()
  void tick()
  setInterval(() => void tick(), intervalMs)
  console.log(`jobs engine: ${handlers.size} handlers, ${schedules.length} schedules, tick ${intervalMs / 1000}s`)
}
