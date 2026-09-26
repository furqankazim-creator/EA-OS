import { useEffect, useState } from 'react'
import { View, Pressable, ScrollView, TextInput, Alert } from 'react-native'
import { T, Mono } from '@/components/T'
import { Chip, DashedButton, Header, between, row } from '@/components/ui'
import { StatusBadge } from '@/components/StatusBadge'
import { SeverityDot } from '@/components/SeverityDot'
import { Radar } from '@/components/Radar'
import { useStore, uid, fmtDate } from '@/store'
import { analyzeChallenge } from '@/services/api'
import type { Problem, ProblemStatus, Severity } from '@/types'
import { C, F, alpha } from '@/theme'

const STATUS_LABEL: Record<ProblemStatus, string> = { open: 'OPEN', analyzing: 'ANALYZING', action_planned: 'PLANNED', resolved: 'RESOLVED' }
const PERSPECTIVE_TAG: Record<string, string> = { Gemini: 'STRATEGIC · SCALE', Claude: 'ANALYTICAL · RISK', GPT: 'OPERATIONAL · SPRINT', Grok: 'CONTRARIAN · FIRST PRINCIPLES' }
const tagFor = (name: string) => Object.entries(PERSPECTIVE_TAG).find(([k]) => name.toLowerCase().includes(k.toLowerCase()))?.[1] ?? 'PERSPECTIVE'
const shortName = (name: string) => name.replace(/\s*\(.*\)/, '').split(' ')[0].toUpperCase()

export function ProblemsTab({ focusId }: { focusId?: string | null }) {
  const { state, dispatch } = useStore()
  const [expanded, setExpanded] = useState<string | null>(focusId ?? state.problems[0]?.id ?? null)
  useEffect(() => { if (focusId) setExpanded(focusId) }, [focusId])
  const [perspective, setPerspective] = useState<Record<string, number>>({})
  const [sevFilter, setSevFilter] = useState<Severity | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ProblemStatus | 'all'>('all')
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newSev, setNewSev] = useState<Severity>('medium')

  const problems = state.problems.filter(p => (sevFilter === 'all' || p.severity === sevFilter) && (statusFilter === 'all' || p.status === statusFilter))
  const counts = { open: 0, analyzing: 0, action_planned: 0, resolved: 0 } as Record<ProblemStatus, number>
  state.problems.forEach(p => { counts[p.status]++ })

  const analyze = async (p: Problem) => {
    dispatch({ type: 'patch', collection: 'problems', id: p.id, patch: { status: 'analyzing', error: undefined } })
    setExpanded(p.id)
    try {
      const rev = state.kpis.find(k => /revenue/i.test(k.metric))
      const analysis = await analyzeChallenge({
        title: p.title, description: p.description, severity: p.severity,
        context: `Revenue ${rev ? `${rev.value.toLocaleString()} ${rev.unit}` : '60,000 PKR'} vs 100,000 PKR monthly target. Team of 4. Open commitments: ${state.decisions.filter(d => d.type === 'Commitment' && d.status !== 'completed').length}.`,
      })
      dispatch({ type: 'patch', collection: 'problems', id: p.id, patch: { status: p.committed ? 'action_planned' : 'open', analysis, committed: false } })
      setPerspective(x => ({ ...x, [p.id]: 0 }))
    } catch (e) {
      dispatch({ type: 'patch', collection: 'problems', id: p.id, patch: { status: p.analysis ? (p.committed ? 'action_planned' : 'open') : 'open', error: (e as Error).message } })
    }
  }

  const commit = (p: Problem) => {
    if (!p.analysis) return
    dispatch({ type: 'problem/commit', id: p.id })
    Alert.alert('Consensus adopted', `${p.analysis.action_items.length} team assignments created\n${p.analysis.decisions_to_record.length} executive decisions logged\nStatus → ACTION PLANNED`)
  }

  const addProblem = () => {
    const t = newTitle.trim(); if (!t) return
    const p: Problem = { id: uid(), title: t, description: newDesc.trim(), severity: newSev, date: fmtDate(new Date().toISOString()), status: 'open', analysis: null, source: 'Manual' }
    dispatch({ type: 'put', collection: 'problems', doc: p })
    setNewTitle(''); setNewDesc(''); setAdding(false); setExpanded(p.id)
  }

  return (
    <View style={{ flex: 1 }}>
      <Header style={{ paddingBottom: 8 }}>
        <View style={[between, { alignItems: 'center' }]}>
          <View>
            <Mono size={14} weight="bold">AI SOLVER</Mono>
            <Mono size={9} color={C.t10} style={{ marginTop: 2 }}>BOARD OF VIRTUAL ADVISORS · 4 PERSPECTIVES</Mono>
          </View>
          <View style={[row, { gap: 6 }]}>
            {(['open', 'analyzing', 'action_planned', 'resolved'] as ProblemStatus[]).map(s => (
              <View key={s} style={{ alignItems: 'center' }}>
                <Mono size={12} weight="bold" color={s === 'open' ? C.orange400 : s === 'analyzing' ? C.yellow400 : s === 'action_planned' ? C.blue400 : C.green400}>{counts[s]}</Mono>
                <Mono size={7} color={C.t10}>{STATUS_LABEL[s]}</Mono>
              </View>
            ))}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 6 }}>
          {([['all', 'ALL'], ['high', 'HIGH'], ['medium', 'MEDIUM'], ['low', 'LOW']] as const).map(([v, l]) => (
            <Chip key={v} size={9} label={l} active={sevFilter === v} color={v === 'high' ? C.red400 : v === 'medium' ? C.yellow400 : v === 'low' ? C.green400 : C.primary} onPress={() => setSevFilter(v)} />
          ))}
          <View style={{ width: 1, backgroundColor: C.line2, marginHorizontal: 2 }} />
          {([['all', 'ANY STATUS'], ['open', 'OPEN'], ['analyzing', 'ANALYZING'], ['action_planned', 'PLANNED'], ['resolved', 'RESOLVED']] as const).map(([v, l]) => (
            <Chip key={v} size={9} label={l} active={statusFilter === v} onPress={() => setStatusFilter(v)} />
          ))}
        </ScrollView>
      </Header>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {problems.map(p => {
          const a = p.analysis
          const pi = Math.min(perspective[p.id] ?? 0, Math.max(0, (a?.models.length ?? 1) - 1))
          const m = a?.models[pi]
          const isOpen = expanded === p.id
          return (
            <View key={p.id} style={{ borderBottomWidth: 1, borderBottomColor: C.line3 }}>
              <Pressable onPress={() => setExpanded(isOpen ? null : p.id)} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
                <View style={between}>
                  <View style={[row, { gap: 8 }]}>
                    <SeverityDot severity={p.severity} />
                    <Mono size={9} color={p.severity === 'high' ? C.red400 : p.severity === 'medium' ? C.yellow400 : C.green400}>{p.severity.toUpperCase()}</Mono>
                    <StatusBadge status={p.status === 'resolved' ? 'completed' : p.status === 'action_planned' ? 'in_progress' : p.status} />
                  </View>
                  <View style={[row, { gap: 8 }]}>
                    <Mono size={10} color={C.t10}>{p.date}</Mono>
                    <Mono size={10} color={C.t10}>{isOpen ? '▲' : '▼'}</Mono>
                  </View>
                </View>
                <T size={14} weight="medium" color={p.status === 'resolved' ? C.t8 : C.t1} style={{ marginTop: 8 }}>{p.title}</T>
                {!!p.source && <Mono size={9} color={C.t10} style={{ marginTop: 2 }}>Source: {p.source}</Mono>}
              </Pressable>

              {isOpen && (
                <View style={{ paddingHorizontal: 20, paddingBottom: 20, backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line }}>
                  <T size={14} color={C.t6} relaxed style={{ marginTop: 12, marginBottom: 14 }}>{p.description || '—'}</T>
                  {!!p.error && <Mono size={9} color={C.red400} style={{ marginBottom: 10 }}>✕ {p.error}</Mono>}

                  {p.status === 'analyzing' ? (
                    <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                      <Radar />
                      <Mono size={10} color={C.primary} style={{ marginTop: 6 }}>RUNNING MULTI-LLM SYNTHESIS…</Mono>
                      <Mono size={9} color={C.t10} style={{ marginTop: 4 }}>Strategic · Analytical · Operational · Contrarian</Mono>
                    </View>
                  ) : !a ? (
                    <Pressable onPress={() => analyze(p)} style={{ alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.primary }}>
                      <Mono size={10} weight="bold" color="#000">▶ RUN MULTI-LLM SYNTHESIS</Mono>
                    </Pressable>
                  ) : (
                    <>
                      {/* Consensus minutes card */}
                      <View style={{ borderWidth: 1, borderColor: C.primary, backgroundColor: alpha(C.primary, 0.06), padding: 14, marginBottom: 14 }}>
                        <Mono size={9} weight="semibold" color={C.primary}>BOARD CONSENSUS</Mono>
                        <Mono size={9} color={C.t10} style={{ marginBottom: 8, marginTop: 6 }}>ROOT CAUSE</Mono>
                        <T size={13} color={C.fg} relaxed style={{ borderLeftWidth: 2, borderLeftColor: C.red800, paddingLeft: 10 }}>{a.root_cause}</T>
                        <Mono size={9} color={C.t10} style={{ marginBottom: 6, marginTop: 12 }}>SYNTHESIZED DIAGNOSIS & PATH FORWARD</Mono>
                        <T size={13} color={C.t2} relaxed>{a.consensus_summary}</T>
                      </View>

                      {/* Playbook match: a prior win that fits this pattern */}
                      {a.playbook && (
                        <View style={{ borderWidth: 1, borderColor: C.green900, backgroundColor: alpha(C.green400, 0.05), padding: 12, marginBottom: 14 }}>
                          <Mono size={9} weight="semibold" color={C.green400}>📗 PLAYBOOK MATCH · WORKED {a.playbook.timesWorked}× BEFORE</Mono>
                          <T size={13} weight="semibold" color={C.t1} style={{ marginTop: 4 }}>{a.playbook.title}</T>
                          <T size={11} color={C.t7} style={{ marginTop: 2 }}>When: {a.playbook.trigger}</T>
                          {a.playbook.steps.slice(0, 5).map((st, i) => <T key={i} size={12} color={C.t3} style={{ marginTop: 3 }}>{i + 1}. {st.step} — {st.owner}, {st.days}d</T>)}
                        </View>
                      )}

                      {/* Simulated outcomes: each perspective's plan run through the 13-week cash model */}
                      {!!a.scenarios?.length && (
                        <View style={{ marginBottom: 14 }}>
                          <Mono size={9} color={C.t10} style={{ marginBottom: 6 }}>SIMULATED · 13-WEEK CASH PER PLAN{a.baseline ? ` (DO NOTHING: LOW ${a.baseline.minCash.toLocaleString()}, END ${a.baseline.endCash.toLocaleString()})` : ''}</Mono>
                          {a.scenarios.map((sc, i) => {
                            const best = Math.max(...a.scenarios!.map(x => x.endCash)) === sc.endCash
                            return (
                              <Pressable key={i} onPress={() => setPerspective(s => ({ ...s, [p.id]: i }))} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                                <View style={[row, { justifyContent: 'space-between' }]}>
                                  <Mono size={10} color={best ? C.green400 : pi === i ? C.primary : C.t2}>{best ? '★ ' : ''}{shortName(sc.name)}</Mono>
                                  <Mono size={10} color={sc.shortfallWeek ? C.red400 : C.t2}>low {sc.minCash.toLocaleString()} · end {sc.endCash.toLocaleString()}{sc.shortfallWeek ? ` · NEGATIVE WK ${sc.shortfallWeek}` : ''}</Mono>
                                </View>
                                {!!sc.assumptions?.length && <Mono size={8} color={C.t10} style={{ marginTop: 2 }}>{sc.assumptions.slice(0, 2).join(' · ')}</Mono>}
                              </Pressable>
                            )
                          })}
                        </View>
                      )}

                      {/* Perspective cards */}
                      <Mono size={9} color={C.t10} style={{ marginBottom: 8 }}>PERSPECTIVES {a.engine && a.engine !== 'demo' ? `· SIMULATED BY ${a.engine.toUpperCase()}` : ''}</Mono>
                      <View style={[row, { gap: 4, marginBottom: 10, flexWrap: 'wrap' }]}>
                        {a.models.map((x, i) => (
                          <Chip key={i} size={9} label={shortName(x.name)} active={pi === i} bg={alpha(C.primary, 0.05)} onPress={() => setPerspective(s => ({ ...s, [p.id]: i }))} />
                        ))}
                      </View>
                      {m && (
                        <View style={{ borderWidth: 1, borderColor: C.line, backgroundColor: C.panel3, padding: 14, marginBottom: 14 }}>
                          <View style={[between, { alignItems: 'center' }]}>
                            <Mono size={10} weight="semibold" color={C.primary}>{m.name.toUpperCase()}</Mono>
                            <Mono size={8} color={C.t9}>{tagFor(m.name)}</Mono>
                          </View>
                          <T size={13} color={C.t2} relaxed style={{ marginTop: 8 }}>{m.verdict}</T>
                          <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Mono size={8} color={C.green400} style={{ marginBottom: 4 }}>PROS</Mono>
                              {m.pros.map((x, i) => <T key={i} size={11} color={C.t3} style={{ marginBottom: 3 }}>✓ {x}</T>)}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Mono size={8} color={C.red400} style={{ marginBottom: 4 }}>RISKS</Mono>
                              {m.cons.map((x, i) => <T key={i} size={11} color={C.t3} style={{ marginBottom: 3 }}>✕ {x}</T>)}
                            </View>
                          </View>
                        </View>
                      )}

                      {/* Disagreements */}
                      {a.disagreements.length > 0 && (
                        <View style={{ marginBottom: 14 }}>
                          <Mono size={9} color={C.yellow400} style={{ marginBottom: 6 }}>⚠ KEY DISAGREEMENTS / TRADE-OFFS</Mono>
                          {a.disagreements.map((d, i) => <T key={i} size={12} color={C.t3} relaxed style={{ marginBottom: 4, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: C.yellow900 }}>{d}</T>)}
                        </View>
                      )}

                      {/* Action items */}
                      <Mono size={9} color={C.t10} style={{ marginBottom: 6 }}>ACTION ITEMS ({a.action_items.length})</Mono>
                      {a.action_items.map((it, i) => (
                        <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                          <T size={13} color={C.t1}>{it.task}</T>
                          <View style={[row, { gap: 12, marginTop: 3 }]}>
                            <Mono size={9} color={C.t9}>ASSIGNEE: <Mono size={9} color={C.t6}>{it.assignee}</Mono></Mono>
                            <Mono size={9} color={C.t9}>DUE: <Mono size={9} color={C.t6}>{it.deadline_days}d</Mono></Mono>
                          </View>
                        </View>
                      ))}

                      {/* Decisions */}
                      {a.decisions_to_record.length > 0 && (
                        <View style={{ marginTop: 12 }}>
                          <Mono size={9} color={C.t10} style={{ marginBottom: 6 }}>EXECUTIVE DECISIONS TO RECORD ({a.decisions_to_record.length})</Mono>
                          {a.decisions_to_record.map((d, i) => (
                            <View key={i} style={{ paddingVertical: 8, borderLeftWidth: 2, borderLeftColor: C.primary, paddingLeft: 10, marginBottom: 6 }}>
                              <T size={13} color={C.t1}>{d.title}</T>
                              {!!d.description && <T size={11} color={C.t7} style={{ marginTop: 2 }}>{d.description}</T>}
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Commit */}
                      {!p.committed ? (
                        <Pressable onPress={() => commit(p)} style={{ marginTop: 14, paddingVertical: 12, backgroundColor: C.primary, alignItems: 'center' }}>
                          <Mono size={11} weight="bold" color="#000">✓ ADOPT CONSENSUS & COMMIT NEXT STEPS</Mono>
                        </Pressable>
                      ) : (
                        <View style={{ marginTop: 14, paddingVertical: 10, borderWidth: 1, borderColor: C.green900, alignItems: 'center' }}>
                          <Mono size={10} color={C.green400}>✓ {a.action_items.length} ASSIGNMENTS + {a.decisions_to_record.length} DECISIONS LOGGED</Mono>
                        </View>
                      )}
                      {/* Tripwires armed for this plan */}
                      {(() => { const tws = state.tripwires.filter(t => t.problemId === p.id); return tws.length ? (
                        <View style={{ marginTop: 12, borderWidth: 1, borderColor: tws.some(t => t.status === 'fired') ? C.red900 : C.line2, padding: 10 }}>
                          <Mono size={9} color={tws.some(t => t.status === 'fired') ? C.red400 : C.t10}>⚡ TRIPWIRES · CHECKED DAILY</Mono>
                          {tws.map(t => (
                            <View key={t.id} style={{ marginTop: 6 }}>
                              <T size={12} color={t.status === 'fired' ? C.red400 : C.t2}>{t.status === 'fired' ? '🔴' : '○'} {t.label}</T>
                              <Mono size={8} color={C.t10}>{t.metric.replace(/_/g, ' ')} {t.op} {t.value.toLocaleString()} · from {fmtDate(t.checkAfter)}{t.status === 'fired' ? ` · observed ${t.observed}` : ''}</Mono>
                              {t.status === 'fired' && <T size={11} color={C.t7} style={{ marginTop: 2 }}>Fallback: {t.fallback}</T>}
                            </View>
                          ))}
                        </View>
                      ) : null })()}
                      {p.quality && (
                        <View style={[row, { gap: 10, marginTop: 10, flexWrap: 'wrap' }]}>
                          <Mono size={8} color={C.t10}>DECISION QUALITY</Mono>
                          <Mono size={8} color={C.t9}>TIMELINESS {p.quality.timeliness}</Mono><Mono size={8} color={C.t9}>EVIDENCE {p.quality.evidence}</Mono><Mono size={8} color={C.t9}>EXECUTION {p.quality.execution}</Mono>
                          <Mono size={8} weight="bold" color={p.quality.score >= 70 ? C.green400 : p.quality.score >= 40 ? C.yellow400 : C.red400}>SCORE {p.quality.score}/100</Mono>
                        </View>
                      )}
                      {/* Outcome tracking: the Solver learns which plans actually worked */}
                      {p.committed && (
                        <View style={{ marginTop: 12, borderWidth: 1, borderColor: p.outcome ? C.green900 : p.outcomeAskedAt ? C.yellow900 : C.line2, padding: 10 }}>
                          <Mono size={9} color={p.outcome ? C.green400 : p.outcomeAskedAt ? C.yellow400 : C.t10}>{p.outcome ? `OUTCOME: ${p.outcome.toUpperCase()}` : p.outcomeAskedAt ? '⏱ DID IT WORK? (asked in weekly review)' : 'OUTCOME — RECORD ONCE YOU KNOW'}</Mono>
                          <View style={[row, { gap: 6, marginTop: 6 }]}>
                            {([['worked', '✓ WORKED', C.green400], ['partial', '~ PARTIALLY', C.yellow400], ['failed', '✕ DIDN\'T', C.red400]] as const).map(([v, l, c]) => (
                              <Chip key={v} size={9} label={l} active={p.outcome === v} color={c} onPress={() => dispatch({ type: 'patch', collection: 'problems', id: p.id, patch: { outcome: v, ...(v === 'worked' ? { status: 'resolved' } : {}) } })} />
                            ))}
                          </View>
                        </View>
                      )}
                      <View style={[row, { gap: 8, marginTop: 10, flexWrap: 'wrap' }]}>
                        <Chip label="↻ RE-RUN SYNTHESIS" px={12} py={6} onPress={() => analyze(p)} />
                        {p.status !== 'resolved'
                          ? <Chip label="MARK RESOLVED" active color={C.green400} px={12} py={6} style={{ borderColor: C.green900 }} onPress={() => dispatch({ type: 'patch', collection: 'problems', id: p.id, patch: { status: 'resolved' } })} />
                          : <Chip label="REOPEN" px={12} py={6} onPress={() => dispatch({ type: 'patch', collection: 'problems', id: p.id, patch: { status: p.committed ? 'action_planned' : 'open' } })} />}
                        <Chip label="DELETE" active color={C.red500} px={12} py={6} style={{ borderColor: C.red900 }} onPress={() => Alert.alert('Delete challenge?', 'Committed assignments and decisions stay.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => dispatch({ type: 'remove', collection: 'problems', id: p.id }) }])} />
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          )
        })}
        {!problems.length && <View style={{ padding: 30, alignItems: 'center' }}><Mono size={10} color={C.t10}>NO CHALLENGES MATCH</Mono></View>}

        {adding ? (
          <View style={{ marginHorizontal: 20, marginTop: 16, marginBottom: 16, gap: 8, borderWidth: 1, borderColor: C.line2, padding: 12 }}>
            <Mono size={9} color={C.t10}>NEW BUSINESS CHALLENGE</Mono>
            <TextInput value={newTitle} onChangeText={setNewTitle} placeholder="Title" placeholderTextColor={C.t10}
              style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t2, fontFamily: F.sans, fontSize: 14, padding: 10 }} />
            <TextInput value={newDesc} onChangeText={setNewDesc} placeholder="Details (optional)" placeholderTextColor={C.t10} multiline
              style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t2, fontFamily: F.sans, fontSize: 13, padding: 10, minHeight: 56, textAlignVertical: 'top' }} />
            <View style={[row, { gap: 6 }]}>
              {(['low', 'medium', 'high'] as const).map(s => <Chip key={s} size={9} label={s.toUpperCase()} active={newSev === s} color={s === 'high' ? C.red400 : s === 'medium' ? C.yellow400 : C.green400} onPress={() => setNewSev(s)} />)}
            </View>
            <View style={[row, { gap: 8, marginTop: 4 }]}>
              <Pressable onPress={addProblem} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: newTitle.trim() ? C.primary : C.line }}>
                <Mono size={10} color={newTitle.trim() ? '#000' : C.t9}>ADD</Mono>
              </Pressable>
              <Chip label="CANCEL" px={12} py={8} onPress={() => setAdding(false)} />
            </View>
          </View>
        ) : (
          <DashedButton label="+ ADD BUSINESS CHALLENGE" onPress={() => setAdding(true)} />
        )}
      </ScrollView>
    </View>
  )
}
