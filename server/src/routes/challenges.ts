import { Router } from 'express'
import { chat, parseJson, provider, groqChatModel, geminiModel } from '../llm.js'
import { clientContextText, type Problem } from '../logic.js'
import { listDocs } from '../db.js'
import { memoryContext } from '../memory.js'
import { simulatePlan, standardScenarios, fmtForecast, type PlanDelta, type Forecast } from '../simulate.js'

export const challenges = Router()

// The four perspectives are simulated by one engine call (exactly as the spec describes) — the current
// provider/model plays all four roles. Names in the output are kept as-is for the UI.
const buildPrompt = (challenge: { title: string; description: string; severity: string }) => `You are an elite executive advisory board consisting of multiple world-class AI perspectives:
1. Gemini (Strategic scale, distribution loops, and system leverage)
2. Claude (Analytical depth, unit economics, risk analysis, and trade-offs)
3. GPT-4o (Tactical operations, workflow orchestration, and immediate sprint roadmaps)
4. Grok (Contrarian, zero-BS, first-principles logic and radical experiments)

Analyze this critical business bottleneck:
Title: "${challenge.title}"
Description: "${challenge.description}"
Severity: "${challenge.severity}"

Deliver your strategic consultation in raw valid JSON matching this schema:
{
  "consensus_summary": "1-2 paragraphs delivering the synthesized executive diagnosis and agreed path forward.",
  "root_cause": "A sharp, first-principles explanation of the underlying problem.",
  "models": [
    {
      "name": "Gemini 2.5 Pro",
      "verdict": "High-level summary of Gemini's recommendation",
      "pros": ["Point 1", "Point 2"],
      "cons": ["Point 1", "Point 2"]
    },
    {
      "name": "Claude 3.7 Sonnet",
      "verdict": "High-level summary of Claude's recommendation",
      "pros": ["Point 1", "Point 2"],
      "cons": ["Point 1", "Point 2"]
    },
    {
      "name": "GPT-4o",
      "verdict": "High-level summary of GPT's recommendation",
      "pros": ["Point 1", "Point 2"],
      "cons": ["Point 1", "Point 2"]
    },
    {
      "name": "Grok 3 (Contrarian)",
      "verdict": "High-level summary of Grok's contrarian recommendation",
      "pros": ["Point 1", "Point 2"],
      "cons": ["Point 1", "Point 2"]
    }
  ],
  "disagreements": [
    "Key area where the models differ in opinion or timeline"
  ],
  "action_items": [
    {
      "task": "Specific actionable next step",
      "assignee": "Suggested team role or person (e.g., Bilal, Zainab, Ahmed)",
      "deadline_days": 3
    }
  ],
  "decisions_to_record": [
    {
      "title": "Clear executive decision statement",
      "description": "Rationale and immediate impact"
    }
  ]
}

Ensure the advice is pragmatic, direct, free of generic corporate fluff, and immediately actionable for a business founder. Return ONLY valid JSON.`

const SYSTEM = `You are the AI Solver engine of EA-OS, an executive operating system for a founder/CEO of a small Pakistani services company (currency PKR).
Team you may assign tasks to: Ahmed (CEO/founder), Zahoor (Operations & Dev), Furqan (Backend Developer), Bilal (Sales & Outreach), Sana (Design Lead, currently on leave).
Return ONLY raw valid JSON.`

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const arr = <T,>(v: unknown, map: (x: Record<string, unknown>) => T): T[] => Array.isArray(v) ? v.map(x => map((x ?? {}) as Record<string, unknown>)) : []
const strs = (v: unknown) => Array.isArray(v) ? v.map(String) : []

export interface ChallengeAnalysis {
  consensus_summary: string; root_cause: string
  models: { name: string; verdict: string; pros: string[]; cons: string[] }[]
  disagreements: string[]
  action_items: { task: string; assignee: string; deadline_days: number }[]
  decisions_to_record: { title: string; description: string }[]
  engine: string; generated_at: string
  playbook?: { id: string; title: string; trigger: string; steps: { step: string; owner: string; days: number }[]; timesWorked: number } | null
  scenarios?: { name: string; assumptions: string[]; minCash: number; minCashWeek: number; endCash: number; revenue90: number; shortfallWeek: number | null }[]
  baseline?: { minCash: number; endCash: number; revenue90: number; shortfallWeek: number | null }
}

// Lessons from past outcomes: which kinds of plans worked for THIS founder.
function outcomeContext(): string {
  const done = listDocs<Problem & { outcome?: string; analysis?: { consensus_summary?: string } }>('problems').filter(p => p.outcome)
  if (!done.length) return ''
  const line = (p: typeof done[number]) => `- ${p.title} → ${p.outcome}: ${(p.analysis?.consensus_summary ?? '').slice(0, 160)}`
  return `Past plans and their real outcomes for this business (weigh these heavily):\n${done.slice(0, 8).map(line).join('\n')}`
}

// Playbook match: a prior win generalized into steps; offered before/alongside a fresh analysis.
function matchPlaybook(title: string, description: string) {
  const text = `${title} ${description}`.toLowerCase()
  const pbs = listDocs<{ id: string; title: string; trigger: string; keywords: string[]; steps: { step: string; owner: string; days: number }[]; timesWorked: number }>('playbooks')
  const scored = pbs.map(pb => ({ pb, hits: (pb.keywords ?? []).filter(k => text.includes(k.toLowerCase())).length })).filter(x => x.hits >= 2).sort((a, b) => b.hits - a.hits)
  const best = scored[0]?.pb
  return best ? { id: best.id, title: best.title, trigger: best.trigger, steps: best.steps, timesWorked: best.timesWorked ?? 1 } : null
}

export async function analyzeChallenge(c: { title: string; description?: string; severity?: string; context?: string }): Promise<ChallengeAnalysis> {
  const cc = clientContextText(`${c.title} ${c.description ?? ''}`)
  const mem = await memoryContext(`${c.title}. ${c.description ?? ''}`)
  const oc = outcomeContext()
  const playbook = matchPlaybook(c.title, c.description ?? '')
  const base = standardScenarios()[1]
  const extra = [c.context, cc, mem, oc, playbook ? `A playbook that worked before matches this ("${playbook.title}"): ${playbook.steps.map(s => s.step).join('; ')}. Consider it as one of the options.` : '',
    `Current 13-week cash forecast (base case): ${fmtForecast(base)}.`].filter(Boolean).join('\n')
  const user = buildPrompt({ title: c.title, description: c.description ?? '', severity: c.severity ?? 'medium' }) + `\n\nAdditional business context:\n${extra}` +
    `\n\nAlso add a top-level "plan_deltas": an array with one entry per model in "models", expressing that model's plan as numeric effects on the business model over 13 weeks: {"name":"<model name>","conversionDelta":-0.3..0.3,"newLeadsPerWeekDelta":-5..10,"collectionDelayDelta":-20..20,"weeklyCostDelta":PKR,"oneOffCash":PKR,"assumptions":["..."]}. Be conservative and specific.`
  const raw = parseJson(await chat({ system: SYSTEM, user, json: true, temperature: 0.4, kind: 'solver' }))
  const deltas = arr(raw.plan_deltas, d => ({ name: str(d.name), conversionDelta: Number(d.conversionDelta) || 0, newLeadsPerWeekDelta: Number(d.newLeadsPerWeekDelta) || 0, collectionDelayDelta: Number(d.collectionDelayDelta) || 0, weeklyCostDelta: Number(d.weeklyCostDelta) || 0, oneOffCash: Number(d.oneOffCash) || 0, assumptions: strs(d.assumptions) })) as PlanDelta[]
  const sims: Forecast[] = deltas.map(d => simulatePlan(d))
  return {
    playbook,
    baseline: { minCash: base.minCash, endCash: base.endCash, revenue90: base.revenue90, shortfallWeek: base.shortfallWeek },
    scenarios: sims.map((f, i) => ({ name: f.scenario, assumptions: deltas[i].assumptions ?? [], minCash: f.minCash, minCashWeek: f.minCashWeek, endCash: f.endCash, revenue90: Math.round(f.revenue90), shortfallWeek: f.shortfallWeek })),
    consensus_summary: str(raw.consensus_summary),
    root_cause: str(raw.root_cause),
    models: arr(raw.models, m => ({ name: str(m.name), verdict: str(m.verdict), pros: strs(m.pros), cons: strs(m.cons) })),
    disagreements: strs(raw.disagreements),
    action_items: arr(raw.action_items, a => ({ task: str(a.task), assignee: str(a.assignee) || 'Ahmed', deadline_days: Math.max(1, Number(a.deadline_days) || 3) })),
    decisions_to_record: arr(raw.decisions_to_record, d => ({ title: str(d.title), description: str(d.description) })),
    engine: provider() === 'groq' ? groqChatModel() : geminiModel(),
    generated_at: new Date().toISOString(),
  }
}

challenges.post('/analyze', async (req, res) => {
  const { title, description = '', severity = 'medium', context } = req.body as { title?: string; description?: string; severity?: string; context?: string }
  if (!title) return res.status(400).json({ error: 'Provide `title` (and optionally `description`, `severity`, `context`)' })
  try {
    const t0 = Date.now()
    const analysis = await analyzeChallenge({ title, description, severity, context })
    console.log(`challenge analyzed · ${analysis.models.length} perspectives · ${analysis.action_items.length} actions · ${Date.now() - t0}ms`)
    res.json(analysis)
  } catch (e) {
    const msg = (e as Error).message
    console.error('analyze failed:', msg)
    res.status(502).json({ error: msg })
  }
})
