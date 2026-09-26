import { useEffect, useState } from 'react'
import { View, ScrollView, Pressable, TextInput, Switch, Alert, Share, Platform } from 'react-native'
import { T, Mono } from './T'
import { Chip, Strip, row, between } from './ui'
import { useStore } from '@/store'
import { saveSettings, apiBaseUrl, serverHealth, testNotification, runJob } from '@/services/api'
import { speechAvailable } from '@/services/speech'
import { registerForPush, remotePushSupported } from '@/services/push'
import type { ServerSettings } from '@/types'
import { C, F, alpha } from '@/theme'

const Field = ({ label, value, onChange, keyboard = 'default', multiline }: { label: string; value: string; onChange: (t: string) => void; keyboard?: 'default' | 'numeric' | 'email-address'; multiline?: boolean }) => (
  <View style={{ marginBottom: 12 }}>
    <Mono size={9} color={C.t10} style={{ marginBottom: 4 }}>{label}</Mono>
    <TextInput value={value} onChangeText={onChange} keyboardType={keyboard} multiline={multiline} autoCapitalize="none"
      style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10, minHeight: multiline ? 70 : undefined, textAlignVertical: 'top' }} />
  </View>
)

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { state, dispatch, syncNow, online } = useStore()
  const [s, setS] = useState<ServerSettings | null>(state.serverSettings)
  const [health, setHealth] = useState<Awaited<ReturnType<typeof serverHealth>>>(null)
  const [saving, setSaving] = useState(false)
  const [pushToken, setPushToken] = useState<string | null>(null)
  useEffect(() => { serverHealth().then(setHealth) }, [])
  useEffect(() => { if (!s && state.serverSettings) setS(state.serverSettings) }, [state.serverSettings, s])

  const goal = (m: string) => s?.goals.find(g => g.metric.toLowerCase() === m.toLowerCase())
  const setGoal = (m: string, target: number) => s && setS({ ...s, goals: s.goals.some(g => g.metric.toLowerCase() === m.toLowerCase()) ? s.goals.map(g => g.metric.toLowerCase() === m.toLowerCase() ? { ...g, target } : g) : [...s.goals, { metric: m, target, unit: m === 'Revenue' ? 'PKR' : 'leads', period: 'month' }] })

  const save = async () => {
    if (!s) return
    setSaving(true)
    try { const r = await saveSettings(s); dispatch({ type: 'settings/set', settings: r }); Alert.alert('Saved', 'Settings updated on the server. Automations use them from the next run.') }
    catch (e) { Alert.alert('Not saved', (e as Error).message) } finally { setSaving(false) }
  }
  const exportData = async () => {
    const { outbox: _o, hydrated: _h, ...data } = state
    const json = JSON.stringify(data, null, 2)
    try { await Share.share(Platform.OS === 'ios' ? { message: json, title: 'EA-OS export' } : { message: json }) } catch { /* cancelled */ }
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70, backgroundColor: C.bg }}>
      <View style={[between, { alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <View><Mono size={14} weight="bold">SETTINGS</Mono><Mono size={9} color={C.t10} style={{ marginTop: 2 }}>{online ? '● SYNCED' : '○ OFFLINE — CHANGES QUEUED'}{state.outbox.length ? ` · ${state.outbox.length} PENDING` : ''}</Mono></View>
        <Pressable onPress={onClose} hitSlop={12}><Mono size={20} color={C.t9}>✕</Mono></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Strip><Mono size={9} color={C.t10}>SERVER</Mono></Strip>
        <View style={{ padding: 20, gap: 6 }}>
          <Mono size={10} color={C.t3}>{apiBaseUrl()}</Mono>
          <Mono size={9} color={health ? C.green400 : C.red400}>{health ? `● ${health.provider} · ${health.model} · key ${health.hasKey ? 'ok' : 'missing'} · auth ${health.auth ? 'on' : 'OFF'} · smtp ${health.smtp ? 'on' : 'off'}` : '○ unreachable'}</Mono>
          <Mono size={9} color={C.t9}>Live speech-to-text: {speechAvailable() ? 'on-device' : 'server (Whisper) — build a dev client for live text'}</Mono>
          <View style={[row, { gap: 6, marginTop: 6, flexWrap: 'wrap' }]}>
            <Chip size={9} label="SYNC NOW" onPress={() => void syncNow()} />
            <Chip size={9} label={remotePushSupported ? 'ENABLE PUSH' : 'ENABLE ALERTS'} onPress={async () => { const t = await registerForPush(); setPushToken(t); Alert.alert(t ? 'Push enabled' : remotePushSupported ? 'Push unavailable' : 'Local alerts enabled', t ? 'This device will receive briefs and reminders.' : remotePushSupported ? 'Permission denied or not a physical device.' : 'In Expo Go, new inbox items show as local notifications while the app is open. Build a dev client (npx expo run:android) for background push.') }} />
            <Chip size={9} label="TEST NOTIFICATION" onPress={() => testNotification().then(() => Alert.alert('Sent', 'Check the bell on Home (and your phone if push is enabled).')).catch(e => Alert.alert('Failed', e.message))} />
          </View>
          {pushToken && <Mono size={8} color={C.t10}>{pushToken}</Mono>}
        </View>

        {s ? (
          <>
            <Strip><Mono size={9} color={C.t10}>PROFILE & GOALS</Mono></Strip>
            <View style={{ padding: 20 }}>
              <Field label="FOUNDER NAME" value={s.founderName} onChange={t => setS({ ...s, founderName: t })} />
              <Field label="CURRENCY" value={s.currency} onChange={t => setS({ ...s, currency: t.toUpperCase() })} />
              <Field label="MONTHLY REVENUE TARGET" value={String(goal('Revenue')?.target ?? 100000)} onChange={t => setGoal('Revenue', Number(t.replace(/[^0-9]/g, '')) || 0)} keyboard="numeric" />
              <Field label="MONTHLY PIPELINE TARGET (LEADS)" value={String(goal('Pipeline')?.target ?? 20)} onChange={t => setGoal('Pipeline', Number(t.replace(/[^0-9]/g, '')) || 0)} keyboard="numeric" />
              <Field label="CASH BALANCE (FOR RUNWAY)" value={String(s.cashBalance)} onChange={t => setS({ ...s, cashBalance: Number(t.replace(/[^0-9]/g, '')) || 0 })} keyboard="numeric" />
              <Mono size={9} color={C.t10} style={{ marginBottom: 6 }}>YOUR AREA — used for "find a doctor / vendor near me" recommendations</Mono>
              <View style={[row, { gap: 12 }]}>
                <View style={{ flex: 1 }}><Field label="AREA" value={s.location?.area ?? ''} onChange={t => setS({ ...s, location: { ...(s.location ?? { city: '', country: 'Pakistan' }), area: t } })} /></View>
                <View style={{ flex: 1 }}><Field label="CITY" value={s.location?.city ?? ''} onChange={t => setS({ ...s, location: { ...(s.location ?? { area: '', country: 'Pakistan' }), city: t } })} /></View>
              </View>
            </View>

            <Strip><Mono size={9} color={C.t10}>AUTOMATIONS & NOTIFICATIONS</Mono></Strip>
            <View style={{ padding: 20 }}>
              {([['morningBrief', 'Morning brief'], ['eodRecap', 'End-of-day recap'], ['reminders', 'Commitment reminders (T-2, T-0)'], ['overdue', 'Overdue alerts']] as const).map(([k, l]) => (
                <View key={k} style={[between, { alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line3 }]}>
                  <T size={14} color={C.t2}>{l}</T>
                  <Switch value={s.notifications[k]} onValueChange={v => setS({ ...s, notifications: { ...s.notifications, [k]: v } })} trackColor={{ true: C.primary, false: C.line2 }} thumbColor="#fff" />
                </View>
              ))}
              <View style={[row, { gap: 12, marginTop: 12 }]}>
                <View style={{ flex: 1 }}><Field label="BRIEF HOUR (0-23)" value={String(s.notifications.briefHour)} onChange={t => setS({ ...s, notifications: { ...s.notifications, briefHour: Math.min(23, Number(t.replace(/[^0-9]/g, '')) || 0) } })} keyboard="numeric" /></View>
                <View style={{ flex: 1 }}><Field label="RECAP HOUR (0-23)" value={String(s.notifications.recapHour)} onChange={t => setS({ ...s, notifications: { ...s.notifications, recapHour: Math.min(23, Number(t.replace(/[^0-9]/g, '')) || 0) } })} keyboard="numeric" /></View>
              </View>
              <Mono size={9} color={C.t10} style={{ marginBottom: 6 }}>RUN NOW</Mono>
              <View style={[row, { gap: 6, flexWrap: 'wrap' }]}>
                {[['morning_brief', 'MORNING BRIEF'], ['eod_recap', 'EOD RECAP'], ['overdue_scan', 'OVERDUE SCAN'], ['invoice_chase', 'INVOICE CHASE'], ['investor_update', 'INVESTOR UPDATE'], ['escalation_check', 'ESCALATION'], ['runway_check', 'RUNWAY'], ['monthly_close', 'MONTHLY CLOSE']].map(([k, l]) => (
                  <Chip key={k} size={9} label={l} onPress={() => runJob(k).then(r => Alert.alert('Queued', r.note)).catch(e => Alert.alert('Failed', e.message))} />
                ))}
              </View>
            </View>

            <Strip><Mono size={9} color={C.t10}>EMAIL</Mono></Strip>
            <View style={{ padding: 20 }}>
              <Field label="FROM ADDRESS" value={s.email.from} onChange={t => setS({ ...s, email: { ...s.email, from: t } })} keyboard="email-address" />
              <Field label="SIGNATURE" value={s.email.signature} onChange={t => setS({ ...s, email: { ...s.email, signature: t } })} multiline />
              <T size={11} color={C.t9}>SMTP credentials live on the server (server/.env). Gmail: smtp.gmail.com, port 587, your address, an App Password.</T>
            </View>

            <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
              <Pressable onPress={save} disabled={saving} style={{ paddingVertical: 12, backgroundColor: saving ? C.line : C.primary, alignItems: 'center' }}>
                <Mono size={11} weight="bold" color={saving ? C.t9 : '#000'}>{saving ? 'SAVING…' : 'SAVE SETTINGS'}</Mono>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={{ padding: 20 }}><Mono size={10} color={C.t10}>Server settings load once the server is reachable.</Mono></View>
        )}

        <Strip><Mono size={9} color={C.t10}>PRIVACY & DATA</Mono></Strip>
        <View style={{ padding: 20, gap: 8 }}>
          <T size={12} color={C.t8}>Data lives on this phone (AsyncStorage) and on your server's SQLite database in server/data. Audio is sent to Groq for transcription and not stored on the server.</T>
          <View style={[row, { gap: 6, flexWrap: 'wrap', marginTop: 4 }]}>
            <Chip size={9} label="EXPORT JSON" onPress={exportData} />
            <Chip size={9} label="RESET LOCAL DATA" active color={C.red400} style={{ borderColor: C.red900 }} onPress={() => Alert.alert('Reset local data?', 'Restores the seed data on this phone and re-syncs from the server.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', style: 'destructive', onPress: () => dispatch({ type: 'reset' }) }])} />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
export const _a = alpha
