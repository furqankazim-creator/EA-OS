import Constants from 'expo-constants'
import { Platform } from 'react-native'
import type { Extraction, ChallengeAnalysis, FollowUp, ServerSettings, EmailDraft, Invoice, Escalation, ClientProfile, Forecast, Metrics } from '@/types'
import { EMPTY_EXTRACTION } from '@/types'

// Resolve the server. Priority: EXPO_PUBLIC_API_URL → the Metro dev host (same LAN IP) on port 3001 → localhost.
export function apiBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL
  if (env) return env.replace(/\/$/, '')
  const host = Constants.expoConfig?.hostUri?.split(':')[0]
  if (host && Platform.OS !== 'web') return `http://${host}:3001`
  return 'http://localhost:3001'
}
const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      ...init, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(init.headers ?? {}) },
    })
    if (!res.ok) {
      let msg = ''
      try { msg = (await res.json()).error ?? '' } catch { /* not json */ }
      throw new Error(msg || `Server ${res.status}`)
    }
    return await res.json()
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Request timed out')
    throw e
  } finally { clearTimeout(t) }
}
const post = <T,>(path: string, body: unknown, timeoutMs?: number) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }, timeoutMs)

// ─── Extraction ───
export interface ExtractRequest { transcript?: string; audio?: { data: string; mimeType: string }; lang?: string }
export interface ExtractResponse { transcript: string; extraction: Extraction; followUps: FollowUp[] }
export async function extractConversation(req: ExtractRequest): Promise<ExtractResponse> {
  const json = await post<{ transcript?: string; extraction?: Partial<Extraction>; followUps?: FollowUp[] }>('/api/conversations/extract', req, 120_000)
  return { transcript: String(json.transcript ?? req.transcript ?? ''), extraction: normalize(json.extraction), followUps: json.followUps ?? [] }
}
export function normalize(raw: Partial<Extraction> | null | undefined): Extraction {
  const out: Extraction = { ...EMPTY_EXTRACTION }
  if (!raw) return out
  out.summary = typeof raw.summary === 'string' ? raw.summary : ''
  for (const k of Object.keys(EMPTY_EXTRACTION) as (keyof Extraction)[]) {
    if (k === 'summary') continue
    const v = raw[k]
    ;(out as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? v : []
  }
  return out
}

// ─── AI Solver ───
export const analyzeChallenge = (p: { title: string; description?: string; severity?: string; context?: string }) =>
  post<ChallengeAnalysis>('/api/challenges/analyze', p, 120_000)

// ─── Assistant (with tools) ───
export interface ChatMessage { role: 'user' | 'assistant'; content: string; actions?: string[] }
export const askAssistant = (message: string, history: ChatMessage[], context: unknown) =>
  post<{ reply: string; actions: string[] }>('/api/assistant/chat', { message, history: history.map(h => ({ role: h.role, content: h.content })), context }, 120_000)

// ─── Sync ───
export interface Mutation { collection: string; id: string; data: Record<string, unknown> | null; updated_at: number }
export const syncPush = (mutations: Mutation[]) => post<{ applied: { collection: string; id: string }[]; serverTime: number }>('/api/sync/push', { mutations }, 30_000)
export const syncPull = (since: number) => call<{ docs: { collection: string; id: string; data: Record<string, unknown>; updated_at: number; deleted: boolean }[]; serverTime: number }>(`/api/sync/pull?since=${since}`, {}, 30_000)
export const registerPushToken = (token: string, platform: string) => post('/api/sync/push-token', { token, platform }, 15_000)

// ─── Settings / automation / ops ───
export const fetchSettings = () => call<ServerSettings>('/api/settings', {}, 15_000).catch(() => null)
export const saveSettings = (s: Partial<ServerSettings>) => call<ServerSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }, 15_000)
export const fetchAutomation = () => call<{ jobs: { id: string; kind: string; run_at: number; status: string; last_error?: string }[]; escalation: Escalation; pipeline: Escalation; finance: { last30Expenses: number; payroll: number; burn: number; cash: number; runwayMonths: number; receivables: number }; revenueHistory: { day: string; value: number | null }[] }>('/api/automation', {}, 15_000)
export const runJob = (kind: string) => post<{ ok: boolean; note: string }>(`/api/automation/run/${kind}`, {}, 15_000)
export const sendEmail = (id: string) => post<EmailDraft>(`/api/emails/${id}/send`, {}, 30_000)
export const draftEmail = (to: string, brief: string, kind = 'custom') => post<EmailDraft>('/api/emails/draft', { to, brief, kind }, 60_000)
export const createInvoice = (inv: Partial<Invoice> & { dueDays?: number }) => post<Invoice>('/api/invoices', inv, 15_000)
export const fetchClientProfile = (id: string) => call<ClientProfile>(`/api/clients/${encodeURIComponent(id)}/profile`, {}, 20_000)
export const fetchForecast = () => call<{ scenarios: Forecast[]; generatedAt: string }>('/api/finance/forecast', {}, 20_000)
export const fetchMetrics = () => call<Metrics>('/api/metrics', {}, 15_000)
export const reportUrl = () => `${apiBaseUrl()}/api/report`
export const testNotification = () => post('/api/notify/test', {}, 15_000)

export async function serverHealth(): Promise<{ ok: boolean; provider?: string; model?: string; hasKey?: boolean; auth?: boolean; smtp?: boolean } | null> {
  try { return await call('/health', {}, 8_000) } catch { return null }
}

export async function logCorrection(transcript: string, category: string, original: unknown, corrected: unknown | null) {
  try {
    // Only send a small snippet of the transcript around the words that might have caused it.
    // We send up to 500 characters of the transcript for context.
    const snippet = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript
    await fetch(`${apiBaseUrl()}/api/conversations/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: snippet, category, original, corrected })
    })
  } catch (e) {
    console.warn('Failed to log correction:', e)
  }
}
