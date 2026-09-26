import { useEffect, useState } from 'react'
import { View, Pressable, ScrollView } from 'react-native'
import { T, Mono } from '@/components/T'
import { Bar, Chip, between, row } from '@/components/ui'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { SettingsScreen } from '@/components/SettingsScreen'
import { RecommendationCard } from '@/components/RecommendationCard'
import { useStore, fmtTime, fmtDuration } from '@/store'
import { fetchAutomation, runJob } from '@/services/api'
import type { Tab } from './types'
import type { Escalation, Notification } from '@/types'
import { C, alpha } from '@/theme'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const LEVEL_COLOR = { 1: C.green400, 2: C.yellow400, 3: C.orange400, 4: C.red400 } as const
const LEVEL_BORDER = { 1: C.green900, 2: C.yellow900, 3: C.orange900, 4: C.red900 } as const
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d` }

export function HomeTab({ onNavigate, onOpenExtraction, onOpen }: { onNavigate: (t: Tab) => void; onOpenExtraction: (id: string) => void; onOpen: (link?: { tab: string; id?: string }) => void }) {
  const { state, dispatch, online, syncNow } = useStore()
  const [showSettings, setShowSettings] = useState(false)
  const [showInbox, setShowInbox] = useState(false)
  const [esc, setEsc] = useState<Escalation | null>(null)
  const [pipeline, setPipeline] = useState<Escalation | null>(null)
  const [runningBrief, setRunningBrief] = useState(false)
  useEffect(() => { fetchAutomation().then(a => { setEsc(a.escalation); setPipeline(a.pipeline) }).catch(() => {}) }, [state.kpis.length, state.lastSync])

  const now = new Date()
  const todayKey = now.toDateString()
  const todayCount = state.conversations.filter(c => new Date(c.createdAt).toDateString() === todayKey).length
  const dueCount = state.decisions.filter(d => d.type === 'Commitment' && d.status !== 'completed').length + state.assignments.filter(a => a.status !== 'done').length
  const greeting = now.getHours() < 12 ? 'Good morning,' : now.getHours() < 17 ? 'Good afternoon,' : 'Good evening,'
  const name = state.serverSettings?.founderName ?? 'Ahmed'
  const latestRevenue = state.kpis.filter(k => /revenue/i.test(k.metric)).sort((a, b) => (b.dateAt ?? '').localeCompare(a.dateAt ?? ''))[0]
  const revenue = esc?.actual ?? latestRevenue?.value ?? 0
  const target = esc?.target ?? state.serverSettings?.goals.find(g => /revenue/i.test(g.metric))?.target ?? 100000
  const unread = state.notifications.filter(n => !n.read)
  const brief = state.briefs.filter(b => b.kind === 'morning').sort((a, b) => b.ts.localeCompare(a.ts))[0]
  const openTasks = state.assignments.filter(a => a.status !== 'done').length
  const doneTasks = state.assignments.filter(a => a.status === 'done').length
  const pct = (a: number, b: number) => b ? Math.min(100, Math.round((a / b) * 100)) : 0

  const kpis = [
    { label: 'REVENUE', val: `${Math.round(revenue / 1000)}k`, target: `${Math.round(target / 1000)}k`, pct: pct(revenue, target), col: esc ? LEVEL_COLOR[esc.level] : C.orange400 },
    { label: 'PIPELINE', val: String(pipeline?.actual ?? state.kpis.find(k => /pipeline/i.test(k.metric))?.value ?? 0), target: String(pipeline?.target ?? 20), pct: pipeline?.pct ?? 0, col: C.red400 },
    { label: 'TASKS', val: String(doneTasks), target: String(doneTasks + openTasks), pct: pct(doneTasks, doneTasks + openTasks), col: C.green400 },
  ]

  const openNotification = (n: Notification) => {
    if (!n.read) dispatch({ type: 'patch', collection: 'notifications', id: n.id, patch: { read: true } })
    setShowInbox(false)
    onOpen(n.link)
  }

  return (
    <View style={{ flex: 1 }}>
      {showSettings && <SettingsScreen onClose={() => setShowSettings(false)} />}
      {showInbox && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, backgroundColor: C.bg }}>
          <View style={[between, { alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }]}>
            <View><Mono size={14} weight="bold">INBOX</Mono><Mono size={9} color={C.t10} style={{ marginTop: 2 }}>BRIEFS · REMINDERS · ALERTS FROM YOUR AUTOMATIONS</Mono></View>
            <View style={[row, { gap: 10 }]}>
              {unread.length > 0 && <Chip size={9} label="READ ALL" onPress={() => dispatch({ type: 'notifications/readAll' })} />}
              <Pressable onPress={() => setShowInbox(false)} hitSlop={12}><Mono size={20} color={C.t9}>✕</Mono></Pressable>
            </View>
          </View>
          <ScrollView>
            {state.notifications.slice().sort((a, b) => b.ts.localeCompare(a.ts)).map(n => (
              <Pressable key={n.id} onPress={() => openNotification(n)} style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line3, backgroundColor: n.read ? undefined : alpha(C.primary, 0.04) }}>
                <View style={[between, { marginBottom: 4 }]}>
                  <View style={[row, { gap: 8 }]}>
                    {!n.read && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary }} />}
                    <Mono size={9} color={C.t9}>{n.kind.replace(/_/g, ' ').toUpperCase()}</Mono>
                  </View>
                  <Mono size={9} color={C.t10}>{ago(n.ts)}</Mono>
                </View>
                <T size={14} weight={n.read ? 'regular' : 'semibold'} color={C.t1}>{n.title}</T>
                <T size={12} color={C.t7} style={{ marginTop: 3 }} numberOfLines={4}>{n.body}</T>
                {n.link && <Mono size={9} color={C.primary} style={{ marginTop: 4 }}>OPEN {n.link.tab.toUpperCase()} →</Mono>}
              </Pressable>
            ))}
            {!state.notifications.length && <View style={{ padding: 40, alignItems: 'center' }}><Mono size={10} color={C.t10} center>NOTHING YET — THE MORNING BRIEF, REMINDERS AND ALERTS LAND HERE</Mono></View>}
          </ScrollView>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={[between, { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.line }]}>
          <View style={{ flex: 1 }}>
            <Mono size={12} color={C.t9} style={{ marginBottom: 4 }}>{MONTHS[now.getMonth()]} {now.getDate()}, {now.getFullYear()} — {fmtTime(now.toISOString())}</Mono>
            <T size={24} weight="bold" style={{ letterSpacing: -0.5, lineHeight: 30 }}>{greeting}{'\n'}<T size={24} weight="bold" color={C.primary}>{name}.</T></T>
            <T size={14} color={C.t8} style={{ marginTop: 4 }}>{todayCount} conversation{todayCount === 1 ? '' : 's'} today · {dueCount} open item{dueCount === 1 ? '' : 's'}</T>
          </View>
          <View style={[row, { gap: 14, marginTop: 4 }]}>
            <Pressable onPress={() => setShowInbox(true)} hitSlop={8}>
              <Mono size={18} color={unread.length ? C.primary : C.t10}>🔔</Mono>
              {unread.length > 0 && <View style={{ position: 'absolute', top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}><Mono size={8} weight="bold" color="#fff">{unread.length}</Mono></View>}
            </Pressable>
            <Pressable onPress={() => setShowSettings(true)} hitSlop={8} style={{ alignItems: 'center' }}>
              <Mono size={18} color={C.t10}>⚙</Mono>
              <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 2, backgroundColor: online ? C.green500 : C.red500 }} />
            </Pressable>
          </View>
        </View>

        {/* KPI snapshot */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line }}>
          {kpis.map((k, i) => (
            <Pressable key={k.label} onPress={() => onNavigate(k.label === 'TASKS' ? 'ops' : 'kpi')} style={{ flex: 1, padding: 16, borderRightWidth: i === kpis.length - 1 ? 0 : 1, borderRightColor: C.line }}>
              <Mono size={9} color={C.t9} style={{ marginBottom: 4 }}>{k.label}</Mono>
              <Mono size={18} weight="bold" color={k.col}>{k.val}</Mono>
              <Mono size={9} color={C.t10}>/{k.target}</Mono>
              <View style={{ marginTop: 8 }}><Bar pct={k.pct} color={k.pct >= 70 ? C.green500 : k.pct >= 50 ? C.amber500 : C.red500} /></View>
            </Pressable>
          ))}
        </View>

        {/* Escalation (computed on the server from goals + pace) */}
        {esc && esc.level >= 2 && (
          <View style={{ marginHorizontal: 20, marginTop: 16, padding: 12, borderWidth: 1, borderColor: LEVEL_BORDER[esc.level], backgroundColor: alpha(LEVEL_COLOR[esc.level], 0.06) }}>
            <Mono size={10} weight="semibold" color={LEVEL_COLOR[esc.level]}>⚠ ESCALATION LEVEL {esc.level} — {esc.label}</Mono>
            <T size={12} color={C.t4} style={{ marginTop: 4 }}>{esc.metric} at {esc.actual.toLocaleString()} of {esc.target.toLocaleString()} ({esc.pct}%). At this pace you finish at {esc.forecast.toLocaleString()} — {esc.gap.toLocaleString()} short with {esc.daysLeft} days left.</T>
            <View style={[row, { gap: 12, marginTop: 8 }]}>
              <Pressable onPress={() => onNavigate('problems')}><Mono size={10} color={LEVEL_COLOR[esc.level]} underline>ANALYZE →</Mono></Pressable>
              <Pressable onPress={() => onNavigate('bot')}><Mono size={10} color={LEVEL_COLOR[esc.level]} underline>ASK ASSISTANT →</Mono></Pressable>
            </View>
          </View>
        )}
        {esc && esc.level === 1 && (
          <View style={{ marginHorizontal: 20, marginTop: 16, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: C.green900 }}>
            <Mono size={9} color={C.green400}>● ON TRACK — {esc.metric} {esc.pct}% of target, forecast {esc.forecast.toLocaleString()}</Mono>
          </View>
        )}

        {/* Morning brief */}
        <View style={{ marginHorizontal: 20, marginTop: 12, borderWidth: 1, borderColor: C.line2, backgroundColor: C.panel2, padding: 12 }}>
          <View style={[between, { alignItems: 'center' }]}>
            <Mono size={9} weight="semibold" color={C.primary}>☀ MORNING BRIEF{brief ? ` · ${ago(brief.ts)} ago` : ''}</Mono>
            <Chip size={8} label={runningBrief ? '⟳' : brief ? 'REFRESH' : 'GENERATE'} px={6} py={2} onPress={async () => { setRunningBrief(true); try { await runJob('morning_brief'); setTimeout(() => { void syncNow(); setRunningBrief(false) }, 25000) } catch { setRunningBrief(false) } }} />
          </View>
          {brief ? <T size={13} color={C.t2} relaxed style={{ marginTop: 6 }}>{brief.text}</T>
            : <T size={12} color={C.t9} style={{ marginTop: 6 }}>Generated automatically at {String(state.serverSettings?.notifications.briefHour ?? 7).padStart(2, '0')}:30 every day — or tap GENERATE now.</T>}
        </View>

        {/* Proactive next steps generated from your recordings */}
        {(() => {
          const recs = state.recommendations.filter(r => r.status === 'new').sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.urgency] - { high: 0, medium: 1, low: 2 }[b.urgency]) || b.createdAt.localeCompare(a.createdAt))
          if (!recs.length) return null
          return (
            <View style={{ marginHorizontal: 20, marginTop: 12, gap: 8 }}>
              <View style={[between, { alignItems: 'center' }]}>
                <Mono size={9} weight="semibold" color={C.primary}>⚡ NEXT STEPS FOR YOU · {recs.length}</Mono>
                <Pressable onPress={() => onNavigate('bot')}><Mono size={9} color={C.t9}>ALL IN BOT →</Mono></Pressable>
              </View>
              {recs.slice(0, 3).map(r => <RecommendationCard key={r.id} r={r} compact onNavigate={t => onNavigate(t as Tab)} />)}
            </View>
          )
        })()}

        {/* Record section */}
        <VoiceRecorder onSaved={onOpenExtraction} />

        {/* Recent activity */}
        <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 20, paddingVertical: 16 }}>
          <Mono size={9} color={C.t10} style={{ marginBottom: 12 }}>RECENT ACTIVITY</Mono>
          {state.conversations.slice(0, 3).map(c => (
            <Pressable key={c.id} onPress={() => onOpenExtraction(c.id)} style={[row, { justifyContent: 'space-between', marginBottom: 8 }]}>
              <View style={[row, { gap: 8, flex: 1 }]}>
                <Mono size={10} color={C.t9}>{fmtTime(c.createdAt)}</Mono>
                <T size={12} color={C.t6} numberOfLines={1} style={{ maxWidth: 200 }}>{(c.extracted?.summary || c.transcript || '…').slice(0, 42)}…</T>
              </View>
              <Mono size={9} color={c.status === 'processing' ? C.primary : c.status === 'failed' ? C.red400 : c.status === 'extracted' ? C.yellow400 : C.t10}>
                {c.status === 'processing' ? '⟳' : c.status === 'failed' ? '✕' : c.status === 'extracted' ? 'REVIEW' : fmtDuration(c.durationSec)}
              </Mono>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
