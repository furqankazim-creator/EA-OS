import { useState } from 'react'
import { View, Pressable, ScrollView, TextInput, Alert } from 'react-native'
import { T, Mono } from '@/components/T'
import { Chip, Header, Strip, between, row } from '@/components/ui'
import { StatusBadge } from '@/components/StatusBadge'
import { useStore, fmtTime, fmtDuration, countItems } from '@/store'
import { extractConversation } from '@/services/api'
import type { Conversation, ExtractionKey } from '@/types'
import { C, F, alpha } from '@/theme'

const CAT_FILTERS: { label: string; key: ExtractionKey | 'All' }[] = [
  { label: 'All', key: 'All' }, { label: 'Instructions', key: 'instructions' }, { label: 'Decisions', key: 'decisions' },
  { label: 'Commitments', key: 'commitments' }, { label: 'Finance', key: 'finance' }, { label: 'Problems', key: 'problems' },
  { label: 'Health', key: 'health' }, { label: 'Staff', key: 'staff_mentions' }, { label: 'KPI', key: 'kpi_updates' }, { label: 'Leads', key: 'leads' },
]
const CAT_LABEL: Record<ExtractionKey, string> = {
  instructions: 'Instructions', decisions: 'Decisions', commitments: 'Commitments', finance: 'Finance', health: 'Health',
  problems: 'Problems', staff_mentions: 'Staff', kpi_updates: 'KPI', suggestions: 'Suggestions', leads: 'Leads',
}

// Institutional-memory search: transcript, summary, commitments (who/what), people, amounts.
function matches(c: Conversation, q: string) {
  if (!q) return true
  const s = q.toLowerCase()
  const ex = c.extracted
  const hay = [
    c.transcript, ex?.summary,
    ...(ex?.commitments.map(x => `${x.who} ${x.what} ${x.by}`) ?? []),
    ...(ex?.instructions.map(x => `${x.text} ${x.assigned_to ?? ''}`) ?? []),
    ...(ex?.staff_mentions.map(x => `${x.name} ${x.context}`) ?? []),
    ...(ex?.finance.map(x => `${x.amount} ${x.category} ${x.description}`) ?? []),
    ...(ex?.decisions.map(x => x.title) ?? []),
    ...(ex?.problems.map(x => x.title) ?? []),
  ].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(s)
}

function groupOf(iso: string) {
  const d = new Date(iso), now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return 'Earlier'
}

export function ConvosTab({ onExtract }: { onExtract: (id: string) => void }) {
  const { state, dispatch } = useStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ExtractionKey | 'All'>('All')
  const [focused, setFocused] = useState(false)
  const [rerunning, setRerunning] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const filtered = state.conversations.filter(c => matches(c, search) && (filter === 'All' || (c.extracted?.[filter]?.length ?? 0) > 0))

  const rerun = async (c: Conversation) => {
    if (!c.transcript) { Alert.alert('No transcript', 'This log has no transcript to re-process.'); return }
    setRerunning(c.id)
    dispatch({ type: 'patch', collection: 'conversations', id: c.id, patch: { status: 'processing', error: undefined } })
    try {
      const { extraction, followUps } = await extractConversation({ transcript: c.transcript, lang: c.lang })
      dispatch({ type: 'patch', collection: 'conversations', id: c.id, patch: { extracted: extraction, followUps, status: 'extracted' } })
    } catch (e) {
      dispatch({ type: 'patch', collection: 'conversations', id: c.id, patch: { status: c.extracted ? 'extracted' : 'failed', error: (e as Error).message } })
      Alert.alert('Re-process failed', (e as Error).message)
    } finally { setRerunning(null) }
  }

  const remove = (c: Conversation) =>
    Alert.alert('Delete log?', 'Entities already committed stay in their trackers.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => dispatch({ type: 'remove', collection: 'conversations', id: c.id }) },
    ])

  return (
    <View style={{ flex: 1 }}>
      <Header>
        <Mono size={14} weight="bold" style={{ marginBottom: 12 }}>CONVERSATION LOGS</Mono>
        <TextInput value={search} onChangeText={setSearch}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder="Search transcripts, people, amounts..." placeholderTextColor={C.t10}
          style={{ width: '100%', backgroundColor: C.input, borderWidth: 1, borderColor: focused ? C.primary : C.line2, fontSize: 14, paddingHorizontal: 12, paddingVertical: 8, color: C.t2, fontFamily: F.mono }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
          {CAT_FILTERS.map(c => (
            <Chip key={c.key} label={c.label.toUpperCase()} active={filter === c.key} onPress={() => setFilter(c.key)} />
          ))}
        </ScrollView>
      </Header>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {['Today', 'Yesterday', 'Earlier'].map(day => {
          const dayC = filtered.filter(c => groupOf(c.createdAt) === day)
          if (!dayC.length) return null
          return (
            <View key={day}>
              <Strip><Mono size={9} color={C.t10}>{day.toUpperCase()}</Mono></Strip>
              {dayC.map(c => {
                const ex = c.extracted
                const cats = ex ? (Object.keys(CAT_LABEL) as ExtractionKey[]).filter(k => ex[k]?.length).map(k => [CAT_LABEL[k], ex[k].length] as const) : []
                return (
                  <View key={c.id} style={{ borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                    <Pressable onPress={() => setExpanded(expanded === c.id ? null : c.id)} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
                      <View style={[between, { marginBottom: 8 }]}>
                        <View style={[row, { gap: 8 }]}>
                          <Mono size={12} weight="semibold" color={C.primary}>{fmtTime(c.createdAt)}</Mono>
                          <Mono size={10} color={C.t10}>{fmtDuration(c.durationSec)}</Mono>
                          {c.status === 'processing' && <StatusBadge status="analyzing" />}
                          {c.status === 'failed' && <StatusBadge status="failed" />}
                          {c.status === 'committed' && <StatusBadge status="completed" />}
                          {c.source !== 'voice' && <Mono size={9} color={C.t10}>{c.source.toUpperCase()}</Mono>}
                        </View>
                        <Mono size={10} color={C.t10}>{expanded === c.id ? '▲' : '▼'}</Mono>
                      </View>
                      <T size={14} color={C.t5} relaxed numberOfLines={expanded === c.id ? undefined : 2}>{ex?.summary || c.transcript || (c.status === 'processing' ? 'Transcribing…' : c.error || '—')}</T>
                      <View style={[row, { gap: 8, marginTop: 8, flexWrap: 'wrap' }]}>
                        {cats.map(([k, v]) => (
                          <View key={k} style={{ paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: C.line2 }}>
                            <Mono size={9} color={C.t9}>{k}: {v}</Mono>
                          </View>
                        ))}
                      </View>
                    </Pressable>
                    {expanded === c.id && (
                      <View style={{ paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line }}>
                        <Mono size={9} color={C.t10} style={{ marginBottom: 8, paddingTop: 12 }}>FULL TRANSCRIPT{editing === c.id ? ' — EDITING' : ''}</Mono>
                        {editing === c.id ? (
                          <View style={{ gap: 8 }}>
                            <TextInput value={draft} onChangeText={setDraft} multiline style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.primary, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10, minHeight: 100, textAlignVertical: 'top', lineHeight: 20 }} />
                            <View style={[row, { gap: 8 }]}>
                              <Chip label="SAVE & RE-EXTRACT" active px={12} py={6} onPress={() => { const t = draft.trim(); setEditing(null); if (t && t !== c.transcript) { dispatch({ type: 'patch', collection: 'conversations', id: c.id, patch: { transcript: t } }); void rerun({ ...c, transcript: t }) } }} />
                              <Chip label="CANCEL" px={12} py={6} onPress={() => setEditing(null)} />
                            </View>
                          </View>
                        ) : (
                          <T size={14} color={C.t3} relaxed>{c.transcript || '—'}</T>
                        )}
                        {!!c.followUps?.length && (
                          <View style={{ marginTop: 10 }}>
                            <Mono size={9} color={C.purple400} style={{ marginBottom: 4 }}>FOLLOW-UPS DETECTED</Mono>
                            {c.followUps.map((f, i) => <T key={i} size={12} color={C.t3}>{f.action === 'completed' ? '✓' : f.action === 'delayed' ? '⏱' : '✕'} {f.title} — {f.action}{f.new_by ? ` → ${f.new_by}` : ''}{f.applied ? ' (applied)' : ''}</T>)}
                          </View>
                        )}
                        {c.error && <Mono size={9} color={C.red400} style={{ marginTop: 8 }}>ERROR: {c.error}</Mono>}
                        <View style={[row, { gap: 8, marginTop: 12, flexWrap: 'wrap' }]}>
                          {ex && <Chip label={`VIEW EXTRACTION (${countItems(ex)})`} active px={12} py={6} onPress={() => onExtract(c.id)} style={{ borderColor: alpha(C.primary, 0.4) }} />}
                          <Chip label="✎ EDIT" disabled={c.status === 'processing'} onPress={() => { setEditing(c.id); setDraft(c.transcript) }} />
                          <Chip label={rerunning === c.id ? '⟳ RE-PROCESSING…' : '↻ RE-PROCESS'} disabled={rerunning !== null || c.status === 'processing'} onPress={() => rerun(c)} />
                          <Chip label="DELETE" active color={C.red500} style={{ borderColor: C.red900 }} onPress={() => remove(c)} />
                        </View>
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )
        })}
        {!filtered.length && (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Mono size={10} color={C.t10}>NO LOGS MATCH</Mono>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
