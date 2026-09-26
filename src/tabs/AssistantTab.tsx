import React, { useState, useRef, useEffect } from 'react'
import { View, ScrollView, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { T, Mono } from '@/components/T'
import { row } from '@/components/ui'
import { C, F } from '@/theme'
import { useStore } from '@/store'
import { askAssistant, ChatMessage } from '@/services/api'
import { RecommendationCard } from '@/components/RecommendationCard'
import { Chip } from '@/components/ui'
import { fmtTime } from '@/store'

export function AssistantTab() {
  const store = useStore()
  const { syncNow } = store
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [showRecs, setShowRecs] = useState(true)
  const recs = store.state.recommendations.filter(r => r.status === 'new').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const convoTime = (id: string) => { const c = store.state.conversations.find(x => x.id === id); return c ? fmtTime(c.createdAt) : '' }
  const canSend = !!input.trim() && !loading
  const scrollRef = useRef<ScrollView>(null)

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return
    
    setInput('')
    const newMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...messages, newMsg]
    setMessages(newHistory)
    setLoading(true)

    // Build context from store
    const context = {
      convosCount: store.state.conversations.length,
      openCommitments: store.state.decisions.filter(d => d.type === 'Commitment' && d.status !== 'completed').map(d => ({ id: d.id, title: d.title, who: d.who, by: d.by, status: d.status })),
      openAssignments: store.state.assignments.filter(a => a.status !== 'done').map(a => ({ id: a.id, task: a.task, assignee: a.assignee, due: a.due })),
      recentExpenses: store.state.expenses.slice(0, 10),
      kpi: store.state.kpis.slice(0, 5),
      problems: store.state.problems.map(p => ({ id: p.id, title: p.title, severity: p.severity, status: p.status }))
    }

    try {
      const r = await askAssistant(text, messages, context)
      setMessages([...newHistory, { role: 'assistant', content: r.reply, actions: r.actions }])
      if (r.actions?.length) void syncNow()
    } catch (e) {
      setMessages([...newHistory, { role: 'assistant', content: `❌ ${(e as Error).message || 'Failed to get response. Is the server running?'}` }])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }, [messages])

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[row, { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <Mono size={12} weight="bold" color={C.primary}>🤖 EA-OS ASSISTANT</Mono>
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1, padding: 16 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        {recs.length > 0 && (
          <View style={{ gap: 8 }}>
            <View style={[row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Mono size={9} weight="semibold" color={C.primary}>⚡ FROM YOUR RECORDINGS · {recs.length} NEXT STEP{recs.length > 1 ? 'S' : ''}</Mono>
              <Chip size={8} px={6} py={2} label={showRecs ? 'HIDE' : 'SHOW'} onPress={() => setShowRecs(v => !v)} />
            </View>
            {showRecs && recs.slice(0, 8).map(r => (
              <View key={r.id}>
                <Mono size={8} color={C.t10} style={{ marginBottom: 3 }}>{convoTime(r.conversationId)} NOTE · "{r.itemText.slice(0, 60)}{r.itemText.length > 60 ? '…' : ''}"</Mono>
                <RecommendationCard r={r} onAsk={p => setInput(p)} />
              </View>
            ))}
          </View>
        )}
        {messages.length === 0 && recs.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <T size={13} color={C.t6} center>I am your AI Assistant.</T>
            <T size={12} color={C.t8} center style={{ marginTop: 8 }}>I can see your tasks, finances and KPIs — and I can act: delegate, log, remind, draft emails, run the Solver.</T>
            <View style={{ marginTop: 16, gap: 6, width: '100%' }}>
              {['What is due this week?', 'Delegate to Bilal: send the proposal to Novex, due in 3 days', 'Log 1,200 PKR for fuel', 'Remind me Friday to chase Acme', 'Run the solver on our pricing'].map(q => (
                <Pressable key={q} onPress={() => setInput(q)} style={{ borderWidth: 1, borderColor: C.line2, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <T size={12} color={C.t3}>{q}</T>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.role === 'user'
          return (
            <View key={i} style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: isUser ? C.primary : C.panel, padding: 12, borderRadius: 8, borderWidth: isUser ? 0 : 1, borderColor: C.line }}>
              <T size={13} color={isUser ? '#000' : C.t1}>{msg.content}</T>
              {!!msg.actions?.length && <Mono size={8} color={C.green400} style={{ marginTop: 6 }}>⚡ {msg.actions.map(a => a.replace(/_/g, ' ').toUpperCase()).join(' · ')}</Mono>}
            </View>
          )
        })}
        {loading && (
          <View style={{ alignSelf: 'flex-start', padding: 12 }}>
            <ActivityIndicator color={C.primary} size="small" />
          </View>
        )}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', padding: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg, gap: 8 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask me anything..."
          placeholderTextColor={C.t9}
          returnKeyType="send"
          blurOnSubmit={false}
          editable={!loading}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ flex: 1, minHeight: 44, backgroundColor: C.input, color: C.t1, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: focused ? C.primary : C.line2, fontFamily: F.sans, fontSize: 14 }}
          onSubmitEditing={handleSend}
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          hitSlop={6}
          style={({ pressed }) => ({ minWidth: 84, minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, opacity: !canSend ? 0.35 : pressed ? 0.8 : 1 })}
        >
          {loading
            ? <ActivityIndicator color="#000" size="small" />
            : <Mono size={11} weight="bold" color="#000">SEND ➤</Mono>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
