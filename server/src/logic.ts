// Business computations shared by jobs, routes and the assistant.
import { listDocs, getSettings } from './db.js'

export interface Decision { id: string; type: 'Decision' | 'Commitment'; title: string; who?: string; by?: string; dueAt?: string; date: string; status: string; source: string; description?: string }
export interface Assignment { id: string; task: string; assignee: string; due: string; dueAt: string; status: 'pending' | 'in_progress' | 'done'; source: string }
export interface Expense { id: string; desc: string; amount: number; currency: string; office: number; personal: number; category: string; date: string; dateAt?: string; verified: boolean; auto: boolean }
export interface Kpi { id: string; metric: string; value: number; unit: string; trend: string; date: string; dateAt?: string; source: string }
export interface Problem { id: string; title: string; description: string; severity: string; status: string; date: string; analysis?: unknown; committed?: boolean; source?: string }
export interface Invoice { id: string; number: string; client: string; email?: string; amount: number; currency: string; issuedAt: string; dueAt: string; status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'; description?: string; chaseStage: number; sourceCommitmentId?: string }
export interface Staff { id: string; name: string; role: string; status: string; salary: number; phone?: string; email?: string }
export interface Client { id: string; name: string; email?: string; phone?: string; aliases?: string[] }
export interface Lead { id: string; name: string; company?: string; stage: 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'; value?: number; next_step?: string; source: string; createdAt: string; updatedAt?: string }
export interface Correction { id: string; category: string; action: 'edit' | 'discard'; before: unknown; after: unknown; transcript: string; ts: string }

export const OPEN_STAGES = ['new', 'contacted', 'qualified', 'proposal'] as const
export function pipelineCount(): number {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0)
  return listDocs<Lead>('leads').filter(l => (OPEN_STAGES as readonly string[]).includes(l.stage) || (l.stage === 'won' && new Date(l.updatedAt ?? l.createdAt) >= start)).length
}

// Everything we know about one client, for the profile screen, the Solver and the assistant.
export function clientProfile(idOrName: string) {
  const clients = listDocs<Client>('clients')
  const c = clients.find(x => x.id === idOrName) ?? clients.find(x => x.name.toLowerCase() === idOrName.toLowerCase()) ?? { id: idOrName, name: idOrName, aliases: [] as string[] }
  const names = [c.name, ...(c.aliases ?? [])].map(n => n.toLowerCase()).filter(Boolean)
  const mentions = (t: string) => names.some(n => t.toLowerCase().includes(n))
  const convos = listDocs<{ id: string; createdAt: string; transcript: string; extracted?: { summary?: string } }>('conversations').filter(x => mentions(x.transcript))
    .map(x => ({ id: x.id, at: x.createdAt, summary: x.extracted?.summary ?? x.transcript.slice(0, 160) }))
  const invoices = listDocs<Invoice>('invoices').filter(i => mentions(i.client))
  const commitments = listDocs<Decision>('decisions').filter(d => mentions(d.title) || mentions(d.description ?? ''))
  const problems = listDocs<Problem>('problems').filter(p => mentions(p.title) || mentions(p.description))
  const leads = listDocs<Lead>('leads').filter(l => mentions(l.company ?? '') || mentions(l.name))
  const emails = listDocs<{ id: string; to: string; subject: string; status: string; createdAt: string }>('emails').filter(e => mentions(e.subject) || (c.email && e.to === c.email))
  const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((a, i) => a + i.amount, 0)
  const paid = invoices.filter(i => i.status === 'paid').reduce((a, i) => a + i.amount, 0)
  const timeline = [
    ...convos.map(x => ({ at: x.at, type: 'conversation', text: x.summary })),
    ...invoices.map(i => ({ at: i.issuedAt, type: `invoice ${i.status}`, text: `${i.number} · ${i.amount.toLocaleString()} ${i.currency}` })),
    ...commitments.map(d => ({ at: d.dueAt ?? new Date().toISOString(), type: `${d.type.toLowerCase()} ${d.status}`, text: d.title })),
    ...problems.map(p => ({ at: new Date().toISOString(), type: `problem ${p.status}`, text: p.title })),
    ...emails.map(e => ({ at: e.createdAt, type: `email ${e.status}`, text: e.subject })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  return { client: c, stats: { mentions: convos.length, invoices: invoices.length, outstanding, paid, openCommitments: commitments.filter(d => d.status !== 'completed').length, openProblems: problems.filter(p => p.status !== 'resolved').length, leads: leads.length }, timeline, invoices, commitments, problems, leads }
}
export function clientContextText(text: string): string {
  const hit = listDocs<Client>('clients').find(c => [c.name, ...(c.aliases ?? [])].some(n => n && text.toLowerCase().includes(n.toLowerCase())))
  if (!hit) return ''
  const p = clientProfile(hit.id)
  return `Client profile — ${p.client.name}: ${p.stats.mentions} mentions, outstanding ${p.stats.outstanding.toLocaleString()} PKR, paid ${p.stats.paid.toLocaleString()} PKR, ${p.stats.openCommitments} open commitments, ${p.stats.openProblems} open problems. Recent: ${p.timeline.slice(0, 5).map(t => `[${t.type}] ${t.text}`).join('; ')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (d: Date | string) => { const x = new Date(d); return `${MONTHS[x.getMonth()]} ${x.getDate()}` }
export const fmtDateTime = (d: Date | string) => { const x = new Date(d); return `${fmtDate(x)}, ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}` }
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000)

// Parse the free-text "by" the extractor returns ("Friday", "Sep 22", "EOD", "in 3 days", "next week") into a date.
export function parseDue(by: string | undefined, from = new Date()): Date | null {
  if (!by) return null
  const s = by.trim().toLowerCase()
  const d = new Date(from); d.setHours(18, 0, 0, 0)
  if (/^(today|eod|end of day|tonight)$/.test(s)) return d
  if (/tomorrow/.test(s)) { d.setDate(d.getDate() + 1); return d }
  const inN = s.match(/in (\d+) (day|week)s?/); if (inN) { d.setDate(d.getDate() + Number(inN[1]) * (inN[2] === 'week' ? 7 : 1)); return d }
  if (/next week/.test(s)) { d.setDate(d.getDate() + 7); return d }
  if (/end of (the )?month/.test(s)) { d.setMonth(d.getMonth() + 1, 0); return d }
  const dow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].findIndex(x => s.includes(x))
  if (dow >= 0) { let diff = (dow - d.getDay() + 7) % 7; if (diff === 0) diff = 7; if (s.includes('next')) diff += 7; d.setDate(d.getDate() + diff); return d }
  const md = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/)
  if (md) { const m = MONTHS.findIndex(x => x.toLowerCase() === md[1]); const y = md[3] ? Number(md[3]) : from.getFullYear(); const r = new Date(y, m, Number(md[2]), 18); if (!md[3] && r < startOfDay(from)) r.setFullYear(y + 1); return r }
  const dm = s.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)
  if (dm) { const m = MONTHS.findIndex(x => x.toLowerCase() === dm[2]); const r = new Date(from.getFullYear(), m, Number(dm[1]), 18); if (r < startOfDay(from)) r.setFullYear(from.getFullYear() + 1); return r }
  const iso = s.match(/\d{4}-\d{2}-\d{2}/); if (iso) return new Date(iso[0] + 'T18:00:00')
  return null
}

export function openCommitments(): Decision[] {
  return listDocs<Decision>('decisions').filter(d => d.type === 'Commitment' && d.status !== 'completed')
}
export function openAssignments(): Assignment[] {
  return listDocs<Assignment>('assignments').filter(a => a.status !== 'done')
}

// ─── KPI / escalation ───
export function latestKpi(metric: string): Kpi | null {
  const rows = listDocs<Kpi>('kpis').filter(k => k.metric.toLowerCase() === metric.toLowerCase())
  rows.sort((a, b) => new Date(b.dateAt ?? 0).getTime() - new Date(a.dateAt ?? 0).getTime())
  return rows[0] ?? null
}
export function kpiHistory(metric: string, days = 7): { day: string; value: number | null }[] {
  const rows = listDocs<Kpi>('kpis').filter(k => k.metric.toLowerCase() === metric.toLowerCase() && k.dateAt).sort((a, b) => a.dateAt!.localeCompare(b.dateAt!))
  const out: { day: string; value: number | null }[] = []
  let last: number | null = null
  for (let i = days - 1; i >= 0; i--) {
    const d = startOfDay(); d.setDate(d.getDate() - i)
    const end = new Date(d); end.setDate(end.getDate() + 1)
    const inDay = rows.filter(r => { const t = new Date(r.dateAt!); return t >= d && t < end })
    if (inDay.length) last = inDay[inDay.length - 1].value
    out.push({ day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], value: last })
  }
  return out
}

export interface Escalation { level: 1 | 2 | 3 | 4; label: string; metric: string; actual: number; target: number; pct: number; daysLeft: number; forecast: number; gap: number; tone: string }
export function escalation(metric = 'Revenue'): Escalation {
  const s = getSettings()
  const goal = s.goals.find(g => g.metric.toLowerCase() === metric.toLowerCase()) ?? { metric, target: 100000, unit: 'PKR', period: 'month' as const }
  const k = latestKpi(metric)
  const leadsCount = /pipeline|leads/i.test(metric) ? pipelineCount() : 0
  const actual = leadsCount > 0 || (/pipeline|leads/i.test(metric) && listDocs('leads').length) ? leadsCount : (k?.value ?? 0)
  const now = new Date()
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const daysLeft = dim - dayOfMonth
  const pct = goal.target ? actual / goal.target : 0
  const expectedPct = dayOfMonth / dim                     // where we "should" be if linear
  const forecast = dayOfMonth ? Math.round((actual / dayOfMonth) * dim) : actual
  const behind = expectedPct - pct                           // >0 means behind pace
  let level: Escalation['level'] = 1
  if (behind > 0.05 || forecast < goal.target * 0.95) level = 2
  if (behind > 0.15 || forecast < goal.target * 0.8) level = 3
  if (behind > 0.3 || (daysLeft <= 7 && pct < 0.7)) level = 4
  const label = ['', 'ON TRACK', 'SLIGHTLY BEHIND', 'MATERIALLY BEHIND', 'CRITICAL'][level]
  const tone = ['', 'calm and brief', 'encouraging but direct', 'urgent, ask for a concrete plan', 'blunt, escalate: demand decisions today'][level]
  return { level, label, metric: goal.metric, actual, target: goal.target, pct: Math.round(pct * 100), daysLeft, forecast, gap: Math.max(0, goal.target - actual), tone }
}

// ─── Finance ───
export function burnAndRunway() {
  const s = getSettings()
  const since = new Date(); since.setDate(since.getDate() - 30)
  const exp = listDocs<Expense>('expenses')
  const last30 = exp.filter(e => e.dateAt ? new Date(e.dateAt) >= since : true).reduce((a, e) => a + (e.office ?? e.amount), 0)
  const payroll = listDocs<Staff>('staff').filter(x => x.status !== 'left').reduce((a, x) => a + (x.salary ?? 0), 0)
  const burn = last30 + payroll
  const runwayMonths = burn > 0 ? +(s.cashBalance / burn).toFixed(1) : Infinity
  const receivables = listDocs<Invoice>('invoices').filter(i => i.status === 'sent' || i.status === 'overdue').reduce((a, i) => a + i.amount, 0)
  return { last30Expenses: last30, payroll, burn, cash: s.cashBalance, runwayMonths, receivables }
}

// ─── Snapshot for briefs / assistant ───
export function snapshot() {
  const today = startOfDay(); const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const cm = openCommitments().map(c => ({ ...c, dueAt: c.dueAt ?? parseDue(c.by)?.toISOString() }))
  const asg = openAssignments()
  const dueToday = [...cm.filter(c => c.dueAt && daysBetween(today, new Date(c.dueAt)) === 0), ...asg.filter(a => daysBetween(today, new Date(a.dueAt)) === 0)]
  const overdue = [...cm.filter(c => c.dueAt && new Date(c.dueAt) < today), ...asg.filter(a => new Date(a.dueAt) < today)]
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const spentYesterday = listDocs<Expense>('expenses').filter(e => e.dateAt && new Date(e.dateAt) >= yesterday && new Date(e.dateAt) < today).reduce((a, e) => a + e.amount, 0)
  const problems = listDocs<Problem>('problems').filter(p => p.status !== 'resolved')
  const invoices = listDocs<Invoice>('invoices').filter(i => i.status === 'overdue' || i.status === 'sent')
  return { esc: escalation('Revenue'), dueToday, overdue, spentYesterday, openProblems: problems, invoices, finance: burnAndRunway(), settings: getSettings() }
}
