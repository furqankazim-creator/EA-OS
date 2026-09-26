// ─── Extraction schema (mirrors the prompt in server/src/routes/conversations.ts) ───

export type Severity = 'low' | 'medium' | 'high'

export interface Extraction {
  summary: string
  instructions: { text: string; assigned_to: string | null }[]
  decisions: { title: string; description: string }[]
  commitments: { who: string; what: string; by: string; source_quote: string; dueAt?: string }[]
  finance: { amount: number; currency: string; office_portion: number; personal_portion: number; category: string; description: string }[]
  health: { type: 'workout' | 'diet' | 'injury' | 'sleep' | 'metric'; notes: string; action_recommended: string }[]
  problems: { title: string; description: string; severity: Severity }[]
  staff_mentions: { name: string; context: string }[]
  kpi_updates: { metric: string; value: number; unit: string; trend: 'up' | 'down' | 'flat' }[]
  suggestions: { text: string; rationale: string }[]
  leads: { name: string; company: string | null; stage: LeadStage; value: number | null; next_step: string }[]
}
export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'
export type ExtractionKey = Exclude<keyof Extraction, 'summary'>
export const EMPTY_EXTRACTION: Extraction = {
  summary: '', instructions: [], decisions: [], commitments: [], finance: [], health: [],
  problems: [], staff_mentions: [], kpi_updates: [], suggestions: [], leads: [],
}

export interface FollowUp { id: string; title: string; action: 'completed' | 'delayed' | 'cancelled'; new_by?: string; evidence: string; applied?: boolean }

// ─── App entities (every synced doc carries `_u` = last-updated ms for last-write-wins) ───

export interface Synced { _u?: number }

export interface Conversation extends Synced {
  id: string; createdAt: string; durationSec: number; transcript: string; lang: string
  source: 'voice' | 'text' | 'sample'; extracted: Extraction | null; followUps?: FollowUp[]
  status: 'processing' | 'extracted' | 'committed' | 'failed'; error?: string
}
export interface Decision extends Synced {
  id: string; type: 'Decision' | 'Commitment'; title: string; description?: string; who?: string; by?: string; dueAt?: string
  date: string; status: 'active' | 'pending' | 'in_progress' | 'overdue' | 'completed'; source: string; sourceQuote?: string
}
export interface Expense extends Synced {
  id: string; desc: string; amount: number; currency: string; office: number; personal: number; category: string
  date: string; dateAt?: string; verified: boolean; auto: boolean
}
export interface Perspective { name: string; verdict: string; pros: string[]; cons: string[] }
export interface ChallengeAnalysis {
  consensus_summary: string; root_cause: string; models: Perspective[]; disagreements: string[]
  action_items: { task: string; assignee: string; deadline_days: number }[]
  decisions_to_record: { title: string; description: string }[]
  engine?: string; generated_at?: string
  playbook?: { id: string; title: string; trigger: string; steps: { step: string; owner: string; days: number }[]; timesWorked: number } | null
  scenarios?: { name: string; assumptions: string[]; minCash: number; minCashWeek: number; endCash: number; revenue90: number; shortfallWeek: number | null }[]
  baseline?: { minCash: number; endCash: number; revenue90: number; shortfallWeek: number | null }
}
export interface Playbook extends Synced { id: string; title: string; trigger: string; keywords: string[]; steps: { step: string; owner: string; days: number }[]; metrics?: string[]; timesWorked: number; sourceProblems: string[]; createdAt: string }
export interface Tripwire extends Synced { id: string; problemId: string; problemTitle: string; metric: string; op: '<' | '>'; value: number; checkAfter: string; label: string; fallback: string; status: 'armed' | 'fired' | 'cleared'; firedAt?: string; observed?: number }
export interface Forecast { scenario: string; weeks: { week: number; startsAt: string; inflow: number; outflow: number; cash: number; revenue: number; cumulativeRevenue: number }[]; minCash: number; minCashWeek: number; endCash: number; revenue90: number; runwayWeeks: number | null; shortfallWeek: number | null }
export interface Metrics { notes_per_workday: number; corrections_per_note: number; commitments_on_time_pct: number; commitments_closed: number; plans_with_outcome_pct: number; plans_worked: number; avg_hours_problem_to_plan_high: number; receivables_over_30d: number; team_tasks_done_pct: number; entities_auto_logged: number; est_hours_saved: number }
export type ProblemStatus = 'open' | 'analyzing' | 'action_planned' | 'resolved'
export interface Problem extends Synced {
  id: string; title: string; description: string; severity: Severity; date: string; status: ProblemStatus
  analysis: ChallengeAnalysis | null; committed?: boolean; error?: string; source?: string
  outcome?: 'worked' | 'partial' | 'failed'; outcomeNote?: string; outcomeAskedAt?: string
  quality?: { timeliness: number; evidence: number; execution: number; outcome: number | null; score: number }
}
export interface Assignment extends Synced {
  id: string; task: string; assignee: string; due: string; dueAt: string; status: 'pending' | 'in_progress' | 'done'; source: string; problemId?: string
  replies?: { at: string; text: string }[]; doneVia?: string
}
export interface HealthEntry extends Synced {
  id: string; date: string; time: string; type?: string; note: string; action?: string; source: 'conversation' | 'manual'; severity: 'good' | 'low' | 'medium' | 'high'
}
export interface KpiUpdate extends Synced { id: string; metric: string; value: number; unit: string; trend: 'up' | 'down' | 'flat'; date: string; dateAt?: string; source: string }
export interface StaffMember extends Synced { id: string; name: string; role: string; status: string; assignments?: number; salary: number; phone?: string; email?: string }
export interface Client extends Synced { id: string; name: string; email?: string; phone?: string; aliases?: string[] }
export interface Lead extends Synced { id: string; name: string; company?: string; stage: LeadStage; value?: number; next_step?: string; source: string; createdAt: string; updatedAt?: string }
export interface Correction extends Synced { id: string; category: string; action: 'edit' | 'discard'; before: unknown; after: unknown; transcript: string; ts: string }
export interface ClientProfile {
  client: Client
  stats: { mentions: number; invoices: number; outstanding: number; paid: number; openCommitments: number; openProblems: number; leads: number }
  timeline: { at: string; type: string; text: string }[]
  invoices: Invoice[]; commitments: Decision[]; problems: Problem[]; leads: Lead[]
}
export interface Invoice extends Synced {
  id: string; number: string; client: string; email?: string; amount: number; currency: string; issuedAt: string; dueAt: string
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'; description?: string; chaseStage: number; lastChasedAt?: string; sourceCommitmentId?: string
}
export interface EmailDraft extends Synced {
  id: string; kind: string; to: string; subject: string; body: string; status: 'draft' | 'sent' | 'failed'
  refId?: string; createdAt: string; sentAt?: string; error?: string; source: string
}
export interface Notification extends Synced { id: string; ts: string; kind: string; title: string; body: string; read: boolean; link?: { tab: string; id?: string } }
export interface Brief extends Synced { id: string; kind: string; ts: string; text: string; facts?: string[]; escalation?: Escalation }
export interface Escalation { level: 1 | 2 | 3 | 4; label: string; metric: string; actual: number; target: number; pct: number; daysLeft: number; forecast: number; gap: number; tone: string }

export interface ServerSettings {
  founderName: string; timezone: string; currency: string; cashBalance: number
  goals: { metric: string; target: number; unit: string; period: 'month' }[]
  notifications: { morningBrief: boolean; eodRecap: boolean; reminders: boolean; overdue: boolean; briefHour: number; recapHour: number }
  email: { from: string; signature: string }
  location: { city: string; area: string; country: string }
}

export type RecAction =
  | { type: 'map'; label: string; query: string }
  | { type: 'call'; label: string; phone: string }
  | { type: 'link'; label: string; url: string }
  | { type: 'remind'; label: string; text: string; by: string }
  | { type: 'assign'; label: string; task: string; assignee: string; deadline_days: number }
  | { type: 'solver'; label: string; title: string; description: string; severity: Severity }
  | { type: 'email'; label: string; to: string; brief: string }
  | { type: 'ask'; label: string; prompt: string }
export interface Recommendation extends Synced {
  id: string; conversationId: string; category: string; itemText: string
  title: string; detail: string; urgency: 'low' | 'medium' | 'high'
  places?: { name: string; detail: string; phone?: string; address?: string; source?: string }[]
  actions: RecAction[]; status: 'new' | 'done' | 'dismissed'; createdAt: string
}
