// Shared palette + font names. Values mirror the Tailwind classes used in the web app.
export const C = {
  bg: '#080808', deep: '#050505', fg: '#f0f0f0', primary: '#ff6b00', rec: '#ff3b30',
  line: '#1a1a1a', line2: '#222', line3: '#111', line4: '#0f0f0f', line5: '#333',
  panel: '#0d0d0d', panel2: '#0f0f0f', panel3: '#0a0a0a', panel4: '#080808', input: '#111',
  t1: '#e0e0e0', t2: '#ccc', t3: '#bbb', t4: '#aaa', t5: '#999', t6: '#888', t7: '#777', t8: '#666', t9: '#555', t10: '#444', t11: '#333', t12: '#2a2a2a', t13: '#ddd',
  green400: '#4ade80', green500: '#22c55e', green900: '#14532d',
  yellow400: '#facc15', yellow500: '#eab308', yellow900: '#713f12',
  blue400: '#60a5fa', blue900: '#1e3a8a',
  red400: '#f87171', red500: '#ef4444', red800: '#991b1b', red900: '#7f1d1d',
  orange400: '#fb923c', orange900: '#7c2d12',
  purple400: '#c084fc', purple900: '#581c87',
  pink400: '#f472b6', pink900: '#831843',
  cyan400: '#22d3ee', cyan900: '#164e63',
  gray400: '#9ca3af', gray800: '#1f2937',
  amber500: '#f59e0b',
}

export const F = {
  mono: 'JetBrainsMono_400Regular',
  monoMed: 'JetBrainsMono_500Medium',
  monoSemi: 'JetBrainsMono_600SemiBold',
  monoBold: 'JetBrainsMono_700Bold',
  sans: 'Inter_400Regular',
  sansMed: 'Inter_500Medium',
  sansSemi: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
}

export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
