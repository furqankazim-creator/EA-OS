// Operating metrics that actually measure whether EA-OS is working (replaces DAU/NPS-style vanity metrics).
import { listDocs } from './db.js'
import { startOfDay, type Decision, type Assignment, type Invoice, type Problem } from './logic.js'

export function metrics(days = 30) {
  const since = new Date(); since.setDate(since.getDate() - days)
  const t = (iso?: string) => iso ? new Date(iso) : null
  const convos = listDocs<{ createdAt: string; status: string; extracted?: unknown }>('conversations').filter(c => t(c.createdAt)! >= since)
  const corrections = listDocs<{ ts: string }>('corrections').filter(c => t(c.ts)! >= since)
  const workdays = Math.max(1, Math.round(days * 5 / 7))
  const commitments = listDocs<Decision>('decisions').filter(d => d.type === 'Commitment' && d.dueAt)
  const closed = commitments.filter(d => d.status === 'completed')
  const dueSoFar = commitments.filter(d => t(d.dueAt)! < startOfDay())
  const onTime = dueSoFar.filter(d => d.status === 'completed').length
  const problems = listDocs<Problem & { committed?: boolean; outcome?: string; analysis?: { generated_at?: string }; _u?: number }>('problems')
  const adopted = problems.filter(p => p.committed && p.analysis?.generated_at)
  const adopted30 = adopted.filter(p => Date.now() - t(p.analysis!.generated_at)!.getTime() > 30 * 86_400_000)
  const withOutcome = adopted30.filter(p => p.outcome)
  const highs = problems.filter(p => p.severity === 'high' && p.analysis?.generated_at)
  const hoursToPlan = highs.length ? highs.reduce((a, p) => a + Math.max(0, (t(p.analysis!.generated_at)!.getTime() - (p._u ?? t(p.analysis!.generated_at)!.getTime())) / 3_600_000), 0) / highs.length : 0
  const inv = listDocs<Invoice>('invoices')
  const over30 = inv.filter(i => i.status === 'overdue' && (Date.now() - t(i.dueAt)!.getTime()) > 30 * 86_400_000).reduce((a, i) => a + i.amount, 0)
  const asg = listDocs<Assignment>('assignments')
  const autoLogged = listDocs<Decision>('decisions').filter(d => t((d as Decision & { _u?: number })._u ? new Date((d as Decision & { _u?: number })._u!).toISOString() : undefined)! >= since).length
    + listDocs<{ _u?: number }>('expenses').filter(e => e._u && e._u >= since.getTime()).length + asg.filter(a => (a as Assignment & { _u?: number })._u! >= since.getTime()).length
  return {
    notes_per_workday: +(convos.length / workdays).toFixed(1),
    corrections_per_note: convos.length ? +(corrections.length / convos.length).toFixed(2) : 0,
    commitments_on_time_pct: dueSoFar.length ? Math.round(100 * onTime / dueSoFar.length) : 100,
    commitments_closed: closed.length,
    plans_with_outcome_pct: adopted30.length ? Math.round(100 * withOutcome.length / adopted30.length) : 0,
    plans_worked: problems.filter(p => p.outcome === 'worked').length,
    avg_hours_problem_to_plan_high: +hoursToPlan.toFixed(1),
    receivables_over_30d: over30,
    team_tasks_done_pct: asg.length ? Math.round(100 * asg.filter(a => a.status === 'done').length / asg.length) : 0,
    entities_auto_logged: autoLogged,
    est_hours_saved: +((autoLogged * 2) / 60).toFixed(1),
  }
}

// Decision quality (0-100) per adopted plan: timeliness, evidence, execution, outcome.
export function decisionQuality(p: Problem & { committed?: boolean; outcome?: string; analysis?: { generated_at?: string; scenarios?: unknown[]; disagreements?: string[] }; _u?: number; createdAtTs?: number }) {
  if (!p.analysis?.generated_at) return null
  const asg = listDocs<Assignment & { problemId?: string }>('assignments').filter(a => a.problemId === p.id)
  const timeliness = Math.max(0, 100 - Math.round(((Date.now() - new Date(p.analysis.generated_at).getTime()) / 86_400_000) * (p.committed ? 0 : 10)))
  const evidence = (p.analysis.scenarios?.length ? 60 : 20) + (p.analysis.disagreements?.length ? 40 : 0)
  const execution = asg.length ? Math.round(100 * asg.filter(a => a.status === 'done').length / asg.length) : 0
  const outcome = p.outcome === 'worked' ? 100 : p.outcome === 'partial' ? 50 : p.outcome === 'failed' ? 0 : null
  const parts = [timeliness, evidence, execution, ...(outcome === null ? [] : [outcome])]
  return { timeliness, evidence, execution, outcome, score: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) }
}
