import { View } from 'react-native'
import { C } from '@/theme'

export function SeverityDot({ severity }: { severity: string }) {
  const c = severity === 'high' ? C.red500 : severity === 'medium' ? C.yellow500 : C.green500
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
}
