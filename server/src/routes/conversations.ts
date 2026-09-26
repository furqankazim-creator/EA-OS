import { Router } from 'express'
import { chat, transcribe, parseJson } from '../llm.js'
import { listDocs, putDoc } from '../db.js'
import { openCommitments, parseDue, fmtDate, clientContextText, type Staff, type Client, type Correction } from '../logic.js'
import { getDoc } from '../db.js'

export const conversations = Router()

export const SYSTEM_PROMPT = `You are an executive assistant operating system. Analyze the following conversation transcript or voice note.
The speaker may speak in English, Urdu, or mixed Roman Urdu/Hindi/English.

Extract structured intelligence in JSON format matching this schema:
{
  "summary": "1-2 sentence executive summary of the conversation",
  "instructions": [
    { "text": "actionable task", "assigned_to": "person name or null" }
  ],
  "decisions": [
    { "title": "Decision made", "description": "context or details" }
  ],
  "commitments": [
    { "who": "person who made commitment", "what": "what was promised", "by": "due date or timeframe", "source_quote": "exact quote from transcript" }
  ],
  "finance": [
    { "amount": number, "currency": "PKR", "office_portion": number, "personal_portion": number, "category": "category name", "description": "details" }
  ],
  "health": [
    { "type": "workout|diet|injury|sleep|metric", "notes": "notes", "action_recommended": "recommendation" }
  ],
  "problems": [
    { "title": "challenge/bottleneck identified", "description": "details", "severity": "low|medium|high" }
  ],
  "staff_mentions": [
    { "name": "staff member name", "context": "what was discussed regarding them" }
  ],
  "kpi_updates": [
    { "metric": "name of metric", "value": number, "unit": "unit", "trend": "up|down|flat" }
  ],
  "suggestions": [
    { "text": "strategic suggestion", "rationale": "why this helps" }
  ],
  "leads": [
    { "name": "prospect person name", "company": "company or null", "stage": "new|contacted|qualified|proposal|won|lost", "value": number or null, "next_step": "what happens next" }
  ]
}

Ensure high precision. Parse currency and numbers accurately. Handle mixed language smoothly.
Return ONLY raw valid JSON, no markdown codeblocks or extra text.`

// Entity linking: canonical names for people and clients so "Furqan bhai" → "Furqan", "Acme" → "Acme Corp".
function entityContext() {
  const staff = listDocs<Staff>('staff')
  const clients = listDocs<Client>('clients')
  const parts: string[] = []
  if (staff.length) parts.push(`Known team members (use these exact names for assigned_to, who, staff_mentions.name; "me"/"I" is the founder ${staff.find(s => /ceo|founder/i.test(s.role))?.name ?? 'Ahmed'}): ${staff.map(s => `${s.name} (${s.role})`).join(', ')}.`)
  if (clients.length) parts.push(`Known clients (use canonical names): ${clients.map(c => c.aliases?.length ? `${c.name} [aka ${c.aliases.join(', ')}]` : c.name).join(', ')}.`)
  // Learned from the founder's own edits (see jobs: learn_corrections) + the most recent raw corrections.
  const guidance = getDoc<{ text: string }>('settings', 'extraction_guidance')?.data.text
  if (guidance) parts.push(`Extraction rules learned from the founder's corrections — follow them:\n${guidance}`)
  const recent = listDocs<Correction>('corrections').slice(0, 6)
  if (recent.length) parts.push(`Recent corrections (before → after; "null" means the founder discarded it):\n${recent.map(c => `- ${c.category}: ${JSON.stringify(c.before)} → ${c.after === null ? 'null' : JSON.stringify(c.after)}`).join('\n')}`)
  parts.push(`Today is ${new Date().toDateString()}. For "by", resolve relative dates to a concrete date like "Sep 22" when possible, otherwise keep the phrase.`)
  return parts.join('\n')
}

type Commitment = { who?: string; what?: string; by?: string; source_quote?: string; dueAt?: string }
type Extraction = { summary: string; instructions: unknown[]; decisions: unknown[]; commitments: Commitment[]; finance: unknown[]; health: unknown[]; problems: unknown[]; staff_mentions: unknown[]; kpi_updates: unknown[]; suggestions: unknown[]; leads: unknown[] }
const EMPTY: Extraction = { summary: '', instructions: [], decisions: [], commitments: [], finance: [], health: [], problems: [], staff_mentions: [], kpi_updates: [], suggestions: [], leads: [] }

// Follow-up detection: does this transcript complete / delay / cancel an existing open commitment?
export interface FollowUp { id: string; title: string; action: 'completed' | 'delayed' | 'cancelled'; new_by?: string; evidence: string }

function fewShotContext() {
  
  const corrections = listDocs('corrections').slice(0, 10) // get 10 most recent corrections
  if (!corrections.length) return ''
  
  const rules = corrections.map(c => {
    return `- For category "${c.category}": given transcript snippet "${c.transcript}", user corrected ${JSON.stringify(c.original)} to ${c.corrected ? JSON.stringify(c.corrected) : 'DISCARD (remove it)'}.`
  })
  
  return `\n\nLEARN FROM THESE PAST USER CORRECTIONS:\n` + rules.join('\n')
}
async function detectFollowUps(transcript: string): Promise<FollowUp[]> {
  const open = openCommitments()
  if (!open.length) return []
  const list = open.map(c => ({ id: c.id, title: c.title, who: c.who ?? '', by: c.by ?? '' }))
  const text = await chat({
    system: `You reconcile a new voice note against a list of OPEN commitments. Return JSON {"updates":[{"id":"<id from list>","action":"completed|delayed|cancelled","new_by":"new due date if delayed","evidence":"short quote"}]}. Only include items the transcript clearly refers to. If nothing matches return {"updates":[]}.`,
    user: `OPEN COMMITMENTS:\n${JSON.stringify(list)}\n\nTRANSCRIPT:\n${transcript}`, json: true, temperature: 0,
  })
  try {
    const j = parseJson(text) as { updates?: FollowUp[] }
    return (j.updates ?? []).filter(u => list.some(l => l.id === u.id)).map(u => ({ ...u, title: list.find(l => l.id === u.id)!.title }))
  } catch { return [] }
}

conversations.post('/extract', async (req, res) => {
  const { transcript: hint, audio, lang, skipFollowUps } = req.body as { transcript?: string; audio?: { data: string; mimeType: string }; lang?: string; skipFollowUps?: boolean }
  if (!hint && !audio?.data) return res.status(400).json({ error: 'Provide `transcript` and/or `audio` { data (base64), mimeType }' })

  try {
    const t0 = Date.now()
    let transcript = hint ?? ''
    if (audio?.data) {
      try { transcript = (await transcribe(audio, lang)) || transcript }
      catch (e) { if (!transcript) throw e; console.warn('transcription failed, using live transcript:', (e as Error).message) }
    }
    if (!transcript.trim()) return res.json({ transcript: '', extraction: EMPTY, followUps: [] })

    const [text, followUps] = await Promise.all([
      chat({ system: `${SYSTEM_PROMPT}\n\n${entityContext()}${fewShotContext()}`, user: `Transcript:\n${transcript}`, json: true }),
      skipFollowUps ? Promise.resolve([] as FollowUp[]) : detectFollowUps(transcript),
    ])
    const extraction: Extraction = { ...EMPTY, ...(parseJson(text) as Partial<Extraction>) }
    // Attach resolved due dates so the app and reminders agree.
    extraction.commitments = (Array.isArray(extraction.commitments) ? extraction.commitments : []).map(c => { const d = parseDue(c.by); return d ? { ...c, dueAt: d.toISOString(), by: c.by || fmtDate(d) } : c })
    console.log(`extract ok · ${audio ? 'audio' : 'text'} · ${Date.now() - t0}ms · ${transcript.length} chars · ${followUps.length} follow-ups`)
    res.json({ transcript, extraction, followUps })
  } catch (e) {
    const msg = (e as Error).message
    console.error('extract failed:', msg)
    res.status(502).json({ error: msg })
  }
})

conversations.post('/corrections', async (req, res) => {
  const { transcript, category, original, corrected } = req.body
  if (!transcript || !category) return res.status(400).json({ error: 'Missing transcript or category' })

  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    // We import putDoc at the top if needed, but it's already in listDocs import block.
    // Let's use the local db import to save it. We'll patch the import block as well.
    
    putDoc('corrections', id, { transcript, category, original, corrected, createdAt: new Date().toISOString() })
    console.log(`Logged correction for ${category}`)
    res.json({ ok: true })
  } catch (e) {
    console.error('correction log failed:', e)
    res.status(500).json({ error: 'Failed' })
  }
})
