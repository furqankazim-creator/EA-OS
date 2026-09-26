import { View, Pressable, type ViewStyle, type PressableProps } from 'react-native'
import { Mono } from './T'
import { C } from '@/theme'

// Bordered mono-text chip/button (the recurring `mono text-[10px] px-2 py-1 border` pattern).
export function Chip({ label, active, color = C.primary, size = 10, px = 8, py = 4, bg, onPress, style, disabled }: {
  label: string; active?: boolean; color?: string; size?: number; px?: number; py?: number; bg?: string
  onPress?: PressableProps['onPress']; style?: ViewStyle; disabled?: boolean
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[{ borderWidth: 1, borderColor: active ? color : C.line2, paddingHorizontal: px, paddingVertical: py, backgroundColor: active ? bg : undefined }, style]}>
      <Mono size={size} color={active ? color : C.t9}>{label}</Mono>
    </Pressable>
  )
}

// Dashed "+ ADD ..." button at the bottom of lists.
export function DashedButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress}
      style={{ marginHorizontal: 20, marginTop: 16, marginBottom: 16, paddingVertical: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line2, alignItems: 'center' }}>
      <Mono size={10} color={C.t10}>{label}</Mono>
    </Pressable>
  )
}

// Section header row: `px-5 pt-5 pb-3 border-b border-[#1a1a1a]`
export function Header({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }, style]}>{children}</View>
}

// Thin label strip: `px-5 py-2 bg-[#0d0d0d] border-b border-[#1a1a1a]`
export function Strip({ children, row }: { children: React.ReactNode; row?: boolean }) {
  return (
    <View style={[{ paddingHorizontal: 20, paddingVertical: 8, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line }, row && { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      {children}
    </View>
  )
}

export function Bar({ pct, color, height = 2, rounded }: { pct: number; color: string; height?: number; rounded?: boolean }) {
  return (
    <View style={{ height, backgroundColor: C.line, borderRadius: rounded ? 999 : 0 }}>
      <View style={{ height, width: `${pct}%`, backgroundColor: color, borderRadius: rounded ? 999 : 0 }} />
    </View>
  )
}

export const row: ViewStyle = { flexDirection: 'row', alignItems: 'center' }
export const between: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }
