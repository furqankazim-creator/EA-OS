export type Tab = 'home' | 'convos' | 'extract' | 'decisions' | 'finance' | 'kpi' | 'problems' | 'ops' | 'bot'

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'HOME', icon: '⬡' },
  { id: 'bot', label: 'BOT', icon: '🤖' },
  { id: 'convos', label: 'LOGS', icon: '◈' },
  { id: 'extract', label: 'EXTRACT', icon: '◎' },
  { id: 'decisions', label: 'ACTIONS', icon: '◉' },
  { id: 'finance', label: 'FINANCE', icon: '◆' },
  { id: 'kpi', label: 'KPI', icon: '▲' },
  { id: 'problems', label: 'SOLVE', icon: '◯' },
  { id: 'ops', label: 'OPS', icon: '⊞' },
]
