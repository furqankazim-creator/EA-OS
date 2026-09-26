import { register, schedule, atHour, weeklyAt, monthlyOn, everyMinutes, enqueue, cancelJobs } from './engine.js'
import { listDocs, getDoc, patchDoc, putDoc, uid, getSettings } from '../db.js'
import { notify } from '../notify.js'
import { chat } from '../llm.js'
import { snapshot, escalation, burnAndRunway, fmtDate, fmtDateTime, daysBetween, startOfDay, parseDue, kpiHistory, type Decision, type Assignment, type Invoice, type Problem, type Expense, type Client, type Correction } from '../logic.js'
import { draftWithLLM } from '../emails.js'
import { analyzeChallenge } from '../routes/challenges.js'

const s = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// ─── Morning brief (07:30 default) ───
register('morning_brief', async () => {
  const snap = snapshot()
  const p = snap.settings.notifications
  const lines = [
    `Revenue: ${snap.esc.actual.toLocaleString()} / ${snap.esc.target.toLocaleString()} ${snap.settings.currency} (${snap.esc.pct}%) — ${snap.esc.label}, ${snap.esc.daysLeft} days left, forecast ${snap.esc.forecast.toLocaleString()}.`,
    `Due today: ${snap.dueToday.length ? snap.dueToday.map(x => ('task' in x ? `${x.task} (${x.assignee})` : `${x.title} (${x.who ?? 'me'})`)).join('; ') : 'nothing'}.`,
    `Overdue: ${snap.overdue.length ? snap.overdue.map(x => ('task' in x ? `${x.task} (${x.assignee})` : `${x.title} (${x.who ?? 'me'})`)).join('; ') : 'none'}.`,
    `Spent yesterday: ${snap.spentYesterday.toLocaleString()} ${snap.settings.currency}.`,
    `Open problems: ${snap.openProblems.slice(0, 3).map(x => `${x.title} [${x.severity}]`).join('; ') || 'none'}.`,
    `Receivables outstanding: ${snap.finance.receivables.toLocaleString()} across ${snap.invoices.length} invoices. Runway ${snap.finance.runwayMonths} months.`,
  ]
  const brief = await chat({
    system: `You are ${snap.settings.founderName}'s executive assistant writing a morning brief. Tone: ${snap.esc.tone}. Max 120 words, plain text, no markdown, no greeting fluff. Lead with the single most important thing. End with one question that forces a decision today.`,
    user: lines.join('\n'), temperature: 0.4,
  })
  const doc = { id: uid(), kind: 'morning', ts: new Date().toISOString(), text: brief.trim(), facts: lines, escalation: snap.esc }
  putDoc('briefs', doc.id, doc)
  if (p.morningBrief) await notify({ kind: 'morning_brief', title: `Morning brief — ${snap.esc.label}`, body: brief.trim(), link: { tab: 'home' } })
  return `brief ${doc.id}`
})
schedule({ kind: 'morning_brief', next: from => atHour(getSettings().notifications.briefHour, 30)(from) })

// ─── End-of-day recap (18:30 default) ───
register('eod_recap', async () => {
  const today = startOfDay()
  const convos = listDocs<{ createdAt: string; status: string; extracted?: { summary?: string } }>('conversations').filter(c => new Date(c.createdAt) >= today)
  const uncommitted = convos.filter(c => c.status === 'extracted')
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const snap = snapshot()
  const dueTomorrow = [...snap.dueToday.length ? [] : [], ...listDocs<Assignment>('assignments').filter(a => a.status !== 'done' && daysBetween(tomorrow, new Date(a.dueAt)) === 0)]
  const body = [
    `${s(convos.length, 'conversation')} captured today${uncommitted.length ? `, ${uncommitted.length} still waiting for your review/commit` : ''}.`,
    dueTomorrow.length ? `Due tomorrow: ${dueTomorrow.map(a => `${a.task} (${a.assignee})`).join('; ')}.` : 'Nothing due tomorrow.',
    snap.overdue.length ? `${s(snap.overdue.length, 'item')} overdue.` : '',
  ].filter(Boolean).join(' ')
  await notify({ kind: 'eod_recap', title: 'End of day', body, link: { tab: uncommitted.length ? 'extract' : 'home' } })
  return body
})
schedule({ kind: 'eod_recap', next: from => atHour(getSettings().notifications.recapHour, 30)(from) })

// ─── Reminders for commitments/assignments (T-2, T-0 09:00, T+1) ───
export function scheduleReminders(kind: 'decision' | 'assignment', id: string, title: string, who: string | undefined, dueAt: Date) {
  cancelJobs(`rem:${id}:`)
  const mk = (offsetDays: number, hour: number, label: string) => {
    const at = new Date(dueAt); at.setDate(at.getDate() + offsetDays); at.setHours(hour, 0, 0, 0)
    if (at > new Date()) enqueue('reminder', at, { kind, id, title, who, label, dueAt: dueAt.toISOString() }, `rem:${id}:${label}`)
  }
  mk(-2, 9, 'T-2'); mk(0, 9, 'T-0'); mk(1, 9, 'T+1')
}
register('reminder', async p => {
  const { kind, id, title, who, label } = p as { kind: string; id: string; title: string; who?: string; label: string }
  const doc = kind === 'assignment' ? getDoc<Assignment>('assignments', id)?.data : getDoc<Decision>('decisions', id)?.data
  if (!doc) return 'gone'
  const status = 'status' in doc ? doc.status : ''
  if (status === 'done' || status === 'completed') return 'already done'
  const msg = label === 'T-2' ? `Due in 2 days: ${title}${who ? ` — ${who}` : ''}` : label === 'T-0' ? `Due today: ${title}${who ? ` — ${who}` : ''}` : `OVERDUE: ${title}${who ? ` — ${who}` : ''}`
  if (label === 'T+1' && kind === 'decision') patchDoc('decisions', id, { status: 'overdue' })
  await notify({ kind: label === 'T+1' ? 'overdue' : 'reminder', title: label === 'T+1' ? 'Overdue' : 'Reminder', body: msg, link: { tab: kind === 'assignment' ? 'ops' : 'decisions', id } })
  return msg
})

// ─── Hourly overdue scan ───
register('overdue_scan', async () => {
  const today = startOfDay()
  let n = 0
  for (const d of listDocs<Decision>('decisions')) {
    if (d.type !== 'Commitment' || d.status === 'completed' || d.status === 'overdue') continue
    const due = d.dueAt ? new Date(d.dueAt) : parseDue(d.by)
    if (due && due < today) { patchDoc('decisions', d.id, { status: 'overdue', dueAt: due.toISOString() }); n++ }
  }
  return `${n} newly overdue`
})
schedule({ kind: 'overdue_scan', next: everyMinutes(60) })

// ─── Escalation check (every 3h): notify when level rises ───
register('escalation_check', async () => {
  const esc = escalation('Revenue')
  const prev = getDoc<{ level: number }>('settings', 'escalation')?.data.level ?? 1
  putDoc('settings', 'escalation', { ...esc, at: new Date().toISOString() })
  if (esc.level > prev && esc.level >= 3) {
    await notify({ kind: 'escalation', title: `Escalation level ${esc.level} — ${esc.label}`, body: `${esc.metric} ${esc.actual.toLocaleString()} of ${esc.target.toLocaleString()}, forecast ${esc.forecast.toLocaleString()}, ${esc.daysLeft} days left. What's the plan?`, link: { tab: 'kpi' } })
    if (esc.level === 4) enqueue('analyze_problem', Date.now(), { title: `${esc.metric} critical: ${esc.actual.toLocaleString()} of ${esc.target.toLocaleString()} with ${esc.daysLeft} days left`, description: `Forecast ${esc.forecast.toLocaleString()}. Gap ${esc.gap.toLocaleString()}.`, severity: 'high', create: true }, `esc:${esc.level}:${new Date().toDateString()}`)
  }
  return `level ${prev} → ${esc.level}`
})
schedule({ kind: 'escalation_check', next: everyMinutes(180) })

// ─── Runway check (daily 08:00) ───
register('runway_check', async () => {
  const f = burnAndRunway()
  if (f.runwayMonths < 3) {
    const exists = listDocs<Problem>('problems').some(p => p.status !== 'resolved' && /runway/i.test(p.title))
    if (!exists) {
      const p: Problem = { id: uid(), title: `Runway below 3 months (${f.runwayMonths} mo)`, description: `Cash ${f.cash.toLocaleString()}, monthly burn ${f.burn.toLocaleString()} (expenses ${f.last30Expenses.toLocaleString()} + payroll ${f.payroll.toLocaleString()}). Receivables ${f.receivables.toLocaleString()}.`, severity: 'high', status: 'open', date: fmtDate(new Date()), source: 'Runway check' }
      putDoc('problems', p.id, p as unknown as Record<string, unknown>)
      enqueue('analyze_problem', Date.now(), { id: p.id }, `analyze:${p.id}`)
      await notify({ kind: 'finance', title: 'Runway warning', body: p.description, link: { tab: 'problems', id: p.id } })
    }
  }
  return `runway ${f.runwayMonths} mo`
})
schedule({ kind: 'runway_check', next: atHour(8) })

// ─── Analyze a problem (used by events + escalation) ───
register('analyze_problem', async p => {
  let id = p.id as string | undefined
  if (!id && p.create) {
    const doc: Problem = { id: uid(), title: String(p.title), description: String(p.description ?? ''), severity: String(p.severity ?? 'high'), status: 'open', date: fmtDate(new Date()), source: 'Automation' }
    putDoc('problems', doc.id, doc as unknown as Record<string, unknown>); id = doc.id
  }
  const prob = id ? getDoc<Problem>('problems', id)?.data : null
  if (!prob) return 'no problem'
  if (prob.analysis) return 'already analyzed'
  patchDoc('problems', prob.id, { status: 'analyzing' })
  try {
    const analysis = await analyzeChallenge({ title: prob.title, description: prob.description, severity: prob.severity })
    patchDoc('problems', prob.id, { status: 'open', analysis })
    await notify({ kind: 'solver', title: `AI Solver: ${prob.title}`, body: `Root cause: ${analysis.root_cause}`, link: { tab: 'problems', id: prob.id } })
  } catch (e) { patchDoc('problems', prob.id, { status: 'open', error: (e as Error).message }); throw e }
  return `analyzed ${prob.id}`
})

// ─── Weekly pipeline prompt (Mon 09:00) ───
register('weekly_pipeline', async () => {
  const pipe = escalation('Pipeline')
  if (pipe.pct < 60) {
    await notify({ kind: 'kpi', title: 'Weekly pipeline review', body: `${pipe.actual} of ${pipe.target} leads (${pipe.pct}%). Run the Solver on pipeline?`, link: { tab: 'problems' } })
    return 'prompted'
  }
  return 'pipeline healthy'
})
schedule({ kind: 'weekly_pipeline', next: weeklyAt(1, 9) })

// ─── Weekly investor update draft (Fri 16:00) ───
register('investor_update', async () => {
  const snap = snapshot()
  const to = process.env.INVESTOR_LIST_EMAIL ?? 'investors@list.com'
  const hist = kpiHistory('Revenue', 7).map(h => h.value ?? '-').join(', ')
  const doneThisWeek = listDocs<Assignment>('assignments').filter(a => a.status === 'done').slice(0, 5).map(a => a.task)
  const e = await draftWithLLM('investor_update', to,
    `Draft the weekly investor update for the week ending ${fmtDate(new Date())}.\nRevenue: ${snap.esc.actual.toLocaleString()} of ${snap.esc.target.toLocaleString()} ${snap.settings.currency} (${snap.esc.pct}%), forecast ${snap.esc.forecast.toLocaleString()}. Daily revenue points: ${hist}.\nShipped this week: ${doneThisWeek.join('; ') || 'n/a'}.\nOpen problems: ${snap.openProblems.map(p => `${p.title} [${p.severity}]`).join('; ') || 'none'}.\nReceivables outstanding: ${snap.finance.receivables.toLocaleString()}.\n${snap.esc.level >= 3 ? 'Include a short mitigation plan for the revenue shortfall.' : ''}\nKeep it under 180 words, factual, no hype.`)
  await notify({ kind: 'email', title: 'Investor update drafted', body: `"${e.subject}" is waiting for your approval in Ops › Email.`, link: { tab: 'ops', id: e.id } })
  return `draft ${e.id}`
})
schedule({ kind: 'investor_update', next: weeklyAt(5, 16) })

// ─── Monthly close (1st 09:00) ───
register('monthly_close', async () => {
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - 1, 1); const end = new Date(now.getFullYear(), now.getMonth(), 1)
  const exp = listDocs<Expense>('expenses').filter(e => e.dateAt && new Date(e.dateAt) >= start && new Date(e.dateAt) < end)
  const byCat = exp.reduce<Record<string, number>>((m, e) => { m[e.category] = (m[e.category] ?? 0) + e.amount; return m }, {})
  const office = exp.reduce((a, e) => a + e.office, 0), personal = exp.reduce((a, e) => a + e.personal, 0)
  const f = burnAndRunway()
  const body = `${start.toLocaleString('en-US', { month: 'long' })}: ${exp.reduce((a, e) => a + e.amount, 0).toLocaleString()} spent — office ${office.toLocaleString()} / personal ${personal.toLocaleString()}. ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `${c} ${v.toLocaleString()}`).join(', ')}. Payroll ${f.payroll.toLocaleString()} due. Runway ${f.runwayMonths} mo.`
  putDoc('briefs', uid(), { id: uid(), kind: 'monthly_close', ts: new Date().toISOString(), text: body, byCat, office, personal })
  await notify({ kind: 'finance', title: 'Monthly close', body, link: { tab: 'finance' } })
  return body
})
schedule({ kind: 'monthly_close', next: monthlyOn(1, 9) })

// ─── Invoice chasing sequence (daily 10:00): +1 reminder, +7 second reminder, +14 demand notice, +30 → high-severity problem ───
register('invoice_chase', async () => {
  const today = startOfDay()
  let n = 0
  for (const inv of listDocs<Invoice>('invoices')) {
    if (inv.status !== 'sent' && inv.status !== 'overdue') continue
    const late = daysBetween(new Date(inv.dueAt), today)
    if (late < 1) continue
    if (inv.status === 'sent') patchDoc('invoices', inv.id, { status: 'overdue' })
    const stage = inv.chaseStage ?? 0
    const next = late >= 30 ? 4 : late >= 14 ? 3 : late >= 7 ? 2 : 1
    if (next <= stage) continue
    const client = listDocs<Client>('clients').find(c => c.name.toLowerCase() === inv.client.toLowerCase())
    const to = inv.email || client?.email || ''
    const label = ['', 'friendly reminder', 'second reminder', 'formal demand notice', 'escalation'][next]
    if (next <= 3) {
      const e = await draftWithLLM(next === 3 ? 'invoice_demand' : 'invoice_reminder', to || 'accounts@client.example',
        `Write a ${label} for invoice ${inv.number} to ${inv.client}: ${inv.amount.toLocaleString()} ${inv.currency}, due ${fmtDate(inv.dueAt)}, now ${late} days overdue. ${inv.description ? `Work: ${inv.description}.` : ''} ${next === 3 ? 'State that further delay will pause ongoing work and may incur late fees; ask for payment within 5 business days.' : 'Ask for payment or a payment date.'}`, inv.id, 'invoice_chase')
      await notify({ kind: 'email', title: `${inv.client}: ${label} drafted`, body: `Invoice ${inv.number} is ${late} days overdue. Approve the email in Ops › Email.`, link: { tab: 'ops', id: e.id } })
    } else {
      const p: Problem = { id: uid(), title: `${inv.client} invoice ${inv.number} 30+ days overdue (${inv.amount.toLocaleString()} ${inv.currency})`, description: `Three reminders sent. ${late} days late. Decide: legal notice, pause work, or negotiate a payment plan.`, severity: 'high', status: 'open', date: fmtDate(new Date()), source: 'Invoice chase' }
      putDoc('problems', p.id, p as unknown as Record<string, unknown>)
      enqueue('analyze_problem', Date.now(), { id: p.id }, `analyze:${p.id}`)
      await notify({ kind: 'finance', title: `Receivable escalated: ${inv.client}`, body: p.title, link: { tab: 'problems', id: p.id } })
    }
    patchDoc('invoices', inv.id, { chaseStage: next, lastChasedAt: new Date().toISOString() })
    n++
  }
  return `${n} chased`
})
schedule({ kind: 'invoice_chase', next: atHour(10) })

// ─── Correction feedback loop (nightly 02:00): the founder's edits/discards become extraction rules ───
register('learn_corrections', async () => {
  const corrections = listDocs<Correction>('corrections').slice(0, 60)
  if (corrections.length < 3) return `only ${corrections.length} corrections — need 3+`
  const prev = getDoc<{ text: string }>('settings', 'extraction_guidance')?.data.text ?? ''
  const text = await chat({
    system: `You improve an information-extraction prompt from user corrections. Output 3-10 short, concrete, general rules (one per line, starting with "-") that would have prevented these corrections. Merge with the existing rules; drop rules that are contradicted; never exceed 10 lines; no explanations.`,
    user: `EXISTING RULES:\n${prev || '(none)'}\n\nCORRECTIONS (category · before → after, null = discarded, with transcript excerpt):\n${corrections.map(c => `- ${c.category} [${c.action}]: ${JSON.stringify(c.before)} → ${c.after === null ? 'null' : JSON.stringify(c.after)} | "${c.transcript.slice(0, 160)}"`).join('\n')}`,
    temperature: 0.2,
  })
  putDoc('settings', 'extraction_guidance', { text: text.trim(), learnedFrom: corrections.length, at: new Date().toISOString() })
  return `${corrections.length} corrections → ${text.trim().split('\n').length} rules`
})
schedule({ kind: 'learn_corrections', next: atHour(2) })

// ─── Weekly review (Fri 17:00): what was decided, what closed, and outcome checks on adopted Solver plans ───
register('weekly_review', async () => {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
  const decisions = listDocs<Decision>('decisions')
  const decided = decisions.filter(d => d.type === 'Decision' && (d as Decision & { _u?: number })._u && ((d as Decision & { _u?: number })._u ?? 0) >= weekAgo.getTime())
  const completed = decisions.filter(d => d.type === 'Commitment' && d.status === 'completed' && ((d as Decision & { _u?: number })._u ?? 0) >= weekAgo.getTime())
  const overdue = decisions.filter(d => d.type === 'Commitment' && d.status === 'overdue')
  const done = listDocs<Assignment>('assignments').filter(a => a.status === 'done' && ((a as Assignment & { _u?: number })._u ?? 0) >= weekAgo.getTime())
  // Outcome checks: plans adopted 7+ days ago without an outcome yet
  const due = listDocs<Problem & { committed?: boolean; outcome?: string; outcomeAskedAt?: string; analysis?: { generated_at?: string } }>('problems')
    .filter(p => p.committed && !p.outcome && p.analysis?.generated_at && new Date(p.analysis.generated_at) <= weekAgo && !p.outcomeAskedAt)
  for (const p of due) {
    patchDoc('problems', p.id, { outcomeAskedAt: new Date().toISOString() })
    await notify({ kind: 'outcome', title: `Did it work? ${p.title}`, body: `You adopted the board's plan a week ago. Mark the outcome in Solve so future analyses learn from it.`, link: { tab: 'problems', id: p.id } })
  }
  const esc = escalation('Revenue')
  const { metrics, decisionQuality } = await import('../metrics.js')
  const m = metrics(7)
  type PQ = Parameters<typeof decisionQuality>[0]
  const dq = listDocs<PQ>('problems').filter(p => p.committed).map(p => ({ title: p.title, q: decisionQuality(p) })).filter(x => x.q)
  const dqAvg = dq.length ? Math.round(dq.reduce((a, x) => a + x.q!.score, 0) / dq.length) : null
  for (const x of dq) patchDoc('problems', listDocs<Problem>('problems').find(p => p.title === x.title)!.id, { quality: x.q })
  const summary = await chat({
    system: `You write a crisp weekly review for a founder. Max 150 words, plain text, no markdown. Structure: what moved, what slipped, one number that matters, one thing to fix next week. Metrics this week: ${m.notes_per_workday} notes/day, ${m.corrections_per_note} corrections/note, ${m.commitments_on_time_pct}% commitments on time, team tasks done ${m.team_tasks_done_pct}%, ~${m.est_hours_saved}h saved by auto-logging${dqAvg !== null ? `, decision quality ${dqAvg}/100` : ''}.`,
    user: `Week ending ${fmtDate(new Date())}. Revenue ${esc.actual.toLocaleString()}/${esc.target.toLocaleString()} (${esc.label}). Decisions made: ${decided.map(d => d.title).join('; ') || 'none'}. Commitments completed: ${completed.map(d => d.title).join('; ') || 'none'}. Tasks done: ${done.map(a => `${a.task} (${a.assignee})`).join('; ') || 'none'}. Overdue: ${overdue.map(d => `${d.title} (${d.who ?? 'me'})`).join('; ') || 'none'}. Outcome checks requested: ${due.length}.`,
    temperature: 0.4,
  })
  putDoc('briefs', uid(), { id: uid(), kind: 'weekly_review', ts: new Date().toISOString(), text: summary.trim() })
  await notify({ kind: 'weekly_review', title: 'Weekly review', body: summary.trim(), link: { tab: 'decisions' } })
  return `decided ${decided.length}, completed ${completed.length}, overdue ${overdue.length}, outcome checks ${due.length}`
})
schedule({ kind: 'weekly_review', next: weeklyAt(5, 17) })

// ─── Proactive recommendations after every extraction ───
register('recommend', async p => {
  const convo = getDoc<{ id: string; transcript: string; extracted: Record<string, unknown[]> & { summary?: string }; recommendedAt?: string }>('conversations', String(p.id))?.data
  if (!convo?.extracted || convo.recommendedAt) return 'skip'
  const { recommendForConversation } = await import('../recommend.js')
  const recs = await recommendForConversation(convo)
  patchDoc('conversations', convo.id, { recommendedAt: new Date().toISOString(), recommendationCount: recs.length })
  if (recs.length) {
    const top = recs.find(r => r.urgency === 'high') ?? recs[0]
    await notify({ kind: 'recommendation', title: `${recs.length} next step${recs.length > 1 ? 's' : ''} from your ${fmtTime(convo)} note`, body: `${top.title} — ${top.detail}`, link: { tab: 'bot' } })
  }
  return `${recs.length} recommendations`
})
const fmtTime = (c: { id: string }) => { const d = listDocs<{ id: string; createdAt: string }>('conversations').find(x => x.id === c.id); return d ? fmtDateTime(d.createdAt).split(', ')[1] : '' }

// ─── Memory index (nightly + on demand) ───
register('reindex_memory', async () => { const { reindex } = await import('../memory.js'); const r = await reindex(); return `${r.indexed} indexed / ${r.total} total (${r.provider})` })
schedule({ kind: 'reindex_memory', next: atHour(3) })

// ─── Staff overallocation (daily 08:15): > 4 open tasks due within 3 days for one person ───
register('staff_load', async () => {
  const soon = new Date(); soon.setDate(soon.getDate() + 3)
  const open = listDocs<Assignment>('assignments').filter(a => a.status !== 'done' && new Date(a.dueAt) <= soon)
  const byPerson = open.reduce<Record<string, Assignment[]>>((m, a) => { (m[a.assignee] ??= []).push(a); return m }, {})
  const over = Object.entries(byPerson).filter(([, list]) => list.length > 4)
  const idle = listDocs<{ name: string; role: string; status: string }>('staff').filter(x => x.status === 'active' && !/ceo|founder/i.test(x.role) && !(byPerson[x.name]?.length))
  for (const [who, list] of over) {
    await notify({ kind: 'staff', title: `${who} is overloaded`, body: `${list.length} tasks due within 3 days.${idle.length ? ` ${idle.map(x => x.name).join(', ')} ${idle.length > 1 ? 'have' : 'has'} nothing due — consider moving: ${list.slice(-2).map(a => a.task).join('; ')}` : ''}`, link: { tab: 'ops' } })
  }
  return `${over.length} overloaded`
})
schedule({ kind: 'staff_load', next: atHour(8, 15) })

// ─── KPI trend (daily 08:20): two consecutive weeks of decline on revenue or pipeline ───
register('kpi_trend', async () => {
  const alerts: string[] = []
  for (const metric of ['Revenue', 'Pipeline']) {
    const h = kpiHistory(metric, 21).filter(x => x.value != null).map(x => x.value as number)
    if (h.length < 14) continue
    const w = (i: number) => h.slice(i, i + 7).reduce((a, b) => a + b, 0) / 7
    const w1 = w(0), w2 = w(7), w3 = w(14)
    if (w3 < w2 && w2 < w1 && (w1 - w3) / (w1 || 1) > 0.1) {
      alerts.push(metric)
      await notify({ kind: 'kpi', title: `${metric} trending down 2 weeks`, body: `${Math.round(w1).toLocaleString()} → ${Math.round(w2).toLocaleString()} → ${Math.round(w3).toLocaleString()}. Run the board before it becomes an escalation?`, link: { tab: 'problems' } })
    }
  }
  return alerts.length ? `declining: ${alerts.join(', ')}` : 'stable'
})
schedule({ kind: 'kpi_trend', next: atHour(8, 20) })

// ─── Plan adopted → generate tripwires (measurable failure conditions) ───
export interface Tripwire { id: string; problemId: string; problemTitle: string; metric: 'leads_week' | 'revenue_month' | 'overdue_invoices' | 'tasks_overdue' | 'plan_tasks_done_pct' | 'receivables' | 'cash'; op: '<' | '>' ; value: number; checkAfter: string; label: string; fallback: string; status: 'armed' | 'fired' | 'cleared'; firedAt?: string }
function metricValue(m: Tripwire['metric'], problemId: string): number {
  const today = startOfDay(); const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7)
  switch (m) {
    case 'leads_week': return listDocs<{ createdAt: string }>('leads').filter(l => new Date(l.createdAt) >= weekAgo).length
    case 'revenue_month': return escalation('Revenue').actual
    case 'overdue_invoices': return listDocs<Invoice>('invoices').filter(i => i.status === 'overdue').length
    case 'tasks_overdue': return listDocs<Assignment>('assignments').filter(a => a.status !== 'done' && new Date(a.dueAt) < today).length
    case 'plan_tasks_done_pct': { const t = listDocs<Assignment & { problemId?: string }>('assignments').filter(a => a.problemId === problemId); return t.length ? Math.round(100 * t.filter(a => a.status === 'done').length / t.length) : 0 }
    case 'receivables': return burnAndRunway().receivables
    case 'cash': return getSettings().cashBalance
  }
}
register('plan_adopted', async p => {
  const prob = getDoc<Problem & { analysis?: { consensus_summary?: string; action_items?: { task: string; assignee: string; deadline_days: number }[] } }>('problems', String(p.id))?.data
  if (!prob?.analysis) return 'no plan'
  if (listDocs<Tripwire>('tripwires').some(t => t.problemId === prob.id)) return 'already armed'
  const text = await chat({
    system: `You design tripwires for an adopted business plan: measurable conditions that mean the plan is failing. Available metrics: leads_week (new leads in last 7 days), revenue_month (PKR so far this month), overdue_invoices (count), tasks_overdue (count of overdue team tasks), plan_tasks_done_pct (0-100, this plan's tasks completed), receivables (PKR outstanding), cash (PKR). Return ONLY JSON {"tripwires":[{"metric":"...","op":"<"|">","value":number,"checkAfterDays":7,"label":"human sentence","fallback":"what to do instead if this fires"}]}. 2-3 tripwires, realistic thresholds.`,
    user: `Problem: ${prob.title}\nPlan: ${prob.analysis.consensus_summary}\nTasks: ${(prob.analysis.action_items ?? []).map(a => `${a.task} (${a.assignee}, ${a.deadline_days}d)`).join('; ')}`, json: true, temperature: 0.2, kind: 'tripwires',
  })
  const j = (JSON.parse(text) as { tripwires?: Partial<Tripwire & { checkAfterDays: number }>[] }).tripwires ?? []
  let n = 0
  for (const t of j) {
    if (!t.metric || !t.op || typeof t.value !== 'number') continue
    const after = new Date(); after.setDate(after.getDate() + (t.checkAfterDays ?? 7))
    const tw: Tripwire = { id: uid(), problemId: prob.id, problemTitle: prob.title, metric: t.metric, op: t.op, value: t.value, checkAfter: after.toISOString(), label: String(t.label ?? ''), fallback: String(t.fallback ?? ''), status: 'armed' }
    putDoc('tripwires', tw.id, tw as unknown as Record<string, unknown>); n++
  }
  return `${n} tripwires armed`
})

// ─── Tripwire check (daily 09:10): fire → notify with the fallback already drafted ───
register('tripwire_check', async () => {
  let fired = 0
  for (const t of listDocs<Tripwire>('tripwires')) {
    if (t.status !== 'armed' || new Date(t.checkAfter) > new Date()) continue
    const v = metricValue(t.metric, t.problemId)
    const hit = t.op === '<' ? v < t.value : v > t.value
    if (!hit) continue
    patchDoc('tripwires', t.id, { status: 'fired', firedAt: new Date().toISOString(), observed: v })
    const fb = await chat({ system: 'You are a chief of staff. In under 80 words, plain text, turn this fallback into 3 concrete steps with owners from: Ahmed, Zahoor, Furqan, Bilal.', user: `Plan "${t.problemTitle}" tripped: ${t.label} (observed ${v}, threshold ${t.op}${t.value}). Fallback idea: ${t.fallback}`, temperature: 0.3, kind: 'fallback' })
    await notify({ kind: 'tripwire', title: `Tripwire: ${t.problemTitle}`, body: `${t.label} — observed ${v}. Fallback: ${fb.trim()}`, link: { tab: 'problems', id: t.problemId } })
    fired++
  }
  return `${fired} fired`
})
schedule({ kind: 'tripwire_check', next: atHour(9, 10) })

// ─── Playbook learning: a plan that worked becomes a reusable process ───
register('learn_playbook', async p => {
  const prob = getDoc<Problem & { outcome?: string; analysis?: { consensus_summary?: string; root_cause?: string; action_items?: { task: string; assignee: string; deadline_days: number }[] } }>('problems', String(p.id))?.data
  if (!prob?.analysis || prob.outcome !== 'worked') return 'not a win'
  const existing = listDocs<{ id: string; title: string; keywords: string[]; timesWorked: number; sourceProblems: string[] }>('playbooks')
  const text = await chat({
    system: `Generalize a business win into a reusable playbook. Return ONLY JSON {"title":"short name","trigger":"when to use it (symptoms)","keywords":["6-10 lowercase words that would appear in a similar problem"],"steps":[{"step":"...","owner":"role or name","days":number}],"metrics":["what to watch"]}`,
    user: `Problem: ${prob.title}\n${prob.description}\nRoot cause: ${prob.analysis.root_cause}\nPlan that worked: ${prob.analysis.consensus_summary}\nTasks: ${(prob.analysis.action_items ?? []).map(a => `${a.task} (${a.assignee}, ${a.deadline_days}d)`).join('; ')}`, json: true, temperature: 0.2, kind: 'playbook',
  })
  const j = JSON.parse(text) as { title: string; trigger: string; keywords: string[]; steps: { step: string; owner: string; days: number }[]; metrics: string[] }
  const dup = existing.find(pb => (pb.keywords ?? []).filter(k => (j.keywords ?? []).includes(k)).length >= 4)
  if (dup) { patchDoc('playbooks', dup.id, { timesWorked: (dup.timesWorked ?? 1) + 1, sourceProblems: [...(dup.sourceProblems ?? []), prob.id] }); return `reinforced "${dup.title}"` }
  const pb = { id: uid(), ...j, timesWorked: 1, sourceProblems: [prob.id], createdAt: new Date().toISOString() }
  putDoc('playbooks', pb.id, pb)
  await notify({ kind: 'playbook', title: `New playbook: ${pb.title}`, body: `Learned from "${prob.title}". The Solver will offer it next time this pattern appears.`, link: { tab: 'problems' } })
  return `playbook "${pb.title}"`
})

export const _fmt = { fmtDate, fmtDateTime }

// ─── Clarifying Question ───
register('ask_clarification', async p => {
  const prob = getDoc('problems', String(p.id))?.data
  if (!prob) return 'no problem'
  
  const text = await chat({
    system: "You are an AI assistant. The user logged a high-severity business problem but the description is too short (under 20 words). Ask exactly ONE short, highly-leverage clarifying question to get the missing context so you can solve it. Return ONLY the question string.",
    user: `Problem: ${prob.title}\nDescription: ${prob.description}`,
    temperature: 0.4
  })
  
  const question = text.trim()
  
  // Create a recommendation for the Bot tab
  const recId = uid()
  const rec = {
    id: recId,
    conversationId: 'system',
    category: 'problem',
    itemText: question,
    title: `Clarify: ${prob.title}`,
    detail: `Please provide more details:\n${question}`,
    urgency: 'high',
    actions: [{ type: 'remind', label: 'ANSWER', text: `Regarding '${prob.title}', ${question}`, by: 'today' }],
    status: 'new',
    createdAt: new Date().toISOString()
  }
  putDoc('recommendations', recId, rec)
  
  await notify({ kind: 'solver', title: 'Action needed', body: question, link: { tab: 'bot' } })
  return 'asked clarification'
})
