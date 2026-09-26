import { useState } from 'react'
import { View, ScrollView } from 'react-native'
import { T, Mono } from '@/components/T'
import { Chip, DashedButton, Header, between, row } from '@/components/ui'
import { StatusBadge } from '@/components/StatusBadge'
import { useStore } from '@/store'
import { C, alpha } from '@/theme'

export function DecisionsTab() {
  const { state, dispatch } = useStore()
  const DECISIONS = state.decisions
  const [filterType, setFilterType] = useState('All')
  const types = ['All', 'Decision', 'Commitment', 'Open', 'Done']
  const filtered = DECISIONS.filter(d => filterType === 'All' || (filterType === 'Open' ? d.status !== 'completed' : filterType === 'Done' ? d.status === 'completed' : d.type === filterType))
  const count = (s: string) => DECISIONS.filter(d => d.status === s).length
  const stats = [{ label: 'OVERDUE', val: count('overdue'), col: C.red400 }, { label: 'IN PROGRESS', val: count('in_progress'), col: C.blue400 }, { label: 'PENDING', val: count('pending'), col: C.yellow400 }, { label: 'DONE', val: count('completed'), col: C.green400 }]

  return (
    <View style={{ flex: 1 }}>
      <Header>
        <Mono size={14} weight="bold" style={{ marginBottom: 12 }}>DECISIONS & COMMITMENTS</Mono>
        <View style={[row, { gap: 8 }]}>
          {types.map(t => (
            <Chip key={t} label={t.toUpperCase()} active={filterType === t} px={12} py={6} bg={alpha(C.primary, 0.05)} onPress={() => setFilterType(t)} />
          ))}
        </View>
      </Header>
      <ScrollView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line }}>
          {stats.map((s, i) => (
            <View key={s.label} style={{ flex: 1, padding: 16, borderRightWidth: i === stats.length - 1 ? 0 : 1, borderRightColor: C.line, alignItems: 'center' }}>
              <Mono size={24} weight="bold" color={s.col}>{s.val}</Mono>
              <Mono size={9} color={C.t10} style={{ marginTop: 4 }}>{s.label}</Mono>
            </View>
          ))}
        </View>
        {filtered.map(d => (
          <View key={d.id} style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
            <View style={[between, { marginBottom: 8 }]}>
              <View style={[row, { gap: 8 }]}>
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: C.line2 }}>
                  <Mono size={9} color={C.t9}>{d.type.toUpperCase()}</Mono>
                </View>
                <StatusBadge status={d.status} />
              </View>
              <Mono size={10} color={C.t10}>{d.date}</Mono>
            </View>
            <T size={14} weight="medium" color={C.t1} style={{ marginTop: 4 }}>{d.title}</T>
            {!!d.description && <T size={12} color={C.t7} style={{ marginTop: 2 }}>{d.description}</T>}
            {!!d.who && (
              <View style={[row, { gap: 12, marginTop: 8 }]}>
                <Mono size={10} color={C.t9}>OWNER: <Mono size={10} color={C.t6}>{d.who}</Mono></Mono>
                {d.by && <Mono size={10} color={d.status === 'overdue' ? C.red400 : C.t9}>DUE: {d.by}</Mono>}
              </View>
            )}
            {!!d.sourceQuote && <T size={11} color={C.t8} italic style={{ marginTop: 6, borderLeftWidth: 2, borderLeftColor: C.purple900, paddingLeft: 8 }}>"{d.sourceQuote}"</T>}
            <View style={[between, { alignItems: 'center', marginTop: 6 }]}>
              <Mono size={10} color={C.t10}>Source: {d.source}</Mono>
              <View style={[row, { gap: 6 }]}>
                {d.status !== 'completed' && d.type === 'Commitment' && d.status !== 'in_progress' && <Chip size={9} label="START" active color={C.blue400} style={{ borderColor: C.blue900 }} onPress={() => dispatch({ type: 'patch', collection: 'decisions', id: d.id, patch: { status: 'in_progress' } })} />}
                {d.status !== 'completed' && <Chip size={9} label="✓ DONE" active color={C.green400} style={{ borderColor: C.green900 }} onPress={() => dispatch({ type: 'patch', collection: 'decisions', id: d.id, patch: { status: 'completed' } })} />}
                {d.status === 'completed' && <Chip size={9} label="REOPEN" onPress={() => dispatch({ type: 'patch', collection: 'decisions', id: d.id, patch: { status: d.type === 'Decision' ? 'active' : 'pending' } })} />}
              </View>
            </View>
          </View>
        ))}
        <DashedButton label={'+ ADD VIA ASSISTANT ("log a decision…")'} />
      </ScrollView>
    </View>
  )
}
