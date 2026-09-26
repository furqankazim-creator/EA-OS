import { Router } from 'express'
import { COLLECTIONS, changesSince, putDoc, listDocs, type Collection, getSettings, auditList } from '../db.js'
import { registerPushToken } from '../notify.js'
import { onMutation } from '../jobs/events.js'

export const sync = Router()

interface Mutation { collection: Collection; id: string; data: Record<string, unknown> | null; updated_at: number }

// Push local mutations (last-write-wins). Fires event rules for applied writes.
sync.post('/push', (req, res) => {
  const { mutations } = req.body as { mutations: Mutation[] }
  if (!Array.isArray(mutations)) return res.status(400).json({ error: 'mutations[] required' })
  const applied: { collection: string; id: string }[] = []
  for (const m of mutations) {
    if (!COLLECTIONS.includes(m.collection) || !m.id) continue
    if (putDoc(m.collection, m.id, m.data, m.updated_at ?? Date.now(), 'app')) {
      applied.push({ collection: m.collection, id: m.id })
      if (m.data) onMutation(m.collection, m.data as Record<string, unknown> & { id: string })
    }
  }
  res.json({ applied, serverTime: Date.now() })
})

// Pull everything changed since `since` (ms). Includes deletions.
sync.get('/pull', (req, res) => {
  const since = Number(req.query.since ?? 0)
  const docs = changesSince(since)
  res.json({ docs, serverTime: Date.now(), more: docs.length >= 2000 })
})

sync.get('/snapshot', (_req, res) => {
  const out: Record<string, unknown[]> = {}
  for (const c of COLLECTIONS) out[c] = listDocs(c)
  res.json({ ...out, settings: getSettings(), serverTime: Date.now() })
})

sync.post('/push-token', (req, res) => {
  const { token, platform } = req.body as { token?: string; platform?: string }
  if (!token) return res.status(400).json({ error: 'token required' })
  registerPushToken(token, platform ?? 'unknown')
  res.json({ ok: true })
})

sync.get('/audit', (req, res) => res.json(auditList(Number(req.query.limit ?? 100))))
