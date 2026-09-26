import { Router } from 'express'
import { provider, GROQ_BASE, groqChatModel, chat } from '../llm.js'
import { listDocs, getDoc, putDoc, patchDoc, uid, getSettings } from '../db.js'
import { snapshot, parseDue, fmtDate, fmtDateTime, escalation, burnAndRunway, clientProfile, pipelineCount, type Decision, type Assignment, type Expense, type Problem, type Lead } from '../logic.js'
import { enqueue } from '../jobs/engine.js'
import { onMutation } from '../jobs/events.js'
import { draftWithLLM } from '../emails.js'
import { notify } from '../notify.js'
import { recall } from '../memory.js'
import { standardScenarios, fmtForecast } from '../simulate.js'

export const assistant = Router()

// ─── Tools the assistant can call (executed against the server DB; the app syncs afterwards) ───
const TOOLS = [
  { name: 'get_status', description: 'Current snapshot: revenue vs target with escalation level, items due today, overdue items, open problems, receivables, runway.', parameters: { type: 'object', properties: {} } },
  { name: 'search_memory', description: 'Search past conversation transcripts, decisions, commitments and problems by keyword (institutional memory).', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_commitment', description: 'Log a commitment/task with an owner and due date.', parameters: { type: 'object', properties: { title: { type: 'string' }, who: { type: 'string', description: 'Owner name, or "Ahmed (me)"' }, by: { type: 'string', description: 'Due date text e.g. "Sep 22", "Friday", "in 3 days"' } }, required: ['title', 'who', 'by'] } },
  { name: 'create_assignment', description: 'Delegate a task to a team member with a deadline in days.', parameters: { type: 'object', properties: { task: { type: 'string' }, assignee: { type: 'string' }, deadline_days: { type: 'number' } }, required: ['task', 'assignee', 'deadline_days'] } },
  { name: 'mark_done', description: 'Mark a commitment or assignment as completed. Use search_memory/get_status first to find the id.', parameters: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['commitment', 'assignment'] } }, required: ['id', 'kind'] } },
  { name: 'add_expense', description: 'Log an expense.', parameters: { type: 'object', properties: { amount: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' }, personal_portion: { type: 'number' } }, required: ['amount', 'category', 'description'] } },
  { name: 'log_kpi', description: 'Record a KPI value (e.g. Revenue 65000 PKR).', parameters: { type: 'object', properties: { metric: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string' } }, required: ['metric', 'value', 'unit'] } },
  { name: 'run_solver', description: 'Create a business challenge and run the AI Solver board on it (async; result appears in the Solve tab).', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['title'] } },
  { name: 'draft_email', description: 'Draft an email for the founder to approve and send (never sends directly).', parameters: { type: 'object', properties: { to: { type: 'string' }, brief: { type: 'string', description: 'What the email should say' } }, required: ['to', 'brief'] } },
  { name: 'get_client_profile', description: 'Everything known about a client: mentions, invoices, outstanding money, commitments, problems, timeline.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'update_lead', description: 'Create or move a sales lead through the pipeline (new → contacted → qualified → proposal → won/lost).', parameters: { type: 'object', properties: { name: { type: 'string' }, company: { type: 'string' }, stage: { type: 'string', enum: ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] }, value: { type: 'number' }, next_step: { type: 'string' } }, required: ['name', 'stage'] } },
  { name: 'decompose_goal', description: 'Break a big goal with a deadline into milestones and delegated tasks with staggered due dates. Returns the plan; call with confirm=true to create the assignments.', parameters: { type: 'object', properties: { goal: { type: 'string' }, deadline: { type: 'string', description: 'e.g. Oct 31' }, confirm: { type: 'boolean' } }, required: ['goal', 'deadline'] } },
  { name: 'cash_forecast', description: '13-week cash-flow forecast (pessimistic / base / optimistic) from invoices, leads, expenses, payroll and cash.', parameters: { type: 'object', properties: {} } },
  { name: 'set_reminder', description: 'Schedule a one-off reminder notification.', parameters: { type: 'object', properties: { text: { type: 'string' }, when: { type: 'string', description: 'e.g. "tomorrow", "Friday", "Sep 25", "in 2 days"' } }, required: ['text', 'when'] } },
]

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const now = new Date()
  switch (name) {
    case 'get_status': {
      const s = snapshot()
      return { escalation: s.esc, dueToday: s.dueToday, overdue: s.overdue, openProblems: s.openProblems.map(p => ({ id: p.id, title: p.title, severity: p.severity, status: p.status })), receivables: s.finance.receivables, runwayMonths: s.finance.runwayMonths, spentYesterday: s.spentYesterday }
    }
    case 'search_memory': {
      // Semantic recall first (embeddings), keyword scan as a supplement.
      let semantic: unknown[] = []
      try { semantic = (await recall(String(args.query ?? ''), 5)).map(h => ({ type: h.collection, id: h.id, score: Math.round(h.score * 100), text: h.text.slice(0, 300) })) } catch { /* fallback below */ }
      const q = String(args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const hit = (t: string) => q.some(w => t.toLowerCase().includes(w))
      const convos = listDocs<{ id: string; createdAt: string; transcript: string; extracted?: { summary?: string } }>('conversations').filter(c => hit(c.transcript) || hit(c.extracted?.summary ?? '')).slice(0, 5)
        .map(c => ({ type: 'conversation', id: c.id, when: fmtDateTime(c.createdAt), summary: c.extracted?.summary, excerpt: c.transcript.slice(0, 300) }))
      const decs = listDocs<Decision>('decisions').filter(d => hit(d.title)).slice(0, 8).map(d => ({ type: d.type.toLowerCase(), id: d.id, title: d.title, who: d.who, by: d.by, status: d.status }))
      const asg = listDocs<Assignment>('assignments').filter(a => hit(a.task) || hit(a.assignee)).slice(0, 8).map(a => ({ type: 'assignment', id: a.id, task: a.task, assignee: a.assignee, due: a.due, status: a.status }))
      const probs = listDocs<Problem>('problems').filter(p => hit(p.title)).slice(0, 5).map(p => ({ type: 'problem', id: p.id, title: p.title, status: p.status }))
      return { semantic, results: [...convos, ...decs, ...asg, ...probs] }
    }
    case 'create_commitment': {
      const due = parseDue(String(args.by), now)
      const d: Decision = { id: uid(), type: 'Commitment', title: String(args.title), who: String(args.who), by: due ? fmtDate(due) : String(args.by), dueAt: due?.toISOString(), date: fmtDate(now), status: 'pending', source: 'Assistant' }
      putDoc('decisions', d.id, d as unknown as Record<string, unknown>, Date.now(), 'assistant'); onMutation('decisions', d as unknown as Record<string, unknown> & { id: string })
      return { ok: true, id: d.id, due: d.by }
    }
    case 'create_assignment': {
      const due = new Date(now); due.setDate(due.getDate() + Math.max(1, Number(args.deadline_days) || 3)); due.setHours(18, 0, 0, 0)
      const a: Assignment = { id: uid(), task: String(args.task), assignee: String(args.assignee), due: fmtDate(due), dueAt: due.toISOString(), status: 'pending', source: 'Assistant' }
      putDoc('assignments', a.id, a as unknown as Record<string, unknown>, Date.now(), 'assistant'); onMutation('assignments', a as unknown as Record<string, unknown> & { id: string })
      return { ok: true, id: a.id, due: a.due }
    }
    case 'mark_done': {
      const ok = args.kind === 'assignment' ? patchDoc('assignments', String(args.id), { status: 'done' }, 'assistant') : patchDoc('decisions', String(args.id), { status: 'completed' }, 'assistant')
      return { ok }
    }
    case 'add_expense': {
      const amount = Number(args.amount), personal = Number(args.personal_portion ?? 0)
      const e: Expense = { id: uid(), desc: String(args.description), amount, currency: getSettings().currency, office: amount - personal, personal, category: String(args.category), date: fmtDateTime(now), dateAt: now.toISOString(), verified: false, auto: true }
      putDoc('expenses', e.id, e as unknown as Record<string, unknown>, Date.now(), 'assistant')
      return { ok: true, id: e.id }
    }
    case 'log_kpi': {
      const k = { id: uid(), metric: String(args.metric), value: Number(args.value), unit: String(args.unit), trend: 'flat', date: fmtDateTime(now), dateAt: now.toISOString(), source: 'Assistant' }
      putDoc('kpis', k.id, k, Date.now(), 'assistant'); onMutation('kpis', k)
      return { ok: true, escalation: escalation(k.metric) }
    }
    case 'run_solver': {
      const p: Problem = { id: uid(), title: String(args.title), description: String(args.description ?? ''), severity: String(args.severity ?? 'medium'), status: 'open', date: fmtDate(now), source: 'Assistant' }
      putDoc('problems', p.id, p as unknown as Record<string, unknown>, Date.now(), 'assistant')
      enqueue('analyze_problem', Date.now(), { id: p.id }, `analyze:${p.id}`)
      return { ok: true, id: p.id, note: 'Analysis running; result will appear in the Solve tab within ~30s.' }
    }
    case 'draft_email': {
      const e = await draftWithLLM('custom', String(args.to), String(args.brief), undefined, 'Assistant')
      return { ok: true, id: e.id, subject: e.subject, note: 'Draft saved in Ops › Email for approval.' }
    }
    case 'get_client_profile': return clientProfile(String(args.name))
    case 'update_lead': {
      const all = listDocs<Lead>('leads')
      const existing = all.find(l => l.name.toLowerCase() === String(args.name).toLowerCase())
      const lead: Lead = { id: existing?.id ?? uid(), name: String(args.name), company: (args.company as string) ?? existing?.company, stage: args.stage as Lead['stage'], value: args.value != null ? Number(args.value) : existing?.value, next_step: (args.next_step as string) ?? existing?.next_step, source: existing?.source ?? 'Assistant', createdAt: existing?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() }
      putDoc('leads', lead.id, lead as unknown as Record<string, unknown>, Date.now(), 'assistant')
      return { ok: true, id: lead.id, pipeline: pipelineCount() }
    }
    case 'cash_forecast': { const sc = standardScenarios(); return { scenarios: sc.map(f => ({ name: f.scenario, summary: fmtForecast(f), minCash: f.minCash, minCashWeek: f.minCashWeek, endCash: f.endCash, shortfallWeek: f.shortfallWeek, weeks: f.weeks.map(w => ({ week: w.week, cash: w.cash })) })) } }
    case 'decompose_goal': {
      const deadline = parseDue(String(args.deadline), now) ?? new Date(now.getTime() + 30 * 86_400_000)
      const days = Math.max(3, Math.round((deadline.getTime() - now.getTime()) / 86_400_000))
      const staff = listDocs<{ name: string; role: string }>('staff').map(x => `${x.name} (${x.role})`).join(', ')
      const text = await chat({ system: `Break a goal into 3-6 milestones and 5-12 concrete tasks for a small team (${staff}). Deadline in ${days} days. Return ONLY JSON {"milestones":[{"title":"","dayOffset":number}],"tasks":[{"task":"","assignee":"name","dayOffset":number,"milestone":"title"}]}. dayOffset = days from today, all <= ${days}.`, user: String(args.goal), json: true, temperature: 0.3, kind: 'decompose' })
      const plan = JSON.parse(text) as { milestones: { title: string; dayOffset: number }[]; tasks: { task: string; assignee: string; dayOffset: number; milestone: string }[] }
      if (!args.confirm) return { preview: true, deadline: fmtDate(deadline), ...plan, note: 'Show this to the founder and ask to confirm; then call again with confirm=true.' }
      let n = 0
      for (const t of plan.tasks ?? []) {
        const due = new Date(now); due.setDate(due.getDate() + Math.min(days, Math.max(1, t.dayOffset))); due.setHours(18, 0, 0, 0)
        const a: Assignment = { id: uid(), task: `${t.task}${t.milestone ? ` [${t.milestone}]` : ''}`, assignee: t.assignee || 'Ahmed', due: fmtDate(due), dueAt: due.toISOString(), status: 'pending', source: `Goal: ${String(args.goal).slice(0, 60)}` }
        putDoc('assignments', a.id, a as unknown as Record<string, unknown>, Date.now(), 'assistant'); onMutation('assignments', a as unknown as Record<string, unknown> & { id: string }); n++
      }
      const d: Decision = { id: uid(), type: 'Decision', title: `Goal: ${String(args.goal)} by ${fmtDate(deadline)}`, description: (plan.milestones ?? []).map(m => `${m.title} (day ${m.dayOffset})`).join(' → '), date: fmtDate(now), status: 'active', source: 'Assistant goal decomposition' }
      putDoc('decisions', d.id, d as unknown as Record<string, unknown>, Date.now(), 'assistant')
      return { ok: true, created: n, milestones: plan.milestones }
    }
    case 'set_reminder': {
      const at = parseDue(String(args.when), now) ?? new Date(now.getTime() + 3600_000)
      at.setHours(9, 0, 0, 0); if (at < now) at.setTime(now.getTime() + 60_000)
      enqueue('reminder', at, { kind: 'custom', id: 'x', title: String(args.text), label: 'T-0' })
      // custom reminders are not tied to a doc: deliver directly
      const d: Decision = { id: uid(), type: 'Commitment', title: String(args.text), who: 'Ahmed (me)', by: fmtDate(at), dueAt: at.toISOString(), date: fmtDate(now), status: 'pending', source: 'Assistant reminder' }
      putDoc('decisions', d.id, d as unknown as Record<string, unknown>, Date.now(), 'assistant'); onMutation('decisions', d as unknown as Record<string, unknown> & { id: string })
      return { ok: true, at: fmtDateTime(at) }
    }
    default: return { error: `unknown tool ${name}` }
  }
}

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string }

async function groqToolLoop(messages: Msg[]): Promise<{ reply: string; actions: string[] }> {
  const actions: string[] = []
  for (let round = 0; round < 5; round++) {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: groqChatModel(), temperature: 0.3, messages, tools: TOOLS.map(t => ({ type: 'function', function: t })), tool_choice: 'auto' }),
    })
    if (!res.ok) throw new Error(`Groq chat ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as { choices: { message: Msg }[] }
    const msg = data.choices[0].message
    messages.push(msg)
    if (!msg.tool_calls?.length) return { reply: msg.content ?? '', actions }
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* empty */ }
      const result = await runTool(call.function.name, args)
      if (call.function.name !== 'get_status' && call.function.name !== 'search_memory') actions.push(call.function.name)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return { reply: 'I ran out of steps — please try a simpler request.', actions }
}

assistant.post('/chat', async (req, res) => {
  try {
    const { message, history = [], context = {} } = req.body as { message: string; history?: { role: 'user' | 'assistant'; content: string }[]; context?: unknown }
    const s = getSettings(); const esc = escalation('Revenue'); const f = burnAndRunway()
    const system = `You are the EA-OS Executive AI Assistant for ${s.founderName}, founder/CEO of a small services company in Pakistan (currency ${s.currency}). Today is ${new Date().toDateString()}.
You can ACT using tools: log commitments, delegate assignments, mark things done, log expenses/KPIs, run the AI Solver, clarify_problem, draft emails, set reminders, and search memory. If the user answers a clarifying question about a problem, use clarify_problem to append their answer and run the solver. Prefer acting.
Current status: ${esc.metric} ${esc.actual.toLocaleString()}/${esc.target.toLocaleString()} (${esc.pct}%, ${esc.label}, forecast ${esc.forecast.toLocaleString()}, ${esc.daysLeft} days left). Runway ${f.runwayMonths} months. Tone: ${esc.tone}.
Open recommendations from recent notes: ${listDocs<{ title: string; status: string; detail: string }>('recommendations').filter(r => r.status === 'new').slice(0, 6).map(r => r.title).join('; ') || 'none'}.
Team: ${listDocs<{ name: string; role: string }>('staff').map(x => `${x.name} (${x.role})`).join(', ') || 'Ahmed, Zahoor, Furqan, Bilal, Sana'}.
Be concise (under 120 words unless asked for detail). No markdown headings; short lines are fine.
App context from the phone (may be slightly stale): ${JSON.stringify(context).slice(0, 4000)}`

    if (provider() !== 'groq') {
      const reply = await chat({ system: system + '\n(Tools unavailable on this provider — answer only.)', user: [...history.map(h => `${h.role}: ${h.content}`), `user: ${message}`].join('\n'), temperature: 0.4 })
      return res.json({ reply, actions: [] })
    }
    const messages: Msg[] = [{ role: 'system', content: system }, ...history.slice(-10).map(h => ({ role: h.role, content: h.content }) as Msg), { role: 'user', content: message }]
    const out = await groqToolLoop(messages)
    res.json(out)
  } catch (e) {
    console.error('Assistant error:', (e as Error).message)
    res.status(502).json({ error: (e as Error).message })
  }
})
