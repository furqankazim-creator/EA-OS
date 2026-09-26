// Server-side persistence: SQLite document store with the same collections the app uses.
// Designed so Supabase/Postgres can replace it later — callers only use these helpers.
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })
export const db = new Database(path.join(DATA_DIR, 'ea-os.sqlite'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS docs (
  collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS docs_updated ON docs(updated_at);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, run_at INTEGER NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at INTEGER NOT NULL, finished_at INTEGER, dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending';
CREATE TABLE IF NOT EXISTS push_tokens (token TEXT PRIMARY KEY, platform TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  collection TEXT, doc_id TEXT, summary TEXT
);
`)

export type Collection = 'conversations' | 'decisions' | 'expenses' | 'problems' | 'assignments' | 'health' | 'kpis'
  | 'invoices' | 'staff' | 'clients' | 'emails' | 'notifications' | 'briefs' | 'settings' | 'threads' | 'corrections' | 'leads' | 'recommendations' | 'playbooks' | 'tripwires'
export const COLLECTIONS: Collection[] = ['conversations', 'decisions', 'expenses', 'problems', 'assignments', 'health', 'kpis',
  'invoices', 'staff', 'clients', 'emails', 'notifications', 'briefs', 'settings', 'threads', 'corrections', 'leads', 'recommendations', 'playbooks', 'tripwires']

export interface Doc<T = Record<string, unknown>> { collection: Collection; id: string; data: T; updated_at: number; deleted: boolean }

const q = {
  get: db.prepare('SELECT * FROM docs WHERE collection = ? AND id = ?'),
  list: db.prepare('SELECT * FROM docs WHERE collection = ? AND deleted = 0 ORDER BY updated_at DESC'),
  since: db.prepare('SELECT * FROM docs WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?'),
  upsert: db.prepare(`INSERT INTO docs (collection, id, data, updated_at, deleted) VALUES (@collection, @id, @data, @updated_at, @deleted)
    ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at >= docs.updated_at`),
  audit: db.prepare('INSERT INTO audit (ts, actor, action, collection, doc_id, summary) VALUES (?, ?, ?, ?, ?, ?)'),
  auditList: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
}

type Row = { collection: Collection; id: string; data: string; updated_at: number; deleted: number }
const rowToDoc = <T,>(r: Row): Doc<T> => ({ collection: r.collection, id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at, deleted: !!r.deleted })

export function getDoc<T = Record<string, unknown>>(collection: Collection, id: string): Doc<T> | null {
  const r = q.get.get(collection, id) as Row | undefined
  return r && !r.deleted ? rowToDoc<T>(r) : null
}
export function listDocs<T = Record<string, unknown>>(collection: Collection): T[] {
  return (q.list.all(collection) as Row[]).map(r => rowToDoc<T>(r).data)
}
export function changesSince(ts: number, limit = 2000): Doc[] {
  return (q.since.all(ts, limit) as Row[]).map(r => rowToDoc(r))
}
/** Last-write-wins upsert. Returns true if the write was applied (not older than what's stored). */
export function putDoc(collection: Collection, id: string, data: Record<string, unknown> | null, updated_at = Date.now(), actor = 'server'): boolean {
  const before = q.get.get(collection, id) as Row | undefined
  if (before && before.updated_at > updated_at) return false
  q.upsert.run({ collection, id, data: JSON.stringify(data ?? {}), updated_at, deleted: data === null ? 1 : 0 })
  q.audit.run(Date.now(), actor, data === null ? 'delete' : before ? 'update' : 'create', collection, id, summarize(data))
  return true
}
export function patchDoc(collection: Collection, id: string, patch: Record<string, unknown>, actor = 'server'): boolean {
  const cur = getDoc(collection, id)
  if (!cur) return false
  return putDoc(collection, id, { ...cur.data, ...patch }, Date.now(), actor)
}
export const audit = (actor: string, action: string, summary: string, collection?: Collection, docId?: string) =>
  q.audit.run(Date.now(), actor, action, collection ?? null, docId ?? null, summary)
export const auditList = (limit = 100) => q.auditList.all(limit)

function summarize(d: Record<string, unknown> | null) {
  if (!d) return ''
  const s = (d.title ?? d.what ?? d.task ?? d.desc ?? d.subject ?? d.metric ?? d.note ?? d.name ?? '') as string
  return String(s).slice(0, 120)
}

// ─── settings (single doc) ───
export interface Settings {
  founderName: string
  timezone: string
  currency: string
  cashBalance: number
  goals: { metric: string; target: number; unit: string; period: 'month' }[]
  notifications: { morningBrief: boolean; eodRecap: boolean; reminders: boolean; overdue: boolean; briefHour: number; recapHour: number }
  email: { from: string; signature: string }
  location: { city: string; area: string; country: string }
}
export const DEFAULT_SETTINGS: Settings = {
  founderName: 'Ahmed', timezone: 'Asia/Karachi', currency: 'PKR', cashBalance: 1500000,
  goals: [{ metric: 'Revenue', target: 100000, unit: 'PKR', period: 'month' }, { metric: 'Pipeline', target: 20, unit: 'leads', period: 'month' }],
  notifications: { morningBrief: true, eodRecap: true, reminders: true, overdue: true, briefHour: 7, recapHour: 18 },
  email: { from: '', signature: 'Best regards,\nAhmed Babar\nFounder & CEO' },
  location: { city: 'Karachi', area: '', country: 'Pakistan' },
}
export const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...(getDoc<Partial<Settings>>('settings', 'main')?.data ?? {}) })

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
