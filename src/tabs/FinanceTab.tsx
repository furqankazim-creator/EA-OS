import { View, ScrollView, Pressable } from 'react-native'
import { T, Mono } from '@/components/T'
import { Bar, DashedButton, Header, Strip, between, row } from '@/components/ui'
import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { fetchAutomation, fetchForecast, reportUrl } from '@/services/api'
import { Linking } from 'react-native'
import type { Forecast } from '@/types'
import { Chip } from '@/components/ui'
import { C } from '@/theme'

export function FinanceTab() {
  const { state, dispatch } = useStore()
  const EXPENSES = state.expenses
  const [fin, setFin] = useState<{ burn: number; cash: number; runwayMonths: number; receivables: number; payroll: number } | null>(null)
  useEffect(() => { fetchAutomation().then(a => setFin(a.finance)).catch(() => {}) }, [state.expenses.length, state.invoices.length])
  const [fc, setFc] = useState<Forecast[] | null>(null)
  const [scn, setScn] = useState(1)
  useEffect(() => { fetchForecast().then(r => setFc(r.scenarios)).catch(() => {}) }, [state.expenses.length, state.invoices.length, state.leads.length, state.serverSettings?.cashBalance])
  const f = fc?.[scn]
  const maxCash = f ? Math.max(1, ...f.weeks.map(w => Math.abs(w.cash))) : 1
  const cur = state.serverSettings?.currency ?? 'PKR'
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const now = new Date(); const todayPrefix = `${MONTHS[now.getMonth()]} ${now.getDate()},`
  const totalToday = EXPENSES.filter(e => e.date.startsWith(todayPrefix)).reduce((a, e) => a + e.amount, 0)
  const totalWeek = EXPENSES.reduce((a, e) => a + e.amount, 0)
  const stats = [
    { label: "TODAY'S SPEND", val: `${totalToday.toLocaleString()} ${cur}`, sub: todayPrefix.replace(',', '') },
    { label: 'TOTAL LOGGED', val: `${totalWeek.toLocaleString()} ${cur}`, sub: `${EXPENSES.length} entries` },
    { label: 'RUNWAY', val: fin ? (isFinite(fin.runwayMonths) ? `${fin.runwayMonths} mo` : '∞') : '…', sub: fin ? `burn ${Math.round(fin.burn / 1000)}k/mo` : 'server' },
  ]
  const catTotals = EXPENSES.reduce<Record<string, number>>((m, e) => { m[e.category] = (m[e.category] ?? 0) + e.amount; return m }, {})
  const maxCat = Math.max(1, ...Object.values(catTotals))
  const byCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([cat, amt]) => ({ cat, amt, pct: Math.round((amt / maxCat) * 100) }))

  return (
    <View style={{ flex: 1 }}>
      <Header>
        <Mono size={14} weight="bold">FINANCE TRACKER</Mono>
      </Header>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line }}>
        {stats.map((s, i) => (
          <View key={s.label} style={{ flex: 1, padding: 16, borderRightWidth: i === stats.length - 1 ? 0 : 1, borderRightColor: C.line }}>
            <Mono size={8} color={C.t10} style={{ marginBottom: 4 }}>{s.label}</Mono>
            <Mono size={14} weight="bold" color={C.primary}>{s.val}</Mono>
            <Mono size={9} color={C.t10}>{s.sub}</Mono>
          </View>
        ))}
      </View>
      {fin && (
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.panel }}>
          {[{ l: 'CASH', v: fin.cash }, { l: 'PAYROLL / MO', v: fin.payroll }, { l: 'RECEIVABLES', v: fin.receivables }].map((x, i) => (
            <View key={x.l} style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 10, borderRightWidth: i === 2 ? 0 : 1, borderRightColor: C.line }}>
              <Mono size={8} color={C.t10}>{x.l}</Mono>
              <Mono size={12} weight="bold" color={x.l === 'RECEIVABLES' && x.v > 0 ? C.yellow400 : C.t2}>{x.v.toLocaleString()}</Mono>
            </View>
          ))}
        </View>
      )}
      <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Mono size={9} color={C.t10} style={{ marginBottom: 12 }}>BY CATEGORY</Mono>
        <View style={{ gap: 8 }}>
          {byCat.map(c => (
            <View key={c.cat}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Mono size={9} color={C.t8}>{c.cat}</Mono>
                <Mono size={9} color={C.t6}>{c.amt.toLocaleString()}</Mono>
              </View>
              <Bar pct={c.pct} color={C.primary} />
            </View>
          ))}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {/* 13-week cash-flow forecast (deterministic, from invoices + leads + expenses + payroll + cash) */}
        <View style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <View style={[row, { justifyContent: 'space-between', marginBottom: 8 }]}>
            <Mono size={9} color={C.t10}>13-WEEK CASH FORECAST</Mono>
            <View style={[row, { gap: 4 }]}>
              {(fc ?? []).map((x, i) => <Chip key={x.scenario} size={8} px={6} py={2} label={x.scenario.toUpperCase()} active={scn === i} color={i === 0 ? C.red400 : i === 2 ? C.green400 : C.primary} onPress={() => setScn(i)} />)}
            </View>
          </View>
          {f ? (
            <>
              <View style={[row, { gap: 12, marginBottom: 8, flexWrap: 'wrap' }]}>
                <View><Mono size={8} color={C.t10}>CASH LOW</Mono><Mono size={13} weight="bold" color={f.minCash < 0 ? C.red400 : C.t1}>{f.minCash.toLocaleString()}</Mono><Mono size={8} color={C.t10}>week {f.minCashWeek}</Mono></View>
                <View><Mono size={8} color={C.t10}>END OF Q</Mono><Mono size={13} weight="bold" color={C.t1}>{f.endCash.toLocaleString()}</Mono></View>
                <View><Mono size={8} color={C.t10}>REVENUE 13W</Mono><Mono size={13} weight="bold" color={C.green400}>{Math.round(f.revenue90).toLocaleString()}</Mono></View>
                {f.shortfallWeek && <View><Mono size={8} color={C.red400}>SHORTFALL</Mono><Mono size={13} weight="bold" color={C.red400}>week {f.shortfallWeek}</Mono></View>}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 60 }}>
                {f.weeks.map(w => (
                  <View key={w.week} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 60 }}>
                    <View style={{ width: '100%', height: Math.max(2, Math.round((Math.abs(w.cash) / maxCash) * 52)), backgroundColor: w.cash < 0 ? C.red500 : w.week === f.minCashWeek ? C.amber500 : C.line2, borderWidth: 1, borderColor: C.line5 }} />
                  </View>
                ))}
              </View>
              <View style={[row, { justifyContent: 'space-between', marginTop: 4 }]}><Mono size={8} color={C.t10}>W1</Mono><Mono size={8} color={C.t10}>W7</Mono><Mono size={8} color={C.t10}>W13</Mono></View>
              <Pressable onPress={() => Linking.openURL(reportUrl())} style={{ marginTop: 10, alignSelf: 'flex-start' }}><Mono size={9} color={C.primary} underline>OPEN FOUNDER MEMO (REPORT) →</Mono></Pressable>
            </>
          ) : <Mono size={9} color={C.t10}>Loads from the server.</Mono>}
        </View>
        <Strip><Mono size={9} color={C.t10}>RECENT EXPENSES</Mono></Strip>
        {EXPENSES.map(e => (
          <View key={e.id} style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
            <View style={between}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <T size={14} color={C.t1}>{e.desc}</T>
                <View style={[row, { gap: 8, marginTop: 4 }]}>
                  <Mono size={9} color={C.t9}>{e.date}</Mono>
                  <View style={{ borderWidth: 1, borderColor: C.line2, paddingHorizontal: 4 }}>
                    <Mono size={9} color={C.t9}>{e.category}</Mono>
                  </View>
                  {e.auto && <Mono size={9} color={C.t10}>AUTO</Mono>}
                </View>
                <Mono size={9} color={C.t10} style={{ marginTop: 4 }}>Office: {e.office.toLocaleString()} · Personal: {e.personal.toLocaleString()}</Mono>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Mono size={14} weight="bold" color={C.fg}>{e.amount.toLocaleString()}</Mono>
                <Mono size={9} color={C.t10}>{e.currency}</Mono>
                {e.verified ? <Mono size={9} color={C.green400}>✓ VFD</Mono> : <Pressable onPress={() => dispatch({ type: 'patch', collection: 'expenses', id: e.id, patch: { verified: true } })}><Mono size={9} color={C.yellow400}>VERIFY</Mono></Pressable>}
              </View>
            </View>
          </View>
        ))}
        <DashedButton label={'+ ADD VIA VOICE OR ASSISTANT ("log 1,200 for fuel")'} />
      </ScrollView>
    </View>
  )
}
