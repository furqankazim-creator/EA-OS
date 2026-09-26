import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SEED from '@/data'
import type { Assignment, Brief, Client, Conversation, Correction, Decision, EmailDraft, Expense, Extraction, FollowUp, HealthEntry, Invoice, KpiUpdate, Lead, Notification, Playbook, Problem, Recommendation, ServerSettings, StaffMember, Tripwire } from '@/types'
import { syncPush, syncPull, fetchSettings, type Mutation } from '@/services/api'

// ─── State ───

export interface State {
  hydrated: boolean
  conversations: Conversation[]
  decisions: Decision[]
  expenses: Expense[]
  problems: Problem[]
  assignments: Assignment[]
  health: HealthEntry[]
  kpis: KpiUpdate[]
  invoices: Invoice[]
  emails: EmailDraft[]
  notifications: Notification[]
  briefs: Brief[]
  staff: StaffMember[]
  clients: Client[]
  leads: Lead[]
  corrections: Correction[]
  recommendations: Recommendation[]
  playbooks: Playbook[]
  tripwires: Tripwire[]
  lang: string
  autoStop: boolean
  outbox: Mutation[]
  lastSync: number
  serverSettings: ServerSettings | null
}

export type Collection = 'conversations' | 'decisions' | 'expenses' | 'problems' | 'assignments' | 'health' | 'kpis' | 'invoices' | 'emails' | 'notifications' | 'briefs' | 'staff' | 'clients' | 'leads' | 'corrections' | 'recommendations' | 'playbooks' | 'tripwires'
const COLLECTIONS: Collection[] = ['conversations', 'decisions', 'expenses', 'problems', 'assignments', 'health', 'kpis', 'invoices', 'emails', 'notifications', 'briefs', 'staff', 'clients', 'leads', 'corrections', 'recommendations', 'playbooks', 'tripwires']

const initial: State = {
  hydrated: false,
  conversations: SEED.CONVERSATIONS, decisions: SEED.DECISIONS, expenses: SEED.EXPENSES, problems: SEED.PROBLEMS,
  assignments: SEED.ASSIGNMENTS, health: SEED.HEALTH_LOG, kpis: SEED.KPI_UPDATES,
  invoices: [], emails: [], notifications: [], briefs: [], staff: SEED.TEAM, clients: [], leads: [], corrections: [], recommendations: [], playbooks: [], tripwires: [],
  lang: 'en-US', autoStop: false, outbox: [], lastSync: 0, serverSettings: null,
}

type Doc = { id: string; _u?: number }
export type AnyDoc = Conversation | Decision | Expense | Problem | Assignment | HealthEntry | KpiUpdate | Invoice | EmailDraft | Notification | Brief | StaffMember | Client | Lead | Correction | Recommendation | Playbook | Tripwire
const docs = (state: State, c: Collection) => state[c] as unknown as Doc[]
type Action =
  | { type: 'hydrate'; state: Partial<State> }
  | { type: 'put'; collection: Collection; doc: AnyDoc; local?: boolean }
  | { type: 'patch'; collection: Collection; id: string; patch: Record<string, unknown> }
  | { type: 'remove'; collection: Collection; id: string }
  | { type: 'conversation/commit'; id: string; skip?: { commitments: number[]; finance: number[] }; followUps?: FollowUp[] }
  | { type: 'problem/commit'; id: string }
  | { type: 'decision/add'; decisions: Decision[] }
  | { type: 'lang/set'; lang: string }
  | { type: 'autoStop/set'; value: boolean }
  | { type: 'outbox/applied'; keys: string[] }
  | { type: 'sync/apply'; docs: { collection: string; id: string; data: Record<string, unknown>; updated_at: number; deleted: boolean }[]; serverTime: number }
  | { type: 'settings/set'; settings: ServerSettings }
  | { type: 'notifications/readAll' }
  | { type: 'reset' }

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}` }
export const fmtTime = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`
export const fmtDuration = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`

// ─── Generic doc helpers (every write goes to the outbox for sync) ───
function upsert<T extends Doc>(list: T[], doc: T): T[] {
  const i = list.findIndex(x => x.id === doc.id)
  if (i < 0) return [doc, ...list]
  const next = list.slice(); next[i] = doc; return next
}
function put<T extends { id: string }>(state: State, collection: Collection, doc: T, enqueue = true): State {
  const now = Date.now()
  const stamped: Doc = { ...doc, _u: now }
  const list = upsert(docs(state, collection), stamped) as never
  const outbox = enqueue ? [...state.outbox.filter(m => !(m.collection === collection && m.id === doc.id)), { collection, id: doc.id, data: stamped as unknown as Record<string, unknown>, updated_at: now }] : state.outbox
  return { ...state, [collection]: list, outbox }
}
function remove(state: State, collection: Collection, id: string): State {
  const list = docs(state, collection).filter(x => x.id !== id) as never
  return { ...state, [collection]: list, outbox: [...state.outbox.filter(m => !(m.collection === collection && m.id === id)), { collection, id, data: null, updated_at: Date.now() }] }
}

// ─── Dedupe helpers (used by commit) ───
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2)
export function similarity(a: string, b: string) {
  const A = new Set(norm(a)), B = new Set(norm(b))
  if (!A.size || !B.size) return 0
  let inter = 0; A.forEach(w => { if (B.has(w)) inter++ })
  return (2 * inter) / (A.size + B.size)
}

// "Confirm & Auto-Log (Commit)": fan the extraction out into the operational entities.
function commitConversation(state: State, convo: Conversation, skip?: { commitments: number[]; finance: number[] }, followUps?: FollowUp[]): State {
  const ex = convo.extracted
  if (!ex) return state
  const date = fmtDate(convo.createdAt)
  const source = `${fmtTime(convo.createdAt)} conversation`
  const sevToHealth = (t: string): HealthEntry['severity'] => t === 'injury' ? 'medium' : t === 'workout' ? 'good' : 'low'
  let s = state
  ex.decisions.forEach(d => { s = put(s, 'decisions', { id: uid(), type: 'Decision', title: d.title, description: d.description, date, status: 'active', source } satisfies Decision) })
  ex.commitments.forEach((c, i) => { if (!skip?.commitments.includes(i)) s = put(s, 'decisions', { id: uid(), type: 'Commitment', title: c.what, who: c.who, by: c.by, dueAt: c.dueAt, date, status: 'pending', source, sourceQuote: c.source_quote } satisfies Decision) })
  ex.finance.forEach((f, i) => { if (!skip?.finance.includes(i)) s = put(s, 'expenses', { id: uid(), desc: f.description || f.category, amount: f.amount, currency: f.currency || 'PKR', office: f.office_portion ?? f.amount, personal: f.personal_portion ?? 0, category: f.category, date: fmtDateTime(convo.createdAt), dateAt: convo.createdAt, verified: false, auto: true } satisfies Expense) })
  ex.problems.forEach(p => { s = put(s, 'problems', { id: uid(), title: p.title, description: p.description, severity: p.severity, date, status: 'open', analysis: null, source } satisfies Problem) })
  ex.health.forEach(h => { s = put(s, 'health', { id: uid(), date, time: fmtTime(convo.createdAt), type: h.type, note: h.notes, action: h.action_recommended, source: 'conversation', severity: sevToHealth(h.type) } satisfies HealthEntry) })
  ex.kpi_updates.forEach(k => { s = put(s, 'kpis', { id: uid(), metric: k.metric, value: k.value, unit: k.unit, trend: k.trend, date: fmtDateTime(convo.createdAt), dateAt: convo.createdAt, source } satisfies KpiUpdate) })
  ex.instructions.forEach(ins => {
    const who = ins.assigned_to && s.staff.find(m => ins.assigned_to!.toLowerCase().includes(m.name.toLowerCase()))
    if (who) { const due = new Date(convo.createdAt); due.setDate(due.getDate() + 2); s = put(s, 'assignments', { id: uid(), task: ins.text, assignee: who.name, due: fmtDate(due.toISOString()), dueAt: due.toISOString(), status: 'pending', source } satisfies Assignment) }
  })
  ;(ex.leads ?? []).forEach(l => {
    const existing = s.leads.find(x => x.name.toLowerCase() === l.name.toLowerCase())
    s = put(s, 'leads', { id: existing?.id ?? uid(), name: l.name, company: l.company ?? existing?.company, stage: l.stage, value: l.value ?? existing?.value, next_step: l.next_step || existing?.next_step, source: existing?.source ?? source, createdAt: existing?.createdAt ?? convo.createdAt, updatedAt: convo.createdAt } satisfies Lead)
  })
  // Follow-ups: close / delay / cancel existing commitments mentioned in this note.
  ;(followUps ?? []).forEach(f => {
    const d = s.decisions.find(x => x.id === f.id); if (!d) return
    if (f.action === 'completed') s = put(s, 'decisions', { ...d, status: 'completed' })
    else if (f.action === 'cancelled') s = put(s, 'decisions', { ...d, status: 'completed', description: `Cancelled: ${f.evidence}` })
    else if (f.action === 'delayed') s = put(s, 'decisions', { ...d, by: f.new_by ?? d.by, dueAt: undefined, status: 'pending' })
  })
  return put(s, 'conversations', { ...convo, status: 'committed', followUps: (convo.followUps ?? []).map(f => ({ ...f, applied: true })) })
}

function commitProblem(state: State, p: Problem): State {
  if (!p.analysis || p.committed) return state
  const src = `AI Solver: ${p.title}`; const today = fmtDate(new Date().toISOString())
  let s = state
  p.analysis.action_items.forEach(it => { const d = new Date(); d.setDate(d.getDate() + it.deadline_days); d.setHours(18, 0, 0, 0); s = put(s, 'assignments', { id: uid(), task: it.task, assignee: it.assignee, due: fmtDate(d.toISOString()), dueAt: d.toISOString(), status: 'pending', source: src, problemId: p.id } satisfies Assignment) })
  p.analysis.decisions_to_record.forEach(d => { s = put(s, 'decisions', { id: uid(), type: 'Decision', title: d.title, description: d.description, date: today, status: 'active', source: src } satisfies Decision) })
  return put(s, 'problems', { ...p, committed: true, status: 'action_planned' })
}

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'hydrate': return { ...state, ...a.state, hydrated: true }
    case 'put': return put(state, a.collection, a.doc, !a.local)
    case 'patch': { const cur = docs(state, a.collection).find(x => x.id === a.id); return cur ? put(state, a.collection, { ...cur, ...a.patch }) : state }
    case 'remove': return remove(state, a.collection, a.id)
    case 'conversation/commit': { const c = state.conversations.find(x => x.id === a.id); return c && c.status !== 'committed' ? commitConversation(state, c, a.skip, a.followUps) : state }
    case 'problem/commit': { const p = state.problems.find(x => x.id === a.id); return p ? commitProblem(state, p) : state }
    case 'decision/add': { let s = state; a.decisions.forEach(d => { s = put(s, 'decisions', d) }); return s }
    case 'lang/set': return { ...state, lang: a.lang }
    case 'autoStop/set': return { ...state, autoStop: a.value }
    case 'outbox/applied': return { ...state, outbox: state.outbox.filter(m => !a.keys.includes(`${m.collection}:${m.id}:${m.updated_at}`)) }
    case 'settings/set': return { ...state, serverSettings: a.settings }
    case 'notifications/readAll': { let s = state; state.notifications.filter(n => !n.read).forEach(n => { s = put(s, 'notifications', { ...n, read: true }) }); return s }
    case 'sync/apply': {
      let s = state
      for (const d of a.docs) {
        const col = d.collection as Collection
        if (!COLLECTIONS.includes(col)) continue
        const pending = state.outbox.find(m => m.collection === col && m.id === d.id && m.updated_at > d.updated_at)
        if (pending) continue                                   // our newer local change wins until pushed
        const list = docs(s, col)
        if (d.deleted) s = { ...s, [col]: list.filter(x => x.id !== d.id) }
        else { const cur = list.find(x => x.id === d.id); if (!cur || (cur._u ?? 0) <= d.updated_at) s = { ...s, [col]: upsert(list, { ...d.data, id: d.id, _u: d.updated_at } as Doc) } }
      }
      return { ...s, lastSync: a.serverTime }
    }
    case 'reset': return { ...initial, hydrated: true, outbox: seedOutbox() }
  }
}

// First run: push the seed data so the server (and any other device) has it too.
function seedOutbox(): Mutation[] {
  const t = Date.now() - 1
  const out: Mutation[] = []
  for (const c of COLLECTIONS) docs(initial, c).forEach(d => out.push({ collection: c, id: d.id, data: { ...d, _u: t } as unknown as Record<string, unknown>, updated_at: t }))
  return out
}

// ─── Context + persistence + sync ───

const KEY = 'ea-os/state/v3'
const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action>; syncNow: () => Promise<void>; online: boolean } | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [online, setOnline] = useState(true)
  const stateRef = useRef(state); stateRef.current = state
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncing = useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(raw => dispatch({ type: 'hydrate', state: raw ? JSON.parse(raw) : { outbox: seedOutbox() } }))
      .catch(() => dispatch({ type: 'hydrate', state: { outbox: seedOutbox() } }))
  }, [])

  useEffect(() => {
    if (!state.hydrated) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const { hydrated: _h, ...persist } = state
      persist.conversations = persist.conversations.map(c => c.status === 'processing' ? { ...c, status: 'failed', error: 'Interrupted' } : c)
      persist.problems = persist.problems.map(p => p.status === 'analyzing' ? { ...p, status: p.analysis ? 'action_planned' : 'open' } : p)
      AsyncStorage.setItem(KEY, JSON.stringify(persist)).catch(() => {})
    }, 300)
  }, [state])

  const syncNow = async () => {
    if (syncing.current || !stateRef.current.hydrated) return
    syncing.current = true
    try {
      const box = stateRef.current.outbox
      if (box.length) {
        const r = await syncPush(box.slice(0, 200))
        dispatch({ type: 'outbox/applied', keys: box.slice(0, 200).map(m => `${m.collection}:${m.id}:${m.updated_at}`) })
        void r
      }
      const pull = await syncPull(stateRef.current.lastSync)
      dispatch({ type: 'sync/apply', docs: pull.docs, serverTime: pull.serverTime })
      if (!stateRef.current.serverSettings || Math.random() < 0.2) { const s = await fetchSettings(); if (s) dispatch({ type: 'settings/set', settings: s }) }
      setOnline(true)
    } catch { setOnline(false) } finally { syncing.current = false }
  }

  // Sync: after hydrate, whenever the outbox grows, on foreground, and every 30s.
  useEffect(() => { if (state.hydrated) void syncNow() }, [state.hydrated]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.outbox.length) { const t = setTimeout(() => void syncNow(), 800); return () => clearTimeout(t) } }, [state.outbox.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => void syncNow(), 30_000)
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void syncNow() })
    return () => { clearInterval(t); sub.remove() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({ state, dispatch, syncNow, online }), [state, online]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}

export const countItems = (ex: Extraction | null) =>
  ex ? (Object.keys(ex) as (keyof Extraction)[]).filter(k => k !== 'summary').reduce((n, k) => n + (ex[k] as unknown[]).length, 0) : 0
