import { useState } from 'react'
import { View, TextInput, Pressable, ScrollView } from 'react-native'
import { T, Mono } from './T'
import { Chip, row } from './ui'
import { C, F, alpha } from '@/theme'

// Generic inline editor for one extracted item: every string/number field becomes an input.
export function ItemEditor({ title, item, onSave, onCancel }: { title: string; item: Record<string, unknown>; onSave: (next: Record<string, unknown>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(Object.fromEntries(Object.entries(item).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || v === null).map(([k, v]) => [k, v == null ? '' : String(v)])))
  const save = () => {
    const next: Record<string, unknown> = { ...item }
    for (const [k, v] of Object.entries(draft)) {
      const orig = item[k]
      next[k] = typeof orig === 'number' ? Number(v.replace(/[^0-9.-]/g, '')) || 0 : orig === null && v === '' ? null : v
    }
    onSave(next)
  }
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, backgroundColor: alpha(C.deep, 0.97) }}>
      <View style={[row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }]}>
        <Mono size={11} weight="bold" color={C.primary}>EDIT {title.toUpperCase()}</Mono>
        <Pressable onPress={onCancel} hitSlop={12}><Mono size={20} color={C.t9}>✕</Mono></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        {Object.entries(draft).map(([k, v]) => (
          <View key={k}>
            <Mono size={9} color={C.t10} style={{ marginBottom: 4 }}>{k.replace(/_/g, ' ').toUpperCase()}</Mono>
            <TextInput value={v} onChangeText={t => setDraft(d => ({ ...d, [k]: t }))} multiline={v.length > 40 || k.includes('quote') || k.includes('description') || k.includes('notes')}
              keyboardType={typeof item[k] === 'number' ? 'numeric' : 'default'}
              style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t1, fontFamily: F.sans, fontSize: 14, padding: 10 }} />
          </View>
        ))}
        <View style={[row, { gap: 8, marginTop: 8 }]}>
          <Pressable onPress={save} style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.primary }}><Mono size={10} weight="bold" color="#000">SAVE</Mono></Pressable>
          <Chip label="CANCEL" px={12} py={10} onPress={onCancel} />
        </View>
        <T size={11} color={C.t9}>Edits are saved to this log before commit, so what you commit is what you approved.</T>
      </ScrollView>
    </View>
  )
}
