import { useState } from 'react'
import { View, Pressable, ScrollView, TextInput, Alert, Linking, Platform } from 'react-native'
import { T, Mono } from '@/components/T'
import { Chip, DashedButton, Header, Strip, between, row } from '@/components/ui'
import { StatusBadge } from '@/components/StatusBadge'
import { useStore, fmtDate, uid } from '@/store'
import { sendEmail, draftEmail, createInvoice, apiBaseUrl, fetchClientProfile } from '@/services/api'
import { useEffect } from 'react'
import type { Assignment, Invoice, EmailDraft, ClientProfile } from '@/types'
import { C, F, alpha } from '@/theme'

type View_ = 'team' | 'tasks' | 'invoices' | 'email' | 'clients'

// WhatsApp delivery without the Business API: deep-link to the person's number with the task pre-filled.
async function sendWhatsApp(phone: string | undefined, text: string) {
  const digits = (phone ?? '').replace(/[^0-9]/g, '')
  const url = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `whatsapp://send?text=${encodeURIComponent(text)}`
  try { await Linking.openURL(url) } catch { Alert.alert('WhatsApp not available', Platform.OS === 'web' ? 'Open on your phone to send via WhatsApp.' : 'Install WhatsApp or add a phone number in Team.') }
}

export function OpsTab({ focusId }: { focusId?: string | null }) {
  const { state, dispatch, syncNow } = useStore()
  const [view, setView] = useState<View_>(focusId && state.emails.some(e => e.id === focusId) ? 'email' : 'team')
  const [emailExpanded, setEmailExpanded] = useState<string | null>(focusId ?? state.emails[0]?.id ?? null)
  const [sending, setSending] = useState<string | null>(null)
  const [editingPhone, setEditingPhone] = useState<string | null>(null)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [compose, setCompose] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeBrief, setComposeBrief] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [newInvoice, setNewInvoice] = useState(false)
  const [invClient, setInvClient] = useState('')
  const [invAmount, setInvAmount] = useState('')
  const [invDesc, setInvDesc] = useState('')
  const [invEmail, setInvEmail] = useState('')

  const openTasks = state.assignments.filter(a => a.status !== 'done')
  const tasksFor = (name: string) => state.assignments.filter(a => a.assignee.toLowerCase().includes(name.toLowerCase()) && a.status !== 'done')
  const payroll = state.staff.filter(m => m.status !== 'left').reduce((a, m) => a + m.salary, 0)
  const receivable = state.invoices.filter(i => i.status === 'sent' || i.status === 'overdue')
  const smtp = state.serverSettings?.email?.from !== undefined

  const handleSend = async (e: EmailDraft) => {
    setSending(e.id)
    try { const r = await sendEmail(e.id); dispatch({ type: 'put', collection: 'emails', doc: r, local: true }); void syncNow() }
    catch (err) { Alert.alert('Not sent', (err as Error).message) }
    finally { setSending(null) }
  }
  const handleDraft = async () => {
    if (!composeTo.trim() || !composeBrief.trim()) return
    setDrafting(true)
    try { const d = await draftEmail(composeTo.trim(), composeBrief.trim()); dispatch({ type: 'put', collection: 'emails', doc: d, local: true }); setCompose(false); setComposeTo(''); setComposeBrief(''); setEmailExpanded(d.id) }
    catch (err) { Alert.alert('Draft failed', (err as Error).message) }
    finally { setDrafting(false) }
  }
  const handleInvoice = async () => {
    const amount = Number(invAmount.replace(/[^0-9.]/g, '')); if (!invClient.trim() || !amount) return
    try { const inv = await createInvoice({ client: invClient.trim(), amount, description: invDesc.trim(), email: invEmail.trim() || undefined, dueDays: 14 }); dispatch({ type: 'put', collection: 'invoices', doc: inv, local: true }); setNewInvoice(false); setInvClient(''); setInvAmount(''); setInvDesc(''); setInvEmail('') }
    catch (err) { Alert.alert('Could not create invoice', (err as Error).message) }
  }
  const daysLate = (inv: Invoice) => Math.floor((Date.now() - new Date(inv.dueAt).getTime()) / 86_400_000)

  // The link opens a public page on the server where staff tap "Mark done" — no app or account needed.
  const taskMessage = (a: Assignment) => `Hi ${a.assignee}, task from EA-OS:\n\n${a.task}\nDue: ${a.due}\n\nTap when finished: ${apiBaseUrl()}/t/${a.id}`
  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const openProfile = async (id: string) => { setProfileLoading(true); try { setProfile(await fetchClientProfile(id)) } catch (e) { Alert.alert('Profile unavailable', (e as Error).message) } finally { setProfileLoading(false) } }
  const [newClient, setNewClient] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  useEffect(() => { void 0 }, [])

  return (
    <View style={{ flex: 1 }}>
      <Header style={{ paddingBottom: 0 }}>
        <Mono size={14} weight="bold" style={{ marginBottom: 12 }}>STAFF & OPERATIONS</Mono>
        <View style={{ flexDirection: 'row' }}>
          {([['team', 'TEAM'], ['tasks', `TASKS${openTasks.length ? ` (${openTasks.length})` : ''}`], ['clients', 'CLIENTS'], ['invoices', `INVOICES${receivable.length ? ` (${receivable.length})` : ''}`], ['email', `EMAIL${state.emails.filter(e => e.status === 'draft').length ? ` (${state.emails.filter(e => e.status === 'draft').length})` : ''}`]] as const).map(([v, l]) => (
            <Pressable key={v} onPress={() => setView(v)} style={{ paddingHorizontal: 9, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: view === v ? C.primary : 'transparent' }}>
              <Mono size={10} color={view === v ? C.primary : C.t10}>{l}</Mono>
            </Pressable>
          ))}
        </View>
      </Header>

      {view === 'team' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.panel }}>
            <View style={[row, { justifyContent: 'space-between' }]}>
              <View><Mono size={9} color={C.t10}>MONTHLY PAYROLL</Mono><Mono size={20} weight="bold" color={C.primary}>{payroll.toLocaleString()} PKR</Mono></View>
              <View style={{ alignItems: 'flex-end' }}><Mono size={9} color={C.t10}>NEXT RUN</Mono><Mono size={14} color={C.t6}>{fmtDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString())}</Mono></View>
            </View>
          </View>
          {state.staff.filter(m => !/ceo|founder/i.test(m.role)).map(m => (
            <View key={m.id} style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
              <View style={between}>
                <View style={{ flex: 1 }}>
                  <View style={[row, { gap: 8 }]}><T weight="semibold" color={C.t1}>{m.name}</T><StatusBadge status={m.status} /></View>
                  <Mono size={10} color={C.t9} style={{ marginTop: 2 }}>{m.role}</Mono>
                  <Mono size={9} color={C.t10} style={{ marginTop: 4 }}>Open tasks: <Mono size={9} color={C.t6}>{tasksFor(m.name).length}</Mono></Mono>
                  {editingPhone === m.id ? (
                    <View style={[row, { gap: 6, marginTop: 6 }]}>
                      <TextInput value={phoneDraft} onChangeText={setPhoneDraft} placeholder="+92 3xx xxxxxxx" placeholderTextColor={C.t10} keyboardType="phone-pad" style={{ flex: 1, backgroundColor: C.input, borderWidth: 1, borderColor: C.primary, color: C.t1, fontFamily: F.mono, fontSize: 12, paddingHorizontal: 8, paddingVertical: 6 }} />
                      <Chip size={9} label="SAVE" active onPress={() => { dispatch({ type: 'patch', collection: 'staff', id: m.id, patch: { phone: phoneDraft.trim() } }); setEditingPhone(null) }} />
                    </View>
                  ) : (
                    <Pressable onPress={() => { setEditingPhone(m.id); setPhoneDraft(m.phone ?? '') }} style={{ marginTop: 4 }}>
                      <Mono size={9} color={m.phone ? C.t8 : C.t10}>📱 {m.phone || 'add WhatsApp number'}</Mono>
                    </Pressable>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}><Mono size={14} weight="bold" color={C.t6}>{m.salary.toLocaleString()}</Mono><Mono size={9} color={C.t10}>PKR/mo</Mono></View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {view === 'tasks' && (
        <ScrollView style={{ flex: 1 }}>
          <Strip row>
            <Mono size={9} color={C.t10}>TEAM ASSIGNMENTS · AUTO-DELEGATED</Mono>
            <Mono size={9} color={C.t9}>{openTasks.length} OPEN · {state.assignments.length - openTasks.length} DONE</Mono>
          </Strip>
          {state.assignments.map(a => {
            const overdue = a.status !== 'done' && new Date(a.dueAt) < new Date()
            const member = state.staff.find(m => a.assignee.toLowerCase().includes(m.name.toLowerCase()))
            return (
              <View key={a.id} style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line3, opacity: a.status === 'done' ? 0.55 : 1 }}>
                <View style={between}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <T size={14} color={C.t1} style={a.status === 'done' ? { textDecorationLine: 'line-through' } : undefined}>{a.task}</T>
                    <View style={[row, { gap: 12, marginTop: 4, flexWrap: 'wrap' }]}>
                      <Mono size={9} color={C.t9}>OWNER: <Mono size={9} color={C.t6}>{a.assignee}</Mono></Mono>
                      <Mono size={9} color={overdue ? C.red400 : C.t9}>DUE: {a.due}</Mono>
                      <StatusBadge status={a.status === 'done' ? 'completed' : overdue ? 'overdue' : a.status} />
                    </View>
                    <Mono size={9} color={C.t10} style={{ marginTop: 3 }}>{a.source}{a.doneVia === 'link' ? ' · marked done by staff' : ''}</Mono>
                    {!!a.replies?.length && a.replies.slice(-2).map((r, i) => (
                      <View key={i} style={{ marginTop: 4, borderLeftWidth: 2, borderLeftColor: C.purple900, paddingLeft: 8 }}>
                        <Mono size={8} color={C.t10}>{fmtDate(r.at)} · {a.assignee}</Mono>
                        <T size={12} color={C.t3}>{r.text}</T>
                      </View>
                    ))}
                    {a.status !== 'done' && (
                      <Pressable onPress={() => sendWhatsApp(member?.phone, taskMessage(a))} style={[row, { gap: 4, marginTop: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: C.green900, paddingHorizontal: 8, paddingVertical: 4 }]}>
                        <Mono size={9} color={C.green400}>💬 SEND VIA WHATSAPP{member?.phone ? '' : ' (no number)'}</Mono>
                      </Pressable>
                    )}
                  </View>
                  <View style={{ gap: 6 }}>
                    {a.status === 'pending' && <Chip size={9} label="START" active color={C.blue400} style={{ borderColor: C.blue900 }} onPress={() => dispatch({ type: 'patch', collection: 'assignments', id: a.id, patch: { status: 'in_progress' } })} />}
                    {a.status !== 'done' && <Chip size={9} label="DONE" active color={C.green400} style={{ borderColor: C.green900 }} onPress={() => dispatch({ type: 'patch', collection: 'assignments', id: a.id, patch: { status: 'done' } })} />}
                    {a.status === 'done' && <Chip size={9} label="REOPEN" onPress={() => dispatch({ type: 'patch', collection: 'assignments', id: a.id, patch: { status: 'pending' } })} />}
                  </View>
                </View>
              </View>
            )
          })}
          {!state.assignments.length && <View style={{ padding: 30, alignItems: 'center' }}><Mono size={10} color={C.t10}>NO ASSIGNMENTS YET — COMMIT A VOICE NOTE OR SOLVER PLAN</Mono></View>}
        </ScrollView>
      )}


      {view === 'clients' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {profile && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: C.bg }}>
              <View style={[between, { alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }]}>
                <View><Mono size={9} color={C.primary}>CLIENT PROFILE</Mono><T size={18} weight="bold">{profile.client.name}</T>{!!profile.client.email && <Mono size={9} color={C.t9}>{profile.client.email}</Mono>}</View>
                <Pressable onPress={() => setProfile(null)} hitSlop={12}><Mono size={20} color={C.t9}>✕</Mono></Pressable>
              </View>
              <ScrollView>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: C.line }}>
                  {[['OUTSTANDING', profile.stats.outstanding.toLocaleString(), C.red400], ['PAID', profile.stats.paid.toLocaleString(), C.green400], ['MENTIONS', String(profile.stats.mentions), C.t2], ['OPEN COMMITS', String(profile.stats.openCommitments), C.yellow400], ['PROBLEMS', String(profile.stats.openProblems), C.orange400], ['LEADS', String(profile.stats.leads), C.cyan400]].map(([l, v, c]) => (
                    <View key={l} style={{ width: '33.33%', padding: 12, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.line3 }}><Mono size={8} color={C.t10}>{l}</Mono><Mono size={14} weight="bold" color={c}>{v}</Mono></View>
                  ))}
                </View>
                <Strip><Mono size={9} color={C.t10}>TIMELINE</Mono></Strip>
                {profile.timeline.map((t, i) => (
                  <View key={i} style={{ paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                    <View style={[row, { gap: 8 }]}><Mono size={9} color={C.t10}>{fmtDate(t.at)}</Mono><Mono size={9} color={C.primary}>{t.type.toUpperCase()}</Mono></View>
                    <T size={13} color={C.t2} style={{ marginTop: 2 }}>{t.text}</T>
                  </View>
                ))}
                {!profile.timeline.length && <View style={{ padding: 30, alignItems: 'center' }}><Mono size={10} color={C.t10}>NOTHING LOGGED FOR THIS CLIENT YET</Mono></View>}
              </ScrollView>
            </View>
          )}
          <Strip row><Mono size={9} color={C.t10}>CLIENTS · TAP FOR FULL HISTORY</Mono><Mono size={9} color={C.t9}>{profileLoading ? '⟳' : `${state.clients.length}`}</Mono></Strip>
          {state.clients.map(c => {
            const outstanding = state.invoices.filter(i => i.client.toLowerCase() === c.name.toLowerCase() && (i.status === 'sent' || i.status === 'overdue')).reduce((a, i) => a + i.amount, 0)
            return (
              <Pressable key={c.id} onPress={() => openProfile(c.id)} style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line3 }}>
                <View style={between}>
                  <View><T size={14} weight="medium" color={C.t1}>{c.name}</T><Mono size={9} color={C.t9} style={{ marginTop: 2 }}>{c.email || 'no email'}{c.aliases?.length ? ` · aka ${c.aliases.join(', ')}` : ''}</Mono></View>
                  <View style={{ alignItems: 'flex-end' }}>{outstanding > 0 ? <Mono size={12} weight="bold" color={C.red400}>{outstanding.toLocaleString()}</Mono> : <Mono size={9} color={C.green400}>CLEAR</Mono>}<Mono size={9} color={C.t10}>→</Mono></View>
                </View>
              </Pressable>
            )
          })}
          {newClient ? (
            <View style={{ margin: 20, gap: 8, borderWidth: 1, borderColor: C.line2, padding: 12 }}>
              <TextInput value={clientName} onChangeText={setClientName} placeholder="Client name" placeholderTextColor={C.t10} style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10 }} />
              <TextInput value={clientEmail} onChangeText={setClientEmail} placeholder="Accounts email (for invoice reminders)" placeholderTextColor={C.t10} keyboardType="email-address" autoCapitalize="none" style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10 }} />
              <View style={[row, { gap: 8 }]}>
                <Pressable onPress={() => { if (!clientName.trim()) return; dispatch({ type: 'put', collection: 'clients', doc: { id: uid(), name: clientName.trim(), email: clientEmail.trim() || undefined, aliases: [] } }); setClientName(''); setClientEmail(''); setNewClient(false) }} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.primary }}><Mono size={10} color="#000">ADD</Mono></Pressable>
                <Chip label="CANCEL" px={12} py={8} onPress={() => setNewClient(false)} />
              </View>
            </View>
          ) : <DashedButton label="+ ADD CLIENT" onPress={() => setNewClient(true)} />}
        </ScrollView>
      )}

      {view === 'invoices' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Strip row>
            <Mono size={9} color={receivable.length ? C.red400 : C.t10}>{receivable.filter(i => i.status === 'overdue').length} OVERDUE · {receivable.reduce((a, i) => a + i.amount, 0).toLocaleString()} PKR OUTSTANDING</Mono>
            <Mono size={9} color={C.t9}>AUTO-CHASED DAILY</Mono>
          </Strip>
          {state.invoices.map(inv => {
            const late = daysLate(inv)
            return (
              <View key={inv.id} style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line3, opacity: inv.status === 'paid' || inv.status === 'void' ? 0.55 : 1 }}>
                <View style={between}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <T size={14} weight="medium" color={C.t1}>{inv.client}</T>
                    <Mono size={10} color={C.t9} style={{ marginTop: 2 }}>{inv.number}{inv.description ? ` · ${inv.description}` : ''}</Mono>
                    <View style={[row, { gap: 8, marginTop: 4, flexWrap: 'wrap' }]}>
                      <Mono size={9} color={inv.status === 'overdue' ? C.red400 : C.t9}>DUE: {fmtDate(inv.dueAt)}{late > 0 && inv.status !== 'paid' ? ` (${late}d late)` : ''}</Mono>
                      <StatusBadge status={inv.status === 'paid' ? 'completed' : inv.status === 'sent' ? 'pending' : inv.status} />
                      {inv.chaseStage > 0 && <Mono size={9} color={C.yellow400}>CHASE {['', '1st reminder', '2nd reminder', 'demand notice', 'escalated'][inv.chaseStage]}</Mono>}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Mono size={14} weight="bold" color={C.fg}>{inv.amount.toLocaleString()}</Mono>
                    <Mono size={9} color={C.t10}>{inv.currency}</Mono>
                    {(inv.status === 'sent' || inv.status === 'overdue') && <Chip size={9} label="PAID" active color={C.green400} style={{ borderColor: C.green900 }} onPress={() => dispatch({ type: 'patch', collection: 'invoices', id: inv.id, patch: { status: 'paid' } })} />}
                  </View>
                </View>
              </View>
            )
          })}
          {!state.invoices.length && <View style={{ padding: 30, alignItems: 'center' }}><Mono size={10} color={C.t10}>NO INVOICES — ADD ONE; OVERDUE ONES ARE CHASED AUTOMATICALLY</Mono></View>}
          {newInvoice ? (
            <View style={{ margin: 20, gap: 8, borderWidth: 1, borderColor: C.line2, padding: 12 }}>
              <Mono size={9} color={C.t10}>NEW INVOICE · DUE IN 14 DAYS</Mono>
              {[['Client', invClient, setInvClient, 'default'], ['Amount (PKR)', invAmount, setInvAmount, 'numeric'], ['Description', invDesc, setInvDesc, 'default'], ['Client email (for reminders)', invEmail, setInvEmail, 'email-address']].map(([ph, v, set, kb]) => (
                <TextInput key={ph as string} value={v as string} onChangeText={set as (t: string) => void} placeholder={ph as string} placeholderTextColor={C.t10} keyboardType={kb as 'default'} autoCapitalize="none"
                  style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10 }} />
              ))}
              <View style={[row, { gap: 8 }]}>
                <Pressable onPress={handleInvoice} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.primary }}><Mono size={10} color="#000">CREATE</Mono></Pressable>
                <Chip label="CANCEL" px={12} py={8} onPress={() => setNewInvoice(false)} />
              </View>
            </View>
          ) : <DashedButton label="+ NEW INVOICE" onPress={() => setNewInvoice(true)} />}
        </ScrollView>
      )}

      {view === 'email' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Strip row>
            <Mono size={9} color={C.t10}>DRAFTS · APPROVE THEN SEND</Mono>
            <Mono size={9} color={C.t9}>{smtp ? 'SMTP' : '—'}</Mono>
          </Strip>
          {state.emails.map(e => (
            <View key={e.id} style={{ borderBottomWidth: 1, borderBottomColor: C.line3 }}>
              <Pressable onPress={() => setEmailExpanded(emailExpanded === e.id ? null : e.id)} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
                <View style={[between, { marginBottom: 8 }]}>
                  <View style={[row, { gap: 8 }]}>
                    <View style={{ borderWidth: 1, borderColor: C.line5, paddingHorizontal: 4 }}><Mono size={9} color={C.t9}>{e.kind.replace(/_/g, ' ').toUpperCase()}</Mono></View>
                    <StatusBadge status={e.status} />
                  </View>
                  <Mono size={10} color={C.t10}>{fmtDate(e.createdAt)}</Mono>
                </View>
                <T size={14} weight="medium" color={C.t1}>{e.subject}</T>
                <Mono size={10} color={C.t9} style={{ marginTop: 4 }}>To: {e.to}</Mono>
              </Pressable>
              {emailExpanded === e.id && (
                <View style={{ paddingHorizontal: 20, paddingBottom: 20, backgroundColor: C.panel3, borderTopWidth: 1, borderTopColor: C.line }}>
                  <Mono size={9} color={C.t10} style={{ marginBottom: 8, paddingTop: 12 }}>EMAIL PREVIEW</Mono>
                  <View style={{ borderWidth: 1, borderColor: C.line, padding: 16, backgroundColor: C.panel4 }}>
                    <Mono size={9} color={C.t9} style={{ marginBottom: 12, lineHeight: 14 }}>TO: {e.to}{'\n'}SUBJECT: {e.subject}</Mono>
                    <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 }}><T size={12} color={C.t3} relaxed>{e.body}</T></View>
                  </View>
                  {e.error && <Mono size={9} color={C.red400} style={{ marginTop: 8 }}>✕ {e.error}</Mono>}
                  {e.status !== 'sent' && (
                    <View style={[row, { gap: 8, marginTop: 12, flexWrap: 'wrap' }]}>
                      <Pressable onPress={() => handleSend(e)} disabled={sending === e.id} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: sending === e.id ? C.line : C.primary }}>
                        <Mono size={10} color={sending === e.id ? C.t9 : '#000'}>{sending === e.id ? '⟳ SENDING...' : '✓ APPROVE & SEND'}</Mono>
                      </Pressable>
                      <Chip label="DISCARD" active color={C.red500} px={12} py={8} style={{ borderColor: C.red900 }} onPress={() => dispatch({ type: 'remove', collection: 'emails', id: e.id })} />
                    </View>
                  )}
                  {e.status === 'sent' && <Mono size={10} color={C.green400} style={{ marginTop: 12 }}>✓ SENT — {e.sentAt ? fmtDate(e.sentAt) : ''}</Mono>}
                  <Mono size={9} color={C.t11} style={{ marginTop: 8 }}>Source: {e.source}</Mono>
                </View>
              )}
            </View>
          ))}
          {!state.emails.length && <View style={{ padding: 30, alignItems: 'center' }}><Mono size={10} color={C.t10}>NO DRAFTS — INVOICE REMINDERS & INVESTOR UPDATES APPEAR HERE AUTOMATICALLY</Mono></View>}
          {compose ? (
            <View style={{ margin: 20, gap: 8, borderWidth: 1, borderColor: C.line2, padding: 12 }}>
              <Mono size={9} color={C.t10}>COMPOSE WITH AI</Mono>
              <TextInput value={composeTo} onChangeText={setComposeTo} placeholder="To (email)" placeholderTextColor={C.t10} keyboardType="email-address" autoCapitalize="none" style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10 }} />
              <TextInput value={composeBrief} onChangeText={setComposeBrief} placeholder="What should it say? e.g. Ask Novex to confirm the kickoff date and share the brand assets" placeholderTextColor={C.t10} multiline style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 13, padding: 10, minHeight: 70, textAlignVertical: 'top' }} />
              <View style={[row, { gap: 8 }]}>
                <Pressable onPress={handleDraft} disabled={drafting} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: drafting ? C.line : C.primary }}><Mono size={10} color={drafting ? C.t9 : '#000'}>{drafting ? '⟳ DRAFTING…' : 'DRAFT'}</Mono></Pressable>
                <Chip label="CANCEL" px={12} py={8} onPress={() => setCompose(false)} />
              </View>
            </View>
          ) : <DashedButton label="+ COMPOSE NEW EMAIL" onPress={() => setCompose(true)} />}
          <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
            <T size={11} color={C.t9}>Sending needs SMTP on the server (`SMTP_HOST/USER/PASS` in server/.env — Gmail works with an App Password). Until then drafts are saved and marked "not sent".</T>
          </View>
        </ScrollView>
      )}
    </View>
  )
}
export const _u = { alpha }
