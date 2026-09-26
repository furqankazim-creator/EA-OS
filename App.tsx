import { useEffect, useState, useRef } from 'react'
import { View } from 'react-native'
import { StatusBar as ExpoStatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { useFonts, JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono'
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter'
import type { Tab } from '@/tabs/types'
import { StatusBar } from '@/components/StatusBar'
import { BottomNav } from '@/components/BottomNav'
import { HomeTab } from '@/tabs/HomeTab'
import { ConvosTab } from '@/tabs/ConvosTab'
import { ExtractTab } from '@/tabs/ExtractTab'
import { DecisionsTab } from '@/tabs/DecisionsTab'
import { FinanceTab } from '@/tabs/FinanceTab'
import { KpiTab } from '@/tabs/KpiTab'
import { ProblemsTab } from '@/tabs/ProblemsTab'
import { OpsTab } from '@/tabs/OpsTab'
import { AssistantTab } from '@/tabs/AssistantTab'
import { StoreProvider, useStore } from '@/store'
import { registerForPush, onNotificationTap, fireLocalNotification } from '@/services/push'
import { C } from '@/theme'

// ─── App Shell ────────────────────────────────────────────────────────────────

const TAB_IDS: Tab[] = ['home', 'convos', 'extract', 'decisions', 'finance', 'kpi', 'problems', 'ops', 'bot']

function Shell() {
  const { state } = useStore()
  const [tab, setTab] = useState<Tab>('home')
  const [extractFocusId, setExtractFocusId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

    const seenNots = useRef<Set<string>>(new Set())
  const hasHydratedOnce = useRef(false)
  useEffect(() => {
    if (!state.hydrated) return
    if (!hasHydratedOnce.current) {
      // First pass: mark all existing notifications as seen so we don't spam them
      state.notifications.forEach(n => seenNots.current.add(n.id))
      hasHydratedOnce.current = true
      return
    }
    
    // Subsequent updates: fire local push for newly arrived unread notifications
    let delayMs = 0
    state.notifications.forEach(n => {
      if (!seenNots.current.has(n.id)) {
        seenNots.current.add(n.id)
        if (!n.read) {
          // Stagger multiple notifications by 1 second so the sound doesn't overlap crazily
          setTimeout(() => fireLocalNotification(n), delayMs)
          delayMs += 1000
        }
      }
    })
  }, [state.notifications, state.hydrated])

  const handleExtract = (id: string) => { setExtractFocusId(id); setTab('extract') }
  // Deep link from a notification or inbox item: { tab, id }
  const open = (link?: { tab: string; id?: string }) => {
    if (!link) return
    const t = (TAB_IDS as string[]).includes(link.tab) ? (link.tab as Tab) : 'home'
    setFocusId(link.id ?? null)
    if (t === 'extract' && link.id) setExtractFocusId(link.id)
    setTab(t)
  }

  useEffect(() => {
    void registerForPush()
    let off = () => {}
    onNotificationTap(open).then(f => { off = f })
    return () => off()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reviewQueue = state.conversations.filter(c => c.status === 'extracted').length
  const unread = state.notifications.filter(n => !n.read).length
  const drafts = state.emails.filter(e => e.status === 'draft').length
  const overdueTasks = state.assignments.filter(a => a.status !== 'done' && new Date(a.dueAt) < new Date()).length

  const content: Record<Tab, React.ReactNode> = {
    home: <HomeTab onNavigate={setTab} onOpenExtraction={handleExtract} onOpen={open} />,
    convos: <ConvosTab onExtract={handleExtract} />,
    extract: <ExtractTab focusConvoId={extractFocusId} />,
    decisions: <DecisionsTab />,
    finance: <FinanceTab />,
    kpi: <KpiTab />,
    problems: <ProblemsTab focusId={tab === 'problems' ? focusId : null} />,
    ops: <OpsTab focusId={tab === 'ops' ? focusId : null} />,
    bot: <AssistantTab />,
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <ExpoStatusBar style="light" />
      <StatusBar />
      <View style={{ flex: 1, overflow: 'hidden' }}>{content[tab]}</View>
      <BottomNav tab={tab} onChange={setTab} badges={{ home: unread, extract: reviewQueue, ops: drafts + overdueTasks }} />
    </SafeAreaView>
  )
}

export default function App() {
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_600SemiBold, JetBrainsMono_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  })
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  )
}
