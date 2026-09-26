// In-app notification inbox (synced to the phone) + Expo push delivery.
import { db, putDoc, uid, getSettings } from './db.js'

export interface Notification {
  id: string; ts: string; kind: string; title: string; body: string; read: boolean
  link?: { tab: string; id?: string }
}

const q = {
  tokens: db.prepare('SELECT token FROM push_tokens'),
  upsertToken: db.prepare('INSERT INTO push_tokens (token, platform, updated_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET updated_at = excluded.updated_at, platform = excluded.platform'),
  delToken: db.prepare('DELETE FROM push_tokens WHERE token = ?'),
}

export const registerPushToken = (token: string, platform: string) => q.upsertToken.run(token, platform, Date.now())

export async function notify(n: Omit<Notification, 'id' | 'ts' | 'read'>): Promise<Notification> {
  const doc: Notification = { id: uid(), ts: new Date().toISOString(), read: false, ...n }
  putDoc('notifications', doc.id, doc as unknown as Record<string, unknown>)
  const prefs = getSettings().notifications
  const gated = (n.kind === 'morning_brief' && !prefs.morningBrief) || (n.kind === 'eod_recap' && !prefs.eodRecap)
    || (n.kind === 'reminder' && !prefs.reminders) || (n.kind === 'overdue' && !prefs.overdue)
  if (!gated) void sendPush(doc)
  return doc
}

async function sendPush(n: Notification) {
  const tokens = (q.tokens.all() as { token: string }[]).map(t => t.token)
  if (!tokens.length) return
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map(to => ({ to, title: n.title, body: n.body.slice(0, 180), data: { id: n.id, link: n.link }, sound: 'default' }))),
    })
    const json = await res.json().catch(() => null) as { data?: { status: string; details?: { error?: string } }[] } | null
    json?.data?.forEach((r, i) => { if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') q.delToken.run(tokens[i]) })
  } catch (e) { console.warn('push failed:', (e as Error).message) }
}
