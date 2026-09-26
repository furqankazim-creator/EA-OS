// Provider abstraction: Groq (OpenAI-compatible) or Gemini. Both expose the same three primitives.
import { GoogleGenAI } from '@google/genai'
import { db } from './db.js'

db.exec('CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, provider TEXT, model TEXT, kind TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, ms INTEGER, ok INTEGER)')
const usageInsert = db.prepare('INSERT INTO usage (ts, provider, model, kind, prompt_tokens, completion_tokens, ms, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
export const recordUsage = (model: string, kind: string, pt: number, ct: number, ms: number, ok: boolean) => { try { usageInsert.run(Date.now(), provider(), model, kind, pt, ct, ms, ok ? 1 : 0) } catch { /* ignore */ } }
export function usageSummary(days = 7) {
  const since = Date.now() - days * 86_400_000
  const rows = db.prepare('SELECT model, kind, COUNT(*) calls, SUM(prompt_tokens) pt, SUM(completion_tokens) ct, AVG(ms) avg_ms, SUM(ok) ok FROM usage WHERE ts > ? GROUP BY model, kind ORDER BY calls DESC').all(since) as { model: string; kind: string; calls: number; pt: number; ct: number; avg_ms: number; ok: number }[]
  const total = rows.reduce((a, r) => ({ calls: a.calls + r.calls, tokens: a.tokens + (r.pt ?? 0) + (r.ct ?? 0), failed: a.failed + (r.calls - r.ok) }), { calls: 0, tokens: 0, failed: 0 })
  return { days, total, byModel: rows }
}

export type Provider = 'groq' | 'gemini'
export const provider = (): Provider =>
  (process.env.LLM_PROVIDER as Provider) || (process.env.GROQ_API_KEY ? 'groq' : 'gemini')

export const GROQ_BASE = 'https://api.groq.com/openai/v1'
const FALLBACK_MODEL = 'openai/gpt-oss-120b'
export const groqChatModel = () => process.env.GROQ_CHAT_MODEL ?? 'openai/gpt-oss-120b'
export const groqWhisperModel = () => process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3'
export const geminiModel = () => process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

export function assertConfigured() {
  if (provider() === 'groq' && !process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured on the server')
  if (provider() === 'gemini' && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured on the server')
}

export function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
  throw new Error('Model did not return JSON')
}

// ─── Chat (JSON or text) ───

export async function chat(opts: { system: string; user: string; json?: boolean; model?: string; temperature?: number; kind?: string }): Promise<string> {
  assertConfigured()
  const t0 = Date.now()
  if (provider() === 'groq') {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? groqChatModel(),
        temperature: opts.temperature ?? 0.2,
        messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      recordUsage(opts.model ?? groqChatModel(), opts.kind ?? 'chat', 0, 0, Date.now() - t0, false)
      // Model was decommissioned/unknown: retry once on the known-good default instead of failing the request.
      if (res.status === 400 && /decommissioned|does not exist|not found/i.test(body) && (opts.model ?? groqChatModel()) !== FALLBACK_MODEL) {
        console.warn(`model ${opts.model ?? groqChatModel()} unavailable — falling back to ${FALLBACK_MODEL}`)
        return chat({ ...opts, model: FALLBACK_MODEL })
      }
      throw new Error(`Groq chat ${res.status}: ${body.slice(0, 300)}`)
    }
    const data = await res.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    recordUsage(opts.model ?? groqChatModel(), opts.kind ?? 'chat', data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0, Date.now() - t0, true)
    return data.choices[0]?.message?.content ?? ''
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const result = await ai.models.generateContent({
    model: opts.model ?? geminiModel(),
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    config: { systemInstruction: opts.system, temperature: opts.temperature ?? 0.2, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
  })
  return result.text ?? ''
}

// ─── Transcription ───

// Whisper emits these on silence/noise; treat them as empty so the live transcript wins.
const HALLUCINATIONS = [/subtitles? by/i, /amara\.org/i, /thank(s| you) for watching/i, /^\s*\.+\s*$/, /^\s*(you|bye|thank you)\.?\s*$/i]
export const stripHallucinations = (t: string) => HALLUCINATIONS.some(r => r.test(t)) ? '' : t

const EXT: Record<string, string> = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg' }

export async function transcribe(audio: { data: string; mimeType: string }, lang?: string): Promise<string> {
  assertConfigured()
  const bytes = Buffer.from(audio.data, 'base64')
  if (provider() === 'groq') {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: audio.mimeType }), `audio.${EXT[audio.mimeType] ?? 'm4a'}`)
    form.append('model', groqWhisperModel())
    form.append('response_format', 'json')
    form.append('temperature', '0')
    // Whisper takes ISO-639-1; leave unset for mixed Urdu/English so it auto-detects per segment.
    if (lang?.startsWith('ur')) form.append('language', 'ur')
    form.append('prompt', 'Executive voice note. May mix English, Urdu and Roman Urdu. Names: Zahoor, Furqan, Bilal, Sana. Currency in PKR.')
    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: form })
    if (!res.ok) throw new Error(`Groq transcription ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json() as { text: string }
    return stripHallucinations((data.text ?? '').trim())
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const result = await ai.models.generateContent({
    model: geminiModel(),
    contents: [{ role: 'user', parts: [
      { text: `Transcribe this audio verbatim. Keep the speaker's language; write Urdu/Hindi in Roman script if spoken that way.${lang ? ` Expected primary language: ${lang}.` : ''} Return only the transcript.` },
      { inlineData: { data: audio.data, mimeType: audio.mimeType || 'audio/mp4' } },
    ] }],
    config: { temperature: 0 },
  })
  return (result.text ?? '').trim()
}
