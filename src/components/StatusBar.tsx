import { View } from 'react-native'
import { Mono } from './T'
import { C } from '@/theme'

export function StatusBar() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line4 }}>
      <Mono size={9} color={C.t11}>EA-OS</Mono>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Mono size={9} color={C.t11}>●●●●</Mono>
        <Mono size={9} color={C.t11}>14:32</Mono>
        <Mono size={9} color={C.t11}>78%</Mono>
      </View>
    </View>
  )
}
