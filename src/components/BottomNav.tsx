import { View, Pressable } from 'react-native'
import { T, Mono } from './T'
import { TABS, type Tab } from '@/tabs/types'
import { C, alpha } from '@/theme'

export function BottomNav({ tab, onChange, badges = {} }: { tab: Tab; onChange: (t: Tab) => void; badges?: Partial<Record<Tab, number>> }) {
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg }}>
      {TABS.map(t => {
        const active = tab === t.id
        const n = badges[t.id] ?? 0
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 12, gap: 4, borderTopWidth: 1, borderTopColor: active ? C.primary : 'transparent' }}>
            <View>
              <T size={14} color={active ? C.primary : alpha(C.primary, 0.5)}>{t.icon}</T>
              {n > 0 && (
                <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                  <Mono size={8} weight="bold" color="#fff">{n > 9 ? '9+' : n}</Mono>
                </View>
              )}
            </View>
            <Mono size={7} color={active ? C.primary : alpha(C.primary, 0.4)}>{t.label}</Mono>
          </Pressable>
        )
      })}
    </View>
  )
}
