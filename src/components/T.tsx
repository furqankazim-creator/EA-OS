import { Text, type TextProps, type TextStyle } from 'react-native'
import { C, F } from '@/theme'

type Weight = 'regular' | 'medium' | 'semibold' | 'bold'

export type TProps = TextProps & {
  size?: number
  color?: string
  weight?: Weight
  mono?: boolean
  italic?: boolean
  underline?: boolean
  center?: boolean
  right?: boolean
  relaxed?: boolean
  style?: TextStyle | TextStyle[]
}

const family = (mono: boolean, w: Weight) =>
  mono
    ? { regular: F.mono, medium: F.monoMed, semibold: F.monoSemi, bold: F.monoBold }[w]
    : { regular: F.sans, medium: F.sansMed, semibold: F.sansSemi, bold: F.sansBold }[w]

// Text primitive: `mono` = JetBrains Mono (the web `.mono` class), otherwise Inter.
export function T({ size = 14, color = C.fg, weight = 'regular', mono = false, italic, underline, center, right, relaxed, style, ...rest }: TProps) {
  return (
    <Text
      {...rest}
      style={[
        { fontSize: size, color, fontFamily: family(mono, weight) },
        relaxed && { lineHeight: size * 1.625 },
        italic && { fontStyle: 'italic' },
        underline && { textDecorationLine: 'underline' },
        center && { textAlign: 'center' },
        right && { textAlign: 'right' },
        style,
      ]}
    />
  )
}

export function Mono(props: TProps) {
  return <T mono {...props} />
}
