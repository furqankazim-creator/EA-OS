// Proactive next-step engine: after a note is extracted, turn every item into concrete, local,
// executable recommendations (find a doctor nearby, draft the email, delegate, set the reminder…).
import { chat, parseJson, provider, GROQ_BASE } from './llm.js'
import { getSettings, listDocs, putDoc, uid } from './db.js'
import { clientContextText, type Staff } from './logic.js'

export type RecAction =
  | { type: 'map'; label: string; query: string }
  | { type: 'call'; label: string; phone: string }
  | { type: 'link'; label: string; url: string }
  | { type: 'remind'; label: string; text: string; by: string }
  | { type: 'assign'; label: string; task: string; assignee: string; deadline_days: number }
  | { type: 'solver'; label: string; title: string; description: string; severity: 'low' | 'medium' | 'high' }
  | { type: 'email'; label: string; to: string; brief: string }
  | { type: 'ask'; label: string; prompt: string }

export interface Recommendation {
  id: string; conversationId: string; category: string; itemText: string
  title: string; detail: string; urgency: 'low' | 'medium' | 'high'
  places?: { name: string; detail: string; phone?: string; address?: string; source?: string }[]
  actions: RecAction[]
  status: 'new' | 'done' | 'dismissed'; createdAt: string
}

// Web-grounded lookup via groq/compound (has search). Falls back to null when unavailable.
async function webLookup(query: string): Promise<{ places: Recommendation['places']; note: string } | null> {
  if (provider() !== 'groq') return null
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'groq/compound', temperature: 0.1, messages: [
        { role: 'system', content: 'Use web search. Return ONLY JSON: {"places":[{"name":"","detail":"specialty / why","phone":"","address":"","source":"url"}],"note":"one-line caveat"}. Max 4 places. Only include phone/address you actually found; leave empty otherwise.' },
        { role: 'user', content: query },
      ] }),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices: { message: { content: string } }[] }
    const j = parseJson(data.choices[0]?.message?.content ?? '{}') as { places?: Recommendation['places']; note?: string }
    return { places: (j.places ?? []).slice(0, 4), note: j.note ?? '' }
  } catch { return null }
}

const SPECIALIST: [RegExp, string][] = [
  [/knee|joint|back|spine|shoulder|neck|hip|ligament|fracture/i, 'orthopedic doctor and physiotherapist'],
  [/headache|migraine|dizz/i, 'neurologist'], [/stomach|acid|gastric|digest/i, 'gastroenterologist'],
  [/sleep|insomnia/i, 'sleep specialist'], [/stress|anxiety|burnout|focus|depress/i, 'psychologist / therapist'],
  [/eye|vision/i, 'ophthalmologist'], [/tooth|teeth|dental/i, 'dentist'], [/chest|heart|bp|blood pressure/i, 'cardiologist'],
  [/skin|rash/i, 'dermatologist'], [/diet|weight|nutrition/i, 'nutritionist'], [/workout|gym|squat|strain|muscle/i, 'sports physiotherapist'],
]

export async function recommendForConversation(convo: { id: string; transcript: string; extracted: Record<string, unknown[]> & { summary?: string } }): Promise<Recommendation[]> {
  const s = getSettings()
  const loc = `${s.location.area}, ${s.location.city}, ${s.location.country}`
  const staff = listDocs<Staff>('staff').map(x => `${x.name} (${x.role})`).join(', ')
  const ex = convo.extracted

  // 1. Local, web-grounded lookups for health items (doctors near the founder)
  const healthLookups = await Promise.all((ex.health as { type: string; notes: string }[] ?? []).map(async h => {
    const spec = SPECIALIST.find(([r]) => r.test(h.notes))?.[1] ?? (h.type === 'injury' ? 'orthopedic doctor' : 'general physician')
    const web = await webLookup(`Best rated ${spec} near ${loc}. Give clinic/hospital name, phone number and address.`)
    return { item: h, spec, web }
  }))

  // 2. One structured call for everything else
  const items = Object.entries(ex).filter(([k, v]) => k !== 'summary' && Array.isArray(v) && v.length).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
  if (!items) return []
  const text = await chat({
    system: `You are a proactive executive assistant for ${s.founderName} (founder, ${loc}). Team: ${staff || 'none'}.
For EACH extracted item below, propose the single most useful next step the assistant can DO for the founder right now. Be concrete and local. Return ONLY JSON:
{"recommendations":[{"category":"health|instructions|commitments|finance|problems|leads|decisions|kpi_updates|staff_mentions|suggestions","itemText":"the item as written","title":"short imperative title","detail":"2-3 sentences: what, why now, what it costs/risks","urgency":"low|medium|high","actions":[ACTION,...]}]}
ACTION is one of:
{"type":"map","label":"Find nearby","query":"orthopedic clinic near ${loc}"}
{"type":"remind","label":"Remind me","text":"...","by":"tomorrow|Friday|Sep 25|in 3 days"}
{"type":"assign","label":"Delegate to X","task":"...","assignee":"team member name","deadline_days":3}
{"type":"solver","label":"Run the board","title":"...","description":"...","severity":"low|medium|high"}
{"type":"email","label":"Draft email","to":"email or role","brief":"what to say"}
{"type":"link","label":"Open","url":"https://..."}
{"type":"ask","label":"Ask assistant","prompt":"question to ask the assistant"}
Rules: max 2 actions per recommendation; health → include a map action and a remind action to book; finance personal/office splits → no recommendation unless unusual; commitments → a remind action at the right time; instructions with a named person → assign; problems high → solver; leads → an email or remind action for the next step. Skip trivial items.`,
    user: `Transcript summary: ${ex.summary ?? ''}\n${clientContextText(convo.transcript)}\n\nITEMS:\n${items}`, json: true, temperature: 0.3,
  })
  let recs: Partial<Recommendation>[] = []
  try { recs = ((parseJson(text) as { recommendations?: Partial<Recommendation>[] }).recommendations ?? []) } catch { recs = [] }

  // 3. Merge web results into health recommendations
  const out: Recommendation[] = recs.map(r => {
    const rec: Recommendation = {
      id: uid(), conversationId: convo.id, category: String(r.category ?? 'suggestions'), itemText: String(r.itemText ?? ''),
      title: String(r.title ?? 'Next step'), detail: String(r.detail ?? ''), urgency: (r.urgency as Recommendation['urgency']) ?? 'medium',
      actions: Array.isArray(r.actions) ? (r.actions as RecAction[]).slice(0, 3) : [], status: 'new', createdAt: new Date().toISOString(),
    }
    if (rec.category === 'health') {
      const h = healthLookups.find(x => rec.itemText.toLowerCase().includes(x.item.notes.slice(0, 20).toLowerCase())) ?? healthLookups[0]
      if (h) {
        if (h.web?.places?.length) { rec.places = h.web.places; rec.detail += ` Nearby: ${h.web.places.map(p => p.name).join(', ')}.` }
        if (!rec.actions.some(a => a.type === 'map')) rec.actions.unshift({ type: 'map', label: `Find ${h.spec} nearby`, query: `${h.spec} near ${loc}` })
        h.web?.places?.filter(p => p.phone).slice(0, 2).forEach(p => rec.actions.push({ type: 'call', label: `Call ${p.name}`, phone: p.phone! }))
      }
    }
    return rec
  })
  // One recommendation per item: the model sometimes emits two for the same health note.
  const seen = new Set<string>()
  const unique = out.filter(r => { const k = `${r.category}:${r.itemText.slice(0, 40).toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true })
  for (const r of unique) putDoc('recommendations', r.id, r as unknown as Record<string, unknown>)
  return unique
}
