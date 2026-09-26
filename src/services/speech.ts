import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

// expo-speech-recognition is a native module: it works in a development build (`npx expo run:android|ios`)
// but not in Expo Go. Probe for the native side first (returns null instead of throwing), and only then
// load the JS package. When it's missing, the transcript comes back from the server (Gemini transcribes
// the uploaded audio) after the recording stops.
type SR = typeof import('expo-speech-recognition')
let mod: SR | null | undefined

export function loadSpeech(): SR | null {
  if (mod !== undefined) return mod
  try {
    const hasNative = Platform.OS === 'web' || requireOptionalNativeModule('ExpoSpeechRecognition') != null
    if (!hasNative) { mod = null; return mod }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('expo-speech-recognition') as SR
    mod = Platform.OS === 'web' || m.ExpoSpeechRecognitionModule.isRecognitionAvailable() ? m : null
  } catch {
    mod = null
  }
  return mod
}

export const speechAvailable = () => loadSpeech() !== null
