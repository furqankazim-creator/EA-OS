import { useEffect, useRef } from 'react'
import { View, Animated, Easing, Platform } from 'react-native'
import { C } from '@/theme'

function Ring({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
    ]))
    loop.start(); return () => loop.stop()
  }, [delay, v])
  return (
    <Animated.View style={{ pointerEvents: 'none', position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: C.primary,
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.6] }) }],
      opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] }) }} />
  )
}

// Radar pulse shown while the board is deliberating.
export function Radar() {
  return (
    <View style={{ width: 110, height: 110, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 600, 1200].map(d => <Ring key={d} delay={d} />)}
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary }} />
    </View>
  )
}
