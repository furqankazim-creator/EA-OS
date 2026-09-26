// Deterministic 13-week cash-flow model. Pure math over the DB — no LLM.
// Scenarios differ by lead conversion, collection speed and cost deltas; the Solver uses the same
// engine to compare candidate plans by projected cash instead of by opinion.
import { listDocs, getSettings } from './db.js'
import { type Invoice, type Lead, type Expense, type Staff, startOfDay } from './logic.js'

export interface ScenarioParams {
  name: string
  conversion: number          // probability a proposal-stage lead closes within the horizon (0..1)
  qualifiedConversion: number // for qualified/contacted leads
  newLeadsPerWeek: number     // fresh leads entering the pipeline
  avgDealValue: number        // PKR, used when a lead has no value
  collectionDelayDays: number // days after invoice due until cash actually arrives
  collectionRate: number      // share of overdue receivables that eventually get paid in horizon
  weeklyCostDelta: number     // +/- PKR per week (e.g. new hire, ads)
  oneOffCash: number          // +/- PKR at week 1 (e.g. early-payment discount, loan)
}
export interface WeekPoint { week: number; startsAt: string; inflow: number; outflow: number; cash: number; revenue: number; cumulativeRevenue: number }
export interface Forecast { scenario: string; params: ScenarioParams; weeks: WeekPoint[]; minCash: number; minCashWeek: number; endCash: number; revenue90: number; runwayWeeks: number | null; shortfallWeek: number | null }

const STAGE_P: Record<string, number> = { new: 0.05, contacted: 0.12, qualified: 0.3, proposal: 0.55, won: 1, lost: 0 }

export function baseParams(overrides: Partial<ScenarioParams> = {}): ScenarioParams {
  const leads = listDocs<Lead>('leads')
  const values = leads.filter(l => l.value).map(l => l.value!)
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 150000
  const recentLeads = leads.filter(l => Date.now() - new Date(l.createdAt).getTime() < 28 * 86_400_000).length
  return {
    name: 'base', conversion: 0.5, qualifiedConversion: 0.25, newLeadsPerWeek: Math.max(1, Math.round(recentLeads / 4)),
    avgDealValue: Math.round(avg), collectionDelayDays: 14, collectionRate: 0.7, weeklyCostDelta: 0, oneOffCash: 0, ...overrides,
  }
}

export function forecast(params: ScenarioParams, weeksAhead = 13): Forecast {
  const s = getSettings()
  const today = startOfDay()
  const weekStart = (w: number) => { const d = new Date(today); d.setDate(d.getDate() + w * 7); return d }
  const inWeek = (date: Date, w: number) => date >= weekStart(w) && date < weekStart(w + 1)

  // Fixed outflows: payroll (monthly, assume last day of month) + average weekly expenses (office share, last 60 days)
  const payroll = listDocs<Staff>('staff').filter(x => x.status !== 'left').reduce((a, x) => a + (x.salary ?? 0), 0)
  const since = new Date(today); since.setDate(since.getDate() - 60)
  const exp = listDocs<Expense>('expenses').filter(e => e.dateAt && new Date(e.dateAt) >= since)
  const weeklyExpenses = exp.reduce((a, e) => a + (e.office ?? e.amount), 0) / (60 / 7)

  // Receivables: sent/overdue invoices arrive at due + delay (overdue ones at collectionRate)
  const invoices = listDocs<Invoice>('invoices').filter(i => i.status === 'sent' || i.status === 'overdue')
  const receivableEvents = invoices.map(i => {
    const arrive = new Date(i.dueAt); arrive.setDate(arrive.getDate() + params.collectionDelayDays)
    if (arrive < today) arrive.setTime(today.getTime() + 7 * 86_400_000)
    const overdue = new Date(i.dueAt) < today
    return { at: arrive, amount: i.amount * (overdue ? params.collectionRate : 0.95) }
  })

  // Pipeline: each open lead closes with stage-based probability, revenue lands after a sales cycle then collection delay
  const leads = listDocs<Lead>('leads').filter(l => l.stage !== 'won' && l.stage !== 'lost')
  const cycleDays: Record<string, number> = { new: 42, contacted: 35, qualified: 28, proposal: 14 }
  const leadEvents = leads.map(l => {
    const p = l.stage === 'proposal' ? params.conversion : l.stage === 'qualified' ? params.qualifiedConversion : STAGE_P[l.stage] ?? 0.1
    const at = new Date(today); at.setDate(at.getDate() + (cycleDays[l.stage] ?? 30) + params.collectionDelayDays)
    return { at, amount: (l.value ?? params.avgDealValue) * p, revenueAt: new Date(at.getTime() - params.collectionDelayDays * 86_400_000) }
  })
  // New leads: enter weekly, convert at a blended rate ~6 weeks later
  const newLeadEvents: { at: Date; amount: number; revenueAt: Date }[] = []
  for (let w = 0; w < weeksAhead; w++) {
    const at = new Date(weekStart(w)); at.setDate(at.getDate() + 42 + params.collectionDelayDays)
    newLeadEvents.push({ at, amount: params.newLeadsPerWeek * params.avgDealValue * 0.15, revenueAt: new Date(at.getTime() - params.collectionDelayDays * 86_400_000) })
  }

  let cash = s.cashBalance + params.oneOffCash
  let cumRev = 0
  const weeks: WeekPoint[] = []
  for (let w = 0; w < weeksAhead; w++) {
    const ws = weekStart(w)
    const monthEndInWeek = [0, 1, 2, 3, 4, 5, 6].some(d => { const x = new Date(ws); x.setDate(ws.getDate() + d); const next = new Date(x); next.setDate(x.getDate() + 1); return next.getDate() === 1 })
    const inflow = [...receivableEvents, ...leadEvents, ...newLeadEvents].filter(e => inWeek(e.at, w)).reduce((a, e) => a + e.amount, 0)
    const revenue = [...leadEvents, ...newLeadEvents].filter(e => inWeek(e.revenueAt, w)).reduce((a, e) => a + e.amount, 0) + (w === 0 ? 0 : 0)
    const outflow = weeklyExpenses + params.weeklyCostDelta + (monthEndInWeek ? payroll : 0)
    cash += inflow - outflow; cumRev += revenue
    weeks.push({ week: w + 1, startsAt: ws.toISOString(), inflow: Math.round(inflow), outflow: Math.round(outflow), cash: Math.round(cash), revenue: Math.round(revenue), cumulativeRevenue: Math.round(cumRev) })
  }
  const min = weeks.reduce((m, p) => p.cash < m.cash ? p : m, weeks[0])
  const shortfall = weeks.find(p => p.cash < 0)
  const burnPerWeek = weeklyExpenses + params.weeklyCostDelta + payroll / 4.33
  return {
    scenario: params.name, params, weeks, minCash: min.cash, minCashWeek: min.week, endCash: weeks[weeks.length - 1].cash,
    revenue90: cumRev, runwayWeeks: burnPerWeek > 0 ? Math.round((s.cashBalance / burnPerWeek) * 10) / 10 : null, shortfallWeek: shortfall?.week ?? null,
  }
}

export function standardScenarios(): Forecast[] {
  return [
    forecast(baseParams({ name: 'pessimistic', conversion: 0.3, qualifiedConversion: 0.12, collectionDelayDays: 30, collectionRate: 0.5, newLeadsPerWeek: Math.max(0, baseParams().newLeadsPerWeek - 1) })),
    forecast(baseParams({ name: 'base' })),
    forecast(baseParams({ name: 'optimistic', conversion: 0.7, qualifiedConversion: 0.4, collectionDelayDays: 7, collectionRate: 0.9, newLeadsPerWeek: baseParams().newLeadsPerWeek + 2 })),
  ]
}

// A plan expressed as parameter deltas (the Solver asks the LLM for these) → its own forecast.
export interface PlanDelta { name: string; conversionDelta?: number; newLeadsPerWeekDelta?: number; collectionDelayDelta?: number; weeklyCostDelta?: number; oneOffCash?: number; assumptions?: string[] }
export function simulatePlan(d: PlanDelta): Forecast {
  const b = baseParams()
  return forecast({ ...b, name: d.name, conversion: Math.min(0.95, Math.max(0.05, b.conversion + (d.conversionDelta ?? 0))), qualifiedConversion: Math.min(0.9, Math.max(0.02, b.qualifiedConversion + (d.conversionDelta ?? 0) / 2)),
    newLeadsPerWeek: Math.max(0, b.newLeadsPerWeek + (d.newLeadsPerWeekDelta ?? 0)), collectionDelayDays: Math.max(0, b.collectionDelayDays + (d.collectionDelayDelta ?? 0)), weeklyCostDelta: d.weeklyCostDelta ?? 0, oneOffCash: d.oneOffCash ?? 0 })
}
export const fmtForecast = (f: Forecast) => `${f.scenario}: cash low ${f.minCash.toLocaleString()} in week ${f.minCashWeek}${f.shortfallWeek ? ` — NEGATIVE from week ${f.shortfallWeek}` : ''}, ends at ${f.endCash.toLocaleString()}, revenue over 13 weeks ${Math.round(f.revenue90).toLocaleString()}`
