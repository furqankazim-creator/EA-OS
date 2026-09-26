// Expo push registration. Works in a development/production build; Expo Go (Android) no longer
// delivers remote pushes, so the in-app inbox (synced `notifications` collection) is the fallback.
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { registerPushToken } from './api'

// Expo Go can't receive remote pushes (SDK 53+ on Android) and logs a loud error if you try.
export const isExpoGo = Constants.executionEnvironment === 'storeClient'
export const remotePushSupported = !isExpoGo && Platform.OS !== 'web'

let handlerSet = false
async function setup() {
  const Notifications = await import('expo-notifications')
  if (!handlerSet) {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })
    handlerSet = true
  }
  const { status: existing } = await Notifications.getPermissionsAsync()
  let status = existing
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status === 'granted' && Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
    await Notifications.setNotificationChannelAsync('default', { name: 'EA-OS', importance: Notifications.AndroidImportance.HIGH })
  }
  return { Notifications, granted: status === 'granted' }
}

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null
  try {
    const Device = await import('expo-device')
    if (!Device.isDevice) return null
    const { Notifications, granted } = await setup()
    if (!granted) return null
    if (!remotePushSupported) { console.log('push: Expo Go — local notifications only; build a dev client for remote push'); return null }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
    await registerPushToken(token, Platform.OS)
    return token
  } catch (e) {
    console.log('push registration skipped:', (e as Error).message)
    return null
  }
}

export async function onNotificationTap(handler: (link?: { tab: string; id?: string }) => void) {
  try {
    const Notifications = await import('expo-notifications')
    const sub = Notifications.addNotificationResponseReceivedListener(r => handler(r.notification.request.content.data?.link as { tab: string; id?: string } | undefined))
    return () => sub.remove()
  } catch { return () => {} }
}

export async function fireLocalNotification(n: { id: string; title: string; body: string; link?: { tab: string; id?: string } }) {
  if (Platform.OS === 'web') return
  try {
    const { Notifications, granted } = await setup()
    if (!granted) return
    await Notifications.scheduleNotificationAsync({
      content: {
        title: n.title,
        body: n.body,
        data: { id: n.id, link: n.link },
        sound: true,
      },
      trigger: null, // fire immediately
    })
  } catch (e) {
    console.warn('local push failed:', e)
  }
}
