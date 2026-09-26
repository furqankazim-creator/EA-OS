import { useState } from 'react'
import { View, Pressable, Linking, Alert, Platform } from 'react-native'
import { T, Mono } from './T'
import { Chip, row, between } from './ui'
import { useStore, uid, fmtDate } from '@/store'
import { draftEmail } from '@/services/api'
import type { Recommendation, RecAction } from '@/types'
import { C, alpha } from '@/theme'

const CAT_ICON: Record<string, string> = { health: '🏥', instructions: '🎯', commitments: '🤝', finance: '💰', problems: '🔴', leads: '🧲', decisions: '🚀', kpi_updates: '📊', staff_mentions: '👥', suggestions: '💡' }
const URG = { high: C.red400, medium: C.yellow400, low: C.green400 } as const

function parseBy(by: string): Date {
  const d = new Date(); d.setHours(9, 0, 0, 0)
  const s = by.toLowerCase()
  const inN = s.match(/in (\d+) day/); if (inN) { d.setDate(d.getDate() + Number(inN[1])); return d }
  if (s.includes('tomorrow')) { d.setDate(d.getDate() + 1); return d }
  const dow = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].findIndex(x => s.includes(x))
  if (dow >= 0) { let diff = (dow - d.getDay() + 7) % 7; if (!diff) diff = 7; d.setDate(d.getDate() + diff); return d }
  const t = Date.parse(by + ' ' + d.getFullYear()); if (!isNaN(t)) return new Date(t)
  d.setDate(d.getDate() + 1); return d
}

// Executes one recommended action against the store / device. Returns a short confirmation.
export function useRunAction(onAsk?: (prompt: string) => void, onNavigate?: (tab: string) => void) {
  const { state, dispatch } = useStore()
  return async (a: RecAction): Promise<string> => {
    switch (a.type) {
      case 'map': { const q = encodeURIComponent(a.query); await Linking.openURL(Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`)); return 'Opened maps' }
      case 'call': await Linking.openURL(`tel:${a.phone.replace(/[^0-9+]/g, '')}`); return 'Calling'
      case 'link': await Linking.openURL(a.url); return 'Opened'
      case 'remind': { const due = parseBy(a.by); dispatch({ type: 'put', collection: 'decisions', doc: { id: uid(), type: 'Commitment', title: a.text, who: 'Ahmed (me)', by: fmtDate(due.toISOString()), dueAt: due.toISOString(), date: fmtDate(new Date().toISOString()), status: 'pending', source: 'Recommendation' } }); return `Reminder set for ${fmtDate(due.toISOString())}` }
      case 'assign': { const due = new Date(); due.setDate(due.getDate() + Math.max(1, a.deadline_days)); due.setHours(18, 0, 0, 0); const who = state.staff.find(m => a.assignee.toLowerCase().includes(m.name.toLowerCase()))?.name ?? a.assignee; dispatch({ type: 'put', collection: 'assignments', doc: { id: uid(), task: a.task, assignee: who, due: fmtDate(due.toISOString()), dueAt: due.toISOString(), status: 'pending', source: 'Recommendation' } }); return `Delegated to ${who} — see Ops › Tasks` }
      case 'solver': { const id = uid(); dispatch({ type: 'put', collection: 'problems', doc: { id, title: a.title, description: a.description, severity: a.severity, date: fmtDate(new Date().toISOString()), status: 'open', analysis: null, source: 'Recommendation' } }); onNavigate?.('problems'); return 'Challenge added — the board runs automatically for high severity' }
      case 'email': { const d = await draftEmail(a.to, a.brief); dispatch({ type: 'put', collection: 'emails', doc: d, local: true }); onNavigate?.('ops'); return `Draft "${d.subject}" ready in Ops › Email` }
      case 'ask': onAsk?.(a.prompt); onNavigate?.('bot'); return 'Sent to assistant'
      default: return 'Unknown action'
    }
  }
}

export function RecommendationCard({ r, compact, onAsk, onNavigate }: { r: Recommendation; compact?: boolean; onAsk?: (p: string) => void; onNavigate?: (tab: string) => void }) {
  const { dispatch } = useStore()
  const run = useRunAction(onAsk, onNavigate)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const act = async (a: RecAction) => {
    setBusy(a.label)
    try { setNote(await run(a)); if (a.type !== 'map' && a.type !== 'call' && a.type !== 'link' && a.type !== 'ask') dispatch({ type: 'patch', collection: 'recommendations', id: r.id, patch: { status: 'done' } }) }
    catch (e) { Alert.alert('Could not do that', (e as Error).message) } finally { setBusy(null) }
  }
  return (
    <View style={{ borderWidth: 1, borderColor: r.status === 'new' ? alpha(URG[r.urgency], 0.5) : C.line2, backgroundColor: r.status === 'new' ? alpha(URG[r.urgency], 0.05) : undefined, padding: 12, opacity: r.status === 'dismissed' ? 0.5 : 1 }}>
      <View style={[between, { alignItems: 'center' }]}>
        <View style={[row, { gap: 6 }]}>
          <T size={12}>{CAT_ICON[r.category] ?? '•'}</T>
          <Mono size={9} color={URG[r.urgency]}>{r.urgency.toUpperCase()} · {r.category.replace(/_/g, ' ').toUpperCase()}</Mono>
        </View>
        {r.status === 'new' && <Pressable onPress={() => dispatch({ type: 'patch', collection: 'recommendations', id: r.id, patch: { status: 'dismissed' } })} hitSlop={8}><Mono size={12} color={C.t10}>✕</Mono></Pressable>}
        {r.status === 'done' && <Mono size={9} color={C.green400}>✓ DONE</Mono>}
      </View>
      <T size={14} weight="semibold" color={C.t1} style={{ marginTop: 6 }}>{r.title}</T>
      {!compact && <T size={12} color={C.t3} relaxed style={{ marginTop: 3 }}>{r.detail}</T>}
      {!!r.places?.length && !compact && (
        <View style={{ marginTop: 8, gap: 6 }}>
          {r.places.map((p, i) => (
            <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: C.pink900, paddingLeft: 8 }}>
              <T size={12} weight="medium" color={C.t1}>📍 {p.name}</T>
              <T size={11} color={C.t7}>{p.detail}{p.address ? ` · ${p.address}` : ''}{p.phone ? ` · ${p.phone}` : ''}</T>
            </View>
          ))}
        </View>
      )}
      {r.status !== 'dismissed' && (
        <View style={[row, { gap: 6, marginTop: 10, flexWrap: 'wrap' }]}>
          {r.actions.map((a, i) => (
            <Chip key={i} size={9} label={busy === a.label ? '⟳ ' + a.label.toUpperCase() : (a.type === 'map' ? '📍 ' : a.type === 'call' ? '📞 ' : a.type === 'remind' ? '⏰ ' : a.type === 'assign' ? '👤 ' : a.type === 'solver' ? '🧠 ' : a.type === 'email' ? '✉ ' : a.type === 'ask' ? '💬 ' : '↗ ') + a.label.toUpperCase()}
              active color={a.type === 'solver' ? C.orange400 : a.type === 'call' ? C.green400 : C.primary} bg={alpha(C.primary, 0.05)} onPress={() => act(a)} disabled={busy !== null} />
          ))}
        </View>
      )}
      {!!note && <Mono size={9} color={C.green400} style={{ marginTop: 6 }}>✓ {note}</Mono>}
    </View>
  )
}
