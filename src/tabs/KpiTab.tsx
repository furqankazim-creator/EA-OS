import { useEffect, useState } from 'react'
import { View, Pressable, ScrollView } from 'react-native'
import { T, Mono } from '@/components/T'
import { Bar, Header, Strip, between, row } from '@/components/ui'
import { useStore } from '@/store'
import { Chip } from '@/components/ui'
import type { LeadStage } from '@/types'
import { fetchAutomation, fetchMetrics } from '@/services/api'
import type { Metrics } from '@/types'
import type { Escalation } from '@/types'
import { C, alpha } from '@/theme'

export function KpiTab() {
  const { state, dispatch } = useStore()
  const [period, setPeriod] = useState<'Daily' | 'Weekly' | 'Monthly'>('Weekly')
  const [m, setM] = useState<Metrics | null>(null)
  useEffect(() => { fetchMetrics().then(setM).catch(() => {}) }, [state.lastSync])
  const goals0 = state.serverSettings?.goals ?? [{ metric: 'Revenue', target: 100000, unit: 'PKR', period: 'month' as const }, { metric: 'Pipeline', target: 20, unit: 'leads', period: 'month' as const }]
  const revGoal = goals0.find(g => /revenue/i.test(g.metric)) ?? goals0[0]
  const latestRevenue = state.kpis.filter(k => /revenue/i.test(k.metric)).sort((a, b) => (b.dateAt ?? '').localeCompare(a.dateAt ?? ''))[0]?.value ?? 0
  const revPct = Math.min(100, Math.round((latestRevenue / revGoal.target) * 100))
  const [auto, setAuto] = useState<{ escalation: Escalation; pipeline: Escalation; revenueHistory: { day: string; value: number | null }[] } | null>(null)
  useEffect(() => { fetchAutomation().then(a => setAuto({ escalation: a.escalation, pipeline: a.pipeline, revenueHistory: a.revenueHistory })).catch(() => {}) }, [state.kpis.length])
  const esc = auto?.escalation
  const latestOf = (m: RegExp) => state.kpis.filter(k => m.test(k.metric)).sort((a, b) => (b.dateAt ?? '').localeCompare(a.dateAt ?? ''))[0]?.value
  const TREND = { up: '↗', down: '↘', flat: '→' } as const
  const openTasks = state.assignments.filter(a => a.status !== 'done').length, doneTasks = state.assignments.filter(a => a.status === 'done').length
  const goals = goals0.map(g => {
    const actual = /revenue/i.test(g.metric) ? latestRevenue : latestOf(new RegExp(g.metric, 'i')) ?? 0
    return { name: `${g.period === 'month' ? 'Monthly ' : ''}${g.metric}`, actual, target: g.target, unit: g.unit, pct: Math.min(100, Math.round((actual / g.target) * 100)), trend: /revenue/i.test(g.metric) && esc ? `forecast ${esc.forecast.toLocaleString()}` : 'from conversations' }
  }).concat([
    { name: 'Deliverables', actual: doneTasks, target: doneTasks + openTasks, unit: 'tasks', pct: doneTasks + openTasks ? Math.round((doneTasks / (doneTasks + openTasks)) * 100) : 100, trend: `${openTasks} open` },
    { name: 'Team Active', actual: state.staff.filter(m => m.status === 'active').length, target: state.staff.length, unit: 'people', pct: state.staff.length ? Math.round((state.staff.filter(m => m.status === 'active').length / state.staff.length) * 100) : 0, trend: state.staff.filter(m => m.status !== 'active').map(m => `${m.name} ${m.status.replace('_', ' ')}`).join(', ') || 'all active' },
  ])
  const hist = auto?.revenueHistory ?? []
  const weekly = hist.map(h => h.value == null ? 0 : Math.min(100, Math.round((h.value / revGoal.target) * 100)))
  const days = hist.map(h => h.day)
  const gc = (p: number) => p >= 70 ? C.green500 : p >= 50 ? C.amber500 : C.red500
  const periods = ['Daily', 'Weekly', 'Monthly'] as const

  return (
    <View style={{ flex: 1 }}>
      <Header>
        <View style={[row, { justifyContent: 'space-between' }]}>
          <Mono size={14} weight="bold">KPI DASHBOARD</Mono>
          <View style={{ flexDirection: 'row' }}>
            {periods.map((p, i) => (
              <Pressable key={p} onPress={() => setPeriod(p)}
                style={{ paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: i === periods.length - 1 ? 0 : 1, borderRightColor: C.line2, backgroundColor: period === p ? alpha(C.primary, 0.1) : undefined }}>
                <Mono size={9} color={period === p ? C.primary : C.t10}>{p.toUpperCase()}</Mono>
              </Pressable>
            ))}
          </View>
        </View>
      </Header>
      <ScrollView style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <View style={[row, { justifyContent: 'space-between', marginBottom: 4 }]}>
            <Mono size={9} color={C.t10}>PRIMARY GOAL — MONTHLY REVENUE</Mono>
            <View style={{ borderWidth: 1, borderColor: !esc || esc.level === 1 ? C.green900 : esc.level === 2 ? C.yellow900 : esc.level === 3 ? C.orange900 : C.red900, paddingHorizontal: 4 }}>
              <Mono size={9} color={!esc || esc.level === 1 ? C.green400 : esc.level === 2 ? C.yellow400 : esc.level === 3 ? C.orange400 : C.red400}>{esc ? `LEVEL ${esc.level} · ${esc.label}` : 'LEVEL —'}</Mono>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12 }}>
            <View>
              <Mono size={36} weight="bold" color={C.yellow400}>{Math.round(latestRevenue / 1000)}k</Mono>
              <Mono size={12} color={C.t9} style={{ marginTop: 4 }}>of {Math.round(revGoal.target / 1000)}k {revGoal.unit} target · {esc ? `${esc.daysLeft} days left` : '…'}</Mono>
            </View>
            <Mono size={14} color={C.t9}>{revPct}%</Mono>
          </View>
          <View style={{ marginTop: 12 }}>
            <Bar pct={revPct} color={revPct >= 70 ? C.green500 : revPct >= 50 ? C.amber500 : C.red500} height={6} rounded />
          </View>
          <Mono size={10} color={esc && esc.forecast < revGoal.target ? C.yellow400 : C.green400} style={{ marginTop: 8 }}>{esc ? `At this pace: ${esc.forecast.toLocaleString()} ${revGoal.unit} by month end${esc.gap ? ` · gap ${esc.gap.toLocaleString()}` : ''}` : 'Forecast from server…'}</Mono>
        </View>
        <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Mono size={9} color={C.t10} style={{ marginBottom: 12 }}>LAST 7 DAYS (% OF TARGET) · FROM LOGGED KPI UPDATES</Mono>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 80 }}>
            {weekly.map((v, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <View style={{ width: '100%', height: (v / 100) * 70, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: i === weekly.length - 1 ? C.primary : C.line2, borderWidth: 1, borderColor: C.line5 }} />
                <Mono size={8} color={C.t10}>{days[i]}</Mono>
              </View>
            ))}
          </View>
        </View>
        <Strip><Mono size={9} color={C.t10}>OPERATING METRICS · 30 DAYS · IS EA-OS WORKING?</Mono></Strip>
        {m ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: C.line }}>
            {([['NOTES / DAY', m.notes_per_workday, m.notes_per_workday >= 5, '≥ 5'], ['CORRECTIONS / NOTE', m.corrections_per_note, m.corrections_per_note < 1, '< 1'], ['ON-TIME COMMITS', `${m.commitments_on_time_pct}%`, m.commitments_on_time_pct >= 80, '≥ 80%'], ['PLANS W/ OUTCOME', `${m.plans_with_outcome_pct}%`, m.plans_with_outcome_pct >= 80, '≥ 80%'], ['TEAM TASKS DONE', `${m.team_tasks_done_pct}%`, m.team_tasks_done_pct >= 70, '≥ 70%'], ['HOURS SAVED', `~${m.est_hours_saved}h`, true, `${m.entities_auto_logged} auto-logged`]] as const).map(([l, v, ok, target]) => (
              <View key={l} style={{ width: '33.33%', padding: 12, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.line3 }}>
                <Mono size={8} color={C.t10}>{l}</Mono>
                <Mono size={14} weight="bold" color={ok ? C.green400 : C.yellow400}>{String(v)}</Mono>
                <Mono size={8} color={C.t10}>{target}</Mono>
              </View>
            ))}
          </View>
        ) : <View style={{ padding: 12 }}><Mono size={9} color={C.t10}>Loads from the server.</Mono></View>}
        <Strip row>
          <Mono size={9} color={C.t10}>SALES PIPELINE · LEADS FROM VOICE NOTES</Mono>
          <Mono size={9} color={C.t9}>{state.leads.filter(l => !['won', 'lost'].includes(l.stage)).length} OPEN · {state.leads.filter(l => l.stage === 'won').length} WON</Mono>
        </Strip>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line }}>
          {(['new', 'contacted', 'qualified', 'proposal', 'won'] as LeadStage[]).map((st, i) => (
            <View key={st} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRightWidth: i === 4 ? 0 : 1, borderRightColor: C.line3 }}>
              <Mono size={14} weight="bold" color={st === 'won' ? C.green400 : C.t2}>{state.leads.filter(l => l.stage === st).length}</Mono>
              <Mono size={7} color={C.t10}>{st.toUpperCase()}</Mono>
            </View>
          ))}
        </View>
        {state.leads.filter(l => l.stage !== 'lost').slice(0, 12).map(l => (
          <View key={l.id} style={{ paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line3, opacity: l.stage === 'won' ? 0.7 : 1 }}>
            <View style={[row, { justifyContent: 'space-between' }]}>
              <T size={13} color={C.t1}>{l.name}{l.company ? ` · ${l.company}` : ''}</T>
              {!!l.value && <Mono size={11} weight="bold" color={C.green400}>{l.value.toLocaleString()}</Mono>}
            </View>
            {!!l.next_step && <Mono size={9} color={C.t9} style={{ marginTop: 2 }}>NEXT: {l.next_step}</Mono>}
            <View style={[row, { gap: 4, marginTop: 6, flexWrap: 'wrap' }]}>
              {(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as LeadStage[]).map(st => (
                <Chip key={st} size={8} px={6} py={2} label={st.toUpperCase()} active={l.stage === st} color={st === 'won' ? C.green400 : st === 'lost' ? C.red400 : C.primary}
                  onPress={() => dispatch({ type: 'patch', collection: 'leads', id: l.id, patch: { stage: st, updatedAt: new Date().toISOString() } })} />
              ))}
            </View>
          </View>
        ))}
        {!state.leads.length && <View style={{ padding: 16, alignItems: 'center' }}><Mono size={9} color={C.t10} center>NO LEADS YET — MENTION A PROSPECT IN A VOICE NOTE OR TELL THE ASSISTANT</Mono></View>}
        <Strip><Mono size={9} color={C.t10}>KPI UPDATES FROM CONVERSATIONS</Mono></Strip>
        {state.kpis.slice(0, 6).map(k => (
          <View key={k.id} style={[row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line3 }]}>
            <View><T size={13} color={C.t1}>{k.metric}</T><Mono size={9} color={C.t10}>{k.date} · {k.source}</Mono></View>
            <Mono size={13} weight="bold" color={k.trend === 'down' ? C.red400 : C.yellow400}>{TREND[k.trend] ?? '→'} {k.value.toLocaleString()} {k.unit}</Mono>
          </View>
        ))}
        {!state.kpis.length && <View style={{ padding: 16, alignItems: 'center' }}><Mono size={9} color={C.t10}>NONE YET</Mono></View>}
        <Strip><Mono size={9} color={C.t10}>ALL GOALS</Mono></Strip>
        {goals.map(g => (
          <View key={g.name} style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
            <View style={[row, { justifyContent: 'space-between', marginBottom: 8 }]}>
              <T size={14} color={C.t1}>{g.name}</T>
              <Mono size={14} weight="bold" color={gc(g.pct)}>{g.pct}%</Mono>
            </View>
            <View style={[row, { gap: 12 }]}>
              <View style={{ flex: 1 }}><Bar pct={g.pct} color={gc(g.pct)} /></View>
              <Mono size={9} color={C.t9}>{g.actual.toLocaleString()}/{g.target.toLocaleString()} {g.unit}</Mono>
            </View>
            <Mono size={9} color={C.t10} style={{ marginTop: 4 }}>{g.trend}</Mono>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
