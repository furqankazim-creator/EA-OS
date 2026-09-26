import { View } from 'react-native'
import { Mono } from './T'
import { C } from '@/theme'

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; border: string }> = {
    active: { text: C.green400, border: C.green900 },
    pending: { text: C.yellow400, border: C.yellow900 },
    in_progress: { text: C.blue400, border: C.blue900 },
    overdue: { text: C.red400, border: C.red900 },
    on_leave: { text: C.gray400, border: C.gray800 },
    completed: { text: C.green400, border: C.green900 },
    solutions_ready: { text: C.green400, border: C.green900 },
    analyzing: { text: C.yellow400, border: C.yellow900 },
    open: { text: C.orange400, border: C.orange900 },
    draft: { text: C.yellow400, border: C.yellow900 },
    sent: { text: C.green400, border: C.green900 },
    failed: { text: C.red400, border: C.red900 },
    good: { text: C.green400, border: C.green900 },
    medium: { text: C.yellow400, border: C.yellow900 },
    low: { text: C.blue400, border: C.blue900 },
  }
  const label: Record<string, string> = {
    active: 'ACTIVE', pending: 'PENDING', in_progress: 'IN PROGRESS',
    overdue: 'OVERDUE', on_leave: 'ON LEAVE', completed: 'DONE',
    solutions_ready: 'READY', analyzing: 'ANALYZING', open: 'OPEN',
    draft: 'DRAFT', sent: 'SENT', failed: 'FAILED',
    good: 'GOOD', medium: 'MEDIUM', low: 'LOW',
  }
  const c = map[status] ?? { text: C.gray400, border: C.gray800 }
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Mono size={10} weight="semibold" color={c.text}>{label[status] ?? status.toUpperCase()}</Mono>
    </View>
  )
}
