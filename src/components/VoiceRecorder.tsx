import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Pressable, TextInput, Animated, Easing, Platform } from 'react-native'
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import { File } from 'expo-file-system'
import { T, Mono } from './T'
import { Chip, row } from './ui'
import { loadSpeech } from '@/services/speech'
import { extractConversation } from '@/services/api'
import { useStore, uid, countItems } from '@/store'
import { QUICK_SAMPLES } from '@/data'
import { C, F, alpha } from '@/theme'
import type { Conversation } from '@/types'

type Phase = 'idle' | 'recording' | 'processing' | 'saved' | 'failed'

// Read the recording as base64 on every platform. Native: file:// via expo-file-system.
// Web: expo-audio hands back a blob: URL, so fetch it and use FileReader.
async function readAudioBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('http')) {
    const blob = await (await fetch(uri)).blob()
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onloadend = () => resolve(String(r.result).split(',')[1] ?? '')
      r.onerror = () => reject(new Error('Could not read recording'))
      r.readAsDataURL(blob)
    })
  }
  return await new File(uri).base64()
}
const BARS = 24

function Spinner() {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }))
    loop.start(); return () => loop.stop()
  }, [v])
  return (
    <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ width: 80, height: 80, borderRadius: 40, borderTopWidth: 2, borderTopColor: C.primary, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: 'transparent',
        transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} />
    </View>
  )
}

function PulseRing() {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: Platform.OS !== 'web' }))
    loop.start(); return () => loop.stop()
  }, [v])
  return (
    <Animated.View style={{ pointerEvents: 'none', position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: C.rec,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }] }} />
  )
}

// Live waveform: a ring buffer of the last 24 input levels (0..1), newest on the right.
function Waveform({ levels }: { levels: number[] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 32 }}>
      {levels.map((l, i) => (
        <View key={i} style={{ width: 3, height: 6 + Math.round(l * 22), backgroundColor: i === levels.length - 1 ? C.rec : C.primary, borderRadius: 2 }} />
      ))}
    </View>
  )
}

export function VoiceRecorder({ onSaved }: { onSaved: (conversationId: string) => void }) {
  const { state, dispatch } = useStore()
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0))
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<{ id: string; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<'speech' | 'audio' | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const subsRef = useRef<{ remove: () => void }[]>([])
  const audioUriRef = useRef<string | null>(null)
  const audioEndResolve = useRef<((uri: string | null) => void) | null>(null)
  const startedAt = useRef(0)
  const finalRef = useRef('')

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })

  const silenceSince = useRef<number | null>(null)
  const autoStopRef = useRef(false)
  const stopRef = useRef<() => void>(() => {})
  const pushLevel = useCallback((l: number) => {
    const v = Math.max(0, Math.min(1, l))
    setLevels(prev => [...prev.slice(1), v])
    // Voice-activity detection: in quick-note mode, stop after 4 s of silence once something was said.
    if (autoStopRef.current) {
      if (v > 0.18) silenceSince.current = Date.now()
      else if (silenceSince.current && Date.now() - silenceSince.current > 4000) { silenceSince.current = null; stopRef.current() }
    }
  }, [])

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (meterRef.current) clearInterval(meterRef.current)
    timerRef.current = meterRef.current = null
    subsRef.current.forEach(s => s.remove()); subsRef.current = []
  }, [])
  useEffect(() => cleanup, [cleanup])

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const liveText = (finalText + ' ' + interim).trim()

  // ─── Start ───
  const startRecording = async () => {
    setError(null); setResult(null); setFinalText(''); setInterim(''); finalRef.current = ''
    setLevels(Array(BARS).fill(0)); setSeconds(0); audioUriRef.current = null

    const speech = loadSpeech()
    try {
      if (speech) {
        let perm = { granted: true }
        if (Platform.OS !== 'web') {
          perm = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync()
        }
        if (!perm.granted) throw new Error('Microphone / speech permission denied')
        const M = speech.ExpoSpeechRecognitionModule
        subsRef.current = [
          M.addListener('result', e => {
            const text = e.results[0]?.transcript ?? ''
            if (e.isFinal) { finalRef.current = (finalRef.current + ' ' + text).trim(); setFinalText(finalRef.current); setInterim('') }
            else setInterim(text)
          }),
          M.addListener('volumechange', e => pushLevel((e.value + 2) / 12)),
          M.addListener('audioend', e => { audioUriRef.current = e.uri; audioEndResolve.current?.(e.uri) }),
          M.addListener('error', e => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Speech: ${e.message}`) }),
        ]
        M.start({
          lang: state.lang, interimResults: true, continuous: true, addsPunctuation: true,
          recordingOptions: { persist: true, outputFileName: `ea-os-${Date.now()}.wav` },
          volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
        })
        setEngine('speech')
      } else {
        let perm = { granted: true }
        if (Platform.OS !== 'web') {
          perm = await requestRecordingPermissionsAsync()
        }
        if (!perm.granted) throw new Error('Microphone permission denied')
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        recorder.record()
        meterRef.current = setInterval(() => {
          const db = recorder.getStatus().metering ?? -160     // dBFS, roughly -160..0
          pushLevel((db + 60) / 60)
        }, 80)
        setEngine('audio')
      }
    } catch (e) {
      setError((e as Error).message); setPhase('failed'); cleanup(); return
    }
    startedAt.current = Date.now(); silenceSince.current = null; autoStopRef.current = state.autoStop
    setPhase('recording')
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }

  // ─── Stop → upload → extract ───
  const stopRecording = async () => {
    const durationSec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
    if (timerRef.current) clearInterval(timerRef.current)
    if (meterRef.current) clearInterval(meterRef.current)
    setPhase('processing')

    let uri: string | null = null
    let mimeType = 'audio/mp4'
    try {
      if (engine === 'speech') {
        const speech = loadSpeech()!
        const waitEnd = new Promise<string | null>(res => { audioEndResolve.current = res; setTimeout(() => res(audioUriRef.current), 4000) })
        speech.ExpoSpeechRecognitionModule.stop()
        uri = await waitEnd
        mimeType = 'audio/wav'
      } else {
        await recorder.stop()
        uri = recorder.uri
      }
    } catch (e) {
      setError((e as Error).message)
    }
    subsRef.current.forEach(s => s.remove()); subsRef.current = []

    const transcriptHint = (finalRef.current + ' ' + interim).trim()
    if (!uri && !transcriptHint) {
      setError(durationSec < 2 ? 'Recording too short — hold for at least 2 seconds.' : 'No audio was captured. Check the microphone permission for this app/browser and try again.')
      setPhase('failed')
      return
    }
    await runExtraction({ durationSec, source: 'voice', transcript: transcriptHint, audio: uri ? { uri, mimeType } : null })
  }

  stopRef.current = () => { if (phase === 'recording') void stopRecording() }

  const runExtraction = async (opts: { durationSec: number; source: Conversation['source']; transcript: string; audio: { uri: string; mimeType: string } | null }) => {
    const id = uid()
    const convo: Conversation = {
      id, createdAt: new Date().toISOString(), durationSec: opts.durationSec, transcript: opts.transcript,
      lang: state.lang, source: opts.source, extracted: null, status: 'processing',
    }
    dispatch({ type: 'put', collection: 'conversations', doc: convo })
    setPhase('processing')
    try {
      let audio: { data: string; mimeType: string } | undefined
      if (opts.audio) {
        const data = await readAudioBase64(opts.audio.uri)
        if (data.length > 100) audio = { data, mimeType: Platform.OS === 'web' ? 'audio/webm' : opts.audio.mimeType }
      }
      if (!audio && !opts.transcript) throw new Error('Nothing was captured — no audio and no transcript')
      const { transcript, extraction, followUps } = await extractConversation({ transcript: opts.transcript || undefined, audio, lang: state.lang })
      dispatch({ type: 'put', collection: 'conversations', doc: { ...convo, transcript: transcript || opts.transcript, extracted: extraction, followUps, status: 'extracted' } })
      const n = countItems(extraction)
      const parts = (['instructions', 'decisions', 'commitments', 'finance', 'problems', 'health', 'kpi_updates'] as const)
        .filter(k => extraction[k].length).map(k => `${k.replace('_updates', '').replace(/^\w/, c => c.toUpperCase())} (${extraction[k].length})`)
      setResult({ id, label: (parts.length ? parts.join(' · ') : `${n} items`) + (followUps.length ? ` · ${followUps.length} follow-up${followUps.length > 1 ? 's' : ''}` : '') })
      setPhase('saved')
    } catch (e) {
      const msg = (e as Error).message
      dispatch({ type: 'put', collection: 'conversations', doc: { ...convo, status: 'failed', error: msg } })
      setError(msg); setPhase('failed')
    }
  }

  const submitText = (text: string, source: Conversation['source']) => {
    const t = text.trim(); if (!t) return
    setTyped(''); setError(null); setResult(null)
    runExtraction({ durationSec: Math.max(1, Math.round(t.split(/\s+/).length / 2.5)), source, transcript: t, audio: null })
  }

  const busy = phase === 'processing'
  const recording = phase === 'recording'

  return (
    <View style={{ flex: 1 }}>
      {/* Mode + language */}
      <View style={[row, { justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 }]}>
        <View style={[row, { gap: 4 }]}>
          {(['voice', 'text'] as const).map(m => (
            <Chip key={m} size={9} label={m === 'voice' ? '🎙 VOICE' : '⌨ TEXT'} active={mode === m} bg={alpha(C.primary, 0.05)} onPress={() => !recording && !busy && setMode(m)} />
          ))}
        </View>
        <View style={[row, { gap: 4 }]}>
          <Chip size={9} label={state.autoStop ? '◉ AUTO-STOP' : '○ AUTO-STOP'} active={state.autoStop} color={C.green400} onPress={() => !recording && dispatch({ type: 'autoStop/set', value: !state.autoStop })} />
          {[{ id: 'en-US', l: 'EN' }, { id: 'ur-PK', l: 'UR' }].map(o => (
            <Chip key={o.id} size={9} label={o.l} active={state.lang === o.id} bg={alpha(C.primary, 0.05)} onPress={() => !recording && dispatch({ type: 'lang/set', lang: o.id })} />
          ))}
        </View>
      </View>

      {mode === 'voice' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 16 }}>
          {recording && <Waveform levels={levels} />}
          {(recording || busy) && (
            <Mono size={30} weight="bold" color={recording ? C.rec : C.primary} style={{ letterSpacing: 3 }}>
              {recording ? fmt(seconds) : 'PROCESSING...'}
            </Mono>
          )}
          {/* Live transcript (interim shown dimmer) */}
          {recording && (
            <View style={{ paddingHorizontal: 24, minHeight: 36, maxWidth: '100%' }}>
              {liveText ? (
                <T size={13} color={C.t2} center relaxed numberOfLines={3}>
                  {finalText}{finalText ? ' ' : ''}<T size={13} color={C.t9}>{interim}</T>
                </T>
              ) : (
                <Mono size={9} color={C.t10} center>{engine === 'speech' ? 'LISTENING…' : 'RECORDING — TRANSCRIBED ON STOP'}</Mono>
              )}
            </View>
          )}
          {phase === 'saved' && result && (
            <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
              <Mono size={12} weight="semibold" color={C.green400}>✓ SAVED & EXTRACTED</Mono>
              <T size={12} color={C.t9} center style={{ marginTop: 4 }}>{result.label}</T>
              <Pressable onPress={() => onSaved(result.id)} style={{ marginTop: 8 }}>
                <Mono size={10} color={C.primary} underline>VIEW EXTRACTION →</Mono>
              </Pressable>
            </View>
          )}
          {phase === 'failed' && error && (
            <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
              <Mono size={10} weight="semibold" color={C.red400}>✕ EXTRACTION FAILED</Mono>
              <T size={11} color={C.t8} center style={{ marginTop: 4 }} numberOfLines={3}>{error}</T>
              {!/captured|too short/i.test(error) && <Mono size={9} color={C.t10} center style={{ marginTop: 4 }}>Log kept in LOGS — use RE-PROCESS once the server is reachable</Mono>}
            </View>
          )}
          {!busy && (
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              {recording && <PulseRing />}
              <Pressable onPress={recording ? stopRecording : startRecording}
                style={{ width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? C.rec : C.primary,
                  boxShadow: recording ? '0 0 40px rgba(255,59,48,0.4)' : '0 0 20px rgba(255,107,0,0.3)' }}>
                {recording ? <View style={{ width: 32, height: 32, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)' }} />
                  : <Mono size={11} weight="bold" color="#000">REC</Mono>}
              </Pressable>
            </View>
          )}
          {busy && <Spinner />}
          <Mono size={10} color={C.t10}>
            {recording ? 'TAP TO STOP' : busy ? (engine === 'speech' ? 'EXTRACTING WITH GEMINI...' : 'TRANSCRIBING & EXTRACTING...') : phase === 'saved' ? 'TAP TO RECORD NEW' : 'TAP TO START RECORDING'}
          </Mono>
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 10 }}>
          <TextInput value={typed} onChangeText={setTyped} multiline editable={!busy}
            placeholder="Type or paste a voice note… (English, Urdu, or Roman Urdu)" placeholderTextColor={C.t10}
            style={{ minHeight: 110, textAlignVertical: 'top', backgroundColor: C.input, borderWidth: 1, borderColor: C.line2, color: C.t2, fontFamily: F.sans, fontSize: 14, padding: 12, lineHeight: 20 }} />
          <View style={[row, { gap: 8 }]}>
            <Pressable onPress={() => submitText(typed, 'text')} disabled={busy || !typed.trim()}
              style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: busy || !typed.trim() ? C.line : C.primary }}>
              <Mono size={10} color={busy || !typed.trim() ? C.t9 : '#000'}>{busy ? '⟳ EXTRACTING...' : '▶ EXTRACT'}</Mono>
            </Pressable>
            {busy && <Spinner />}
          </View>
          {phase === 'saved' && result && (
            <View>
              <Mono size={10} weight="semibold" color={C.green400}>✓ SAVED & EXTRACTED — {result.label}</Mono>
              <Pressable onPress={() => onSaved(result.id)} style={{ marginTop: 4 }}><Mono size={10} color={C.primary} underline>VIEW EXTRACTION →</Mono></Pressable>
            </View>
          )}
          {phase === 'failed' && error && <T size={11} color={C.red400} numberOfLines={3}>✕ {error}</T>}
          <Mono size={9} color={C.t10} style={{ marginTop: 6 }}>QUICK SAMPLES — FOR RESTRICTED MIC ENVIRONMENTS</Mono>
          {QUICK_SAMPLES.map(s => (
            <Pressable key={s.title} onPress={() => !busy && submitText(s.transcript, 'sample')}
              style={{ borderWidth: 1, borderColor: C.line2, paddingHorizontal: 12, paddingVertical: 10 }}>
              <T size={13} color={C.t2}>{s.title}</T>
              <T size={11} color={C.t8} numberOfLines={1} style={{ marginTop: 2 }}>{s.transcript}</T>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}
