import { useEffect, useState } from 'react'
import { View, Pressable, ScrollView, Alert, TextInput } from 'react-native'
import { T, Mono } from '@/components/T'
import { Chip, Header, Strip, between, row } from '@/components/ui'
import { StatusBadge } from '@/components/StatusBadge'
import { SeverityDot } from '@/components/SeverityDot'
import { useStore, fmtTime, fmtDate, fmtDuration, countItems, uid, similarity } from '@/store'
import { ItemEditor } from '@/components/ItemEditor'
import type { Extraction, ExtractionKey, FollowUp } from '@/types'
import { logCorrection } from '@/services/api'
import { C, F, alpha } from '@/theme'

const CAT_CONFIG: Record<ExtractionKey, { icon: string; label: string; color: string; border: string }> = {
  instructions:   { icon: '🎯', label: 'Instructions', color: C.blue400,   border: C.blue900 },
  decisions:      { icon: '🚀', label: 'Decisions',    color: C.orange400, border: C.orange900 },
  commitments:    { icon: '🤝', label: 'Commitments',  color: C.purple400, border: C.purple900 },
  finance:        { icon: '💰', label: 'Finance',      color: C.green400,  border: C.green900 },
  health:         { icon: '🏥', label: 'Health',       color: C.pink400,   border: C.pink900 },
  problems:       { icon: '🔴', label: 'Problems',     color: C.red400,    border: C.red900 },
  staff_mentions: { icon: '👥', label: 'Staff',        color: C.cyan400,   border: C.cyan900 },
  kpi_updates:    { icon: '📊', label: 'KPI Updates',  color: C.yellow400, border: C.yellow900 },
  suggestions:    { icon: '💡', label: 'Suggestions',  color: C.t2,        border: C.line5 },
  leads:          { icon: '🧲', label: 'Leads',        color: C.green400,  border: C.green900 },
}
const TREND = { up: '↗', down: '↘', flat: '→' } as const

function Item({ cat, item, i, dup }: { cat: ExtractionKey; item: Extraction[ExtractionKey][number]; i: number; dup?: string }) {
  const [confirmed, setConfirmed] = useState(false)
  const label = (k: string, v: string | null | undefined) => v ? <Mono size={9} color={C.t9}>{k}: <Mono size={9} color={C.t6}>{v}</Mono></Mono> : null
  switch (cat) {
    case 'instructions': { const x = item as Extraction['instructions'][number]; return (
      <View>
        <T size={14} color={C.t1}>{x.text}</T>
        <View style={[between, { alignItems: 'center', marginTop: 8 }]}>
          {label('ASSIGNED TO', x.assigned_to ?? 'Unassigned')}
          <Chip size={9} label={confirmed ? '✓ CONFIRMED' : 'CONFIRM'} active={confirmed} color={C.green400} onPress={() => setConfirmed(true)} style={confirmed ? { borderColor: C.green900 } : undefined} />
        </View>
      </View>) }
    case 'decisions': { const x = item as Extraction['decisions'][number]; return (
      <View><T size={14} color={C.t1}>{x.title}</T>{!!x.description && <T size={12} color={C.t7} style={{ marginTop: 4 }}>{x.description}</T>}</View>) }
    case 'commitments': { const x = item as Extraction['commitments'][number]; return (
      <View>
        <T size={14} color={C.t1}>{x.what}</T>
        <View style={[row, { gap: 12, marginTop: 4, flexWrap: 'wrap' }]}>{label('WHO', x.who)}{label('BY', x.by)}{x.dueAt ? <Mono size={9} color={C.green400}>⏰ REMINDERS ON</Mono> : null}</View>
        {!!dup && <Mono size={9} color={C.yellow400} style={{ marginTop: 4 }}>≈ DUPLICATE of "{dup}" — will be skipped</Mono>}
        {!!x.source_quote && <T size={11} color={C.t8} italic style={{ marginTop: 6, borderLeftWidth: 2, borderLeftColor: C.purple900, paddingLeft: 8 }}>"{x.source_quote}"</T>}
      </View>) }
    case 'finance': { const x = item as Extraction['finance'][number]; return (
      <View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T size={14} color={C.t1} style={{ flex: 1, paddingRight: 8 }}>{x.description || x.category}</T>
          <Mono size={14} weight="bold" color={C.green400}>{Number(x.amount).toLocaleString()} {x.currency}</Mono>
        </View>
        <Mono size={9} color={C.t9} style={{ marginTop: 4 }}>{x.category} · Office: {Number(x.office_portion).toLocaleString()} · Personal: {Number(x.personal_portion).toLocaleString()}</Mono>
        {!!dup && <Mono size={9} color={C.yellow400} style={{ marginTop: 4 }}>≈ DUPLICATE of "{dup}" — will be skipped</Mono>}
      </View>) }
    case 'health': { const x = item as Extraction['health'][number]; return (
      <View>
        <View style={[row, { gap: 8, marginBottom: 4 }]}><Mono size={9} color={C.pink400}>{String(x.type).toUpperCase()}</Mono></View>
        <T size={14} color={C.t1}>{x.notes}</T>
        {!!x.action_recommended && <T size={12} color={C.t7} style={{ marginTop: 4 }}>→ {x.action_recommended}</T>}
      </View>) }
    case 'problems': { const x = item as Extraction['problems'][number]; return (
      <View>
        <View style={[row, { gap: 8, marginBottom: 4 }]}><SeverityDot severity={x.severity} /><Mono size={9} color={C.t9}>{String(x.severity).toUpperCase()} SEVERITY</Mono></View>
        <T size={14} color={C.t1}>{x.title}</T>
        {!!x.description && <T size={12} color={C.t7} style={{ marginTop: 4 }}>{x.description}</T>}
      </View>) }
    case 'staff_mentions': { const x = item as Extraction['staff_mentions'][number]; return (
      <View><T size={14} weight="semibold" color={C.t1}>{x.name}</T><T size={12} color={C.t7} style={{ marginTop: 2 }}>{x.context}</T></View>) }
    case 'kpi_updates': { const x = item as Extraction['kpi_updates'][number]; return (
      <View style={[row, { justifyContent: 'space-between' }]}>
        <T size={14} color={C.t1}>{x.metric}</T>
        <View style={{ alignItems: 'flex-end' }}>
          <Mono size={14} weight="bold" color={C.yellow400}>{TREND[x.trend] ?? ''} {Number(x.value).toLocaleString()} {x.unit}</Mono>
        </View>
      </View>) }
    case 'leads': { const x = item as Extraction['leads'][number]; return (
      <View>
        <View style={[row, { justifyContent: 'space-between' }]}>
          <T size={14} weight="semibold" color={C.t1}>{x.name}{x.company ? ` · ${x.company}` : ''}</T>
          <Mono size={9} color={C.green400}>{String(x.stage).toUpperCase()}</Mono>
        </View>
        <View style={[row, { gap: 12, marginTop: 4, flexWrap: 'wrap' }]}>{x.value ? <Mono size={9} color={C.t9}>VALUE: <Mono size={9} color={C.t6}>{Number(x.value).toLocaleString()}</Mono></Mono> : null}{label('NEXT', x.next_step)}</View>
      </View>) }
    case 'suggestions': { const x = item as Extraction['suggestions'][number]; return (
      <View><T size={14} color={C.t3} italic>{x.text}</T>{!!x.rationale && <T size={11} color={C.t8} style={{ marginTop: 4 }}>{x.rationale}</T>}</View>) }
    default: return <T size={14} color={C.t1}>{String(i)}</T>
  }
}

export function ExtractTab({ focusConvoId }: { focusConvoId: string | null }) {
  const { state, dispatch } = useStore()
  const convos = state.conversations
  const [selectedId, setSelectedId] = useState(focusConvoId ?? convos[0]?.id ?? null)
  const [expandedCat, setExpandedCat] = useState<ExtractionKey | null>('instructions')
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { if (focusConvoId) { setSelectedId(focusConvoId); setExpandedCat('instructions') } }, [focusConvoId])

  const convo = convos.find(c => c.id === selectedId) ?? convos[0]
  const ex = convo?.extracted ?? null
  const totalItems = countItems(ex)
  const [editing, setEditing] = useState<{ cat: ExtractionKey; i: number } | null>(null)

  // Duplicate detection against what's already logged (only matters before commit).
  const openCommitments = state.decisions.filter(d => d.type === 'Commitment' && d.status !== 'completed')
  const dupCommit: Record<number, string> = {}
  const dupFinance: Record<number, string> = {}
  if (ex && convo?.status !== 'committed') {
    ex.commitments.forEach((c, i) => { const m = openCommitments.find(d => similarity(d.title, c.what) >= 0.7 && (!c.who || !d.who || similarity(d.who, c.who) > 0 || d.who.toLowerCase().includes(c.who.toLowerCase().split(' ')[0]))); if (m) dupCommit[i] = m.title })
    ex.finance.forEach((f, i) => { const since = new Date(convo!.createdAt).getTime() - 48 * 3600_000; const m = state.expenses.find(e => e.amount === f.amount && e.category.toLowerCase() === f.category.toLowerCase() && (!e.dateAt || new Date(e.dateAt).getTime() >= since)); if (m) dupFinance[i] = m.desc })
  }
  const followUps: FollowUp[] = convo?.followUps ?? []

  const saveItem = (cat: ExtractionKey, i: number, next: Record<string, unknown> | null) => {
    if (!convo || !ex) return
    const list = (ex[cat] as unknown[]).slice()
    // Correction feedback loop: every edit/discard is logged and turned into extraction rules nightly.
    dispatch({ type: 'put', collection: 'corrections', doc: { id: uid(), category: cat, action: next === null ? 'discard' : 'edit', before: list[i], after: next, transcript: convo.transcript.slice(0, 400), ts: new Date().toISOString() } })
    const original = list[i]
    if (next === null) list.splice(i, 1); else list[i] = next
    
    // Log correction for few-shot learning
    logCorrection(convo.transcript, cat, original, next)
    
    dispatch({ type: 'patch', collection: 'conversations', id: convo.id, patch: { extracted: { ...ex, [cat]: list } } })
    setEditing(null)
  }

  const commit = () => {
    if (!convo || !ex) return
    dispatch({ type: 'conversation/commit', id: convo.id, skip: { commitments: Object.keys(dupCommit).map(Number), finance: Object.keys(dupFinance).map(Number) }, followUps })
    const n = ex.decisions.length + ex.commitments.length - Object.keys(dupCommit).length, f = ex.finance.length - Object.keys(dupFinance).length, p = ex.problems.length, h = ex.health.length, k = ex.kpi_updates.length, l = (ex.leads ?? []).length
    const delegated = ex.instructions.filter(i => i.assigned_to && state.staff.some(m => i.assigned_to!.toLowerCase().includes(m.name.toLowerCase()))).length
    const hot = ex.problems.filter(x => x.severity === 'high').length
    const skipped = Object.keys(dupCommit).length + Object.keys(dupFinance).length
    Alert.alert('Committed to memory', [
      n && `${n} → Actions`, delegated && `${delegated} → delegated to team (Ops › Tasks)`, f && `${f} → Finance`, p && `${p} → Solve`, h && `${h} → Health log`, k && `${k} → KPI`, l && `${l} → Leads (pipeline)`,
      followUps.length && `${followUps.length} existing commitment${followUps.length > 1 ? 's' : ''} updated`,
      skipped && `${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`,
      hot && `\n⚡ ${hot} high-severity problem${hot > 1 ? 's' : ''} → AI Solver runs automatically on the server`,
      '\nReminders are scheduled for every dated commitment.',
    ].filter(Boolean).join('\n'))
  }

  return (
    <View style={{ flex: 1 }}>
      <Header>
        <Mono size={14} weight="bold" style={{ marginBottom: 4 }}>AUTO-EXTRACTION</Mono>
        <Mono size={9} color={C.t10} style={{ marginBottom: 12 }}>GEMINI · MULTI-LANGUAGE · ZERO MANUAL ENTRY</Mono>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
          {convos.map(c => (
            <Chip key={c.id} size={9} py={6} label={`${fmtTime(c.createdAt)} · ${fmtDate(c.createdAt)}${c.status === 'processing' ? ' ⟳' : c.status === 'failed' ? ' ✕' : ''}`}
              active={convo?.id === c.id} bg={alpha(C.primary, 0.05)} onPress={() => { setSelectedId(c.id); setExpandedCat('instructions') }} />
          ))}
        </ScrollView>
      </Header>

      {!convo ? (
        <View style={{ padding: 40, alignItems: 'center' }}><Mono size={10} color={C.t10}>NO CONVERSATIONS YET — RECORD ONE ON HOME</Mono></View>
      ) : (
        <>
          <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line3, backgroundColor: C.panel }}>
            <Mono size={9} color={C.t10} style={{ marginBottom: 4 }}>{ex?.summary ? 'EXECUTIVE SUMMARY' : 'SOURCE TRANSCRIPT'}</Mono>
            <T size={12} color={C.t7} relaxed numberOfLines={3}>{ex?.summary || convo.transcript || '—'}</T>
            <View style={[between, { alignItems: 'center', marginTop: 8 }]}>
              <Mono size={9} color={C.t9}>{fmtDuration(convo.durationSec)} · {totalItems} items extracted</Mono>
              {convo.status === 'processing' ? <Mono size={9} color={C.primary}>⟳ PROCESSING</Mono>
                : convo.status === 'failed' ? <Mono size={9} color={C.red400}>✕ FAILED</Mono>
                : convo.status === 'committed' ? <Mono size={9} color={C.green400}>✓ COMMITTED</Mono>
                : <Mono size={9} color={C.yellow400}>● AWAITING COMMIT</Mono>}
            </View>
          </View>

          {ex && (
            <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {(Object.keys(CAT_CONFIG) as ExtractionKey[]).map(key => {
                const cfg = CAT_CONFIG[key]; const items = ex[key]
                if (!items.length) return null
                const active = expandedCat === key
                return (
                  <Pressable key={key} onPress={() => setExpandedCat(active ? null : key)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: active ? cfg.border : C.line2, backgroundColor: active ? 'rgba(255,255,255,0.05)' : undefined }}>
                    <Mono size={10} color={active ? cfg.color : C.t9}>{cfg.icon} {cfg.label} ({items.length})</Mono>
                  </Pressable>
                )
              })}
            </View>
          )}

          {editing && ex && (
            <ItemEditor title={CAT_CONFIG[editing.cat].label} item={ex[editing.cat][editing.i] as unknown as Record<string, unknown>} onSave={next => saveItem(editing.cat, editing.i, next)} onCancel={() => setEditing(null)} />
          )}
          <ScrollView style={{ flex: 1 }}>
            {followUps.length > 0 && (
              <View style={{ margin: 20, marginBottom: 0, borderWidth: 1, borderColor: C.purple900, backgroundColor: alpha('#3b0764', 0.25), padding: 12 }}>
                <Mono size={9} weight="semibold" color={C.purple400}>🔁 FOLLOW-UPS ON EXISTING COMMITMENTS</Mono>
                {followUps.map((f, i) => (
                  <View key={i} style={{ marginTop: 8 }}>
                    <T size={13} color={C.t1}>{f.action === 'completed' ? '✓ Complete' : f.action === 'delayed' ? `⏱ Delay${f.new_by ? ` → ${f.new_by}` : ''}` : '✕ Cancel'}: {f.title}</T>
                    <T size={11} color={C.t8} italic style={{ marginTop: 2 }}>"{f.evidence}"</T>
                  </View>
                ))}
                <Mono size={9} color={C.t9} style={{ marginTop: 8 }}>{convo.status === 'committed' ? 'APPLIED' : 'APPLIED ON COMMIT'}</Mono>
              </View>
            )}
            {ex && expandedCat && ex[expandedCat].length > 0 && (
              <View>
                <Strip row>
                  <Mono size={10} weight="semibold" color={CAT_CONFIG[expandedCat].color}>{CAT_CONFIG[expandedCat].icon} {CAT_CONFIG[expandedCat].label.toUpperCase()}</Mono>
                  <Mono size={9} color={C.t10}>{ex[expandedCat].length} ITEM{ex[expandedCat].length !== 1 ? 'S' : ''}</Mono>
                </Strip>
                {(ex[expandedCat] as Extraction[ExtractionKey][number][]).map((item, i) => (
                  <View key={`${convo.id}-${expandedCat}-${i}`} style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                    <Item cat={expandedCat} item={item} i={i} dup={expandedCat === 'commitments' ? dupCommit[i] : expandedCat === 'finance' ? dupFinance[i] : undefined} />
                    {convo.status !== 'committed' && (
                      <View style={[row, { gap: 6, marginTop: 8 }]}>
                        <Chip size={9} label="✎ EDIT" onPress={() => setEditing({ cat: expandedCat, i })} />
                        <Chip size={9} label="DISCARD" active color={C.red400} style={{ borderColor: C.red900 }} onPress={() => Alert.alert('Discard item?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => saveItem(expandedCat, i, null) }])} />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
            {ex && totalItems === 0 && <View style={{ padding: 30, alignItems: 'center' }}><Mono size={10} color={C.t10}>NOTHING EXTRACTED FROM THIS LOG</Mono></View>}

            {/* Commit */}
            {ex && convo.status !== 'committed' && totalItems > 0 && (
              <Pressable onPress={commit} style={{ marginHorizontal: 20, marginTop: 16, paddingVertical: 12, backgroundColor: C.primary, alignItems: 'center' }}>
                <Mono size={11} weight="bold" color="#000">✓ CONFIRM & AUTO-LOG (COMMIT)</Mono>
              </Pressable>
            )}
            {convo.status === 'committed' && (
              <View style={{ marginHorizontal: 20, marginTop: 16, paddingVertical: 10, borderWidth: 1, borderColor: C.green900, alignItems: 'center' }}>
                <Mono size={10} color={C.green400}>✓ LOGGED TO ACTIONS · FINANCE · SOLVE · HEALTH · KPI</Mono>
              </View>
            )}

            {/* Health log section */}
            <View style={{ borderTopWidth: 1, borderTopColor: C.line, marginTop: 16 }}>
              <Strip row>
                <Mono size={10} weight="semibold" color={C.pink400}>🏥 HEALTH LOG</Mono>
                <Mono size={9} color={C.t10}>ALL ENTRIES</Mono>
              </Strip>
              {state.health.map(h => (
                <View key={h.id} style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                  <View style={between}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <T size={14} color={C.t13}>{h.note}</T>
                      {!!h.action && <T size={11} color={C.t7} style={{ marginTop: 2 }}>→ {h.action}</T>}
                      <View style={[row, { gap: 8, marginTop: 4 }]}>
                        <Mono size={9} color={C.t10}>{h.date.trim()} · {h.time}</Mono>
                        <View style={{ borderWidth: 1, borderColor: C.line2, paddingHorizontal: 4 }}><Mono size={9} color={C.t11}>{h.source.toUpperCase()}</Mono></View>
                        {!!h.type && <Mono size={9} color={C.pink400}>{h.type.toUpperCase()}</Mono>}
                      </View>
                    </View>
                    <StatusBadge status={h.severity} />
                  </View>
                </View>
              ))}
              {noteOpen && (
                <View style={{ marginHorizontal: 20, marginTop: 12, gap: 8 }}>
                  <TextInput value={note} onChangeText={setNote} placeholder="How are you feeling? (sleep, pain, workout, diet…)" placeholderTextColor={C.t10} multiline
                    style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.pink900, color: C.t2, fontFamily: F.sans, fontSize: 13, padding: 10, minHeight: 60, textAlignVertical: 'top' }} />
                  <View style={[row, { gap: 8 }]}>
                    <Chip label="SAVE NOTE" active color={C.pink400} style={{ borderColor: C.pink900 }} px={12} py={6} onPress={() => {
                      const t = note.trim(); if (!t) return
                      const now = new Date().toISOString()
                      dispatch({ type: 'put', collection: 'health', doc: { id: uid(), date: fmtDate(now), time: fmtTime(now), note: t, source: 'manual', severity: 'low' } })
                      setNote(''); setNoteOpen(false)
                    }} />
                    <Chip label="CANCEL" px={12} py={6} onPress={() => { setNote(''); setNoteOpen(false) }} />
                  </View>
                </View>
              )}
              <Pressable onPress={() => setNoteOpen(o => !o)}
                style={{ marginHorizontal: 20, marginTop: 12, marginBottom: 16, paddingVertical: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: noteOpen ? C.pink900 : C.line2, alignItems: 'center' }}>
                <Mono size={10} color={noteOpen ? C.pink400 : C.t10}>+ LOG HEALTH NOTE</Mono>
              </Pressable>
            </View>
          </ScrollView>
        </>
      )}
    </View>
  )
}
