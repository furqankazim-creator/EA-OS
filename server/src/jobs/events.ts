// Event rules: fired by /api/sync/push for every applied write from the app.
import type { Collection } from '../db.js'
import { enqueue } from './engine.js'
import { scheduleReminders } from './handlers.js'
import { parseDue } from '../logic.js'
import { patchDoc } from '../db.js'

export function onMutation(collection: Collection, doc: Record<string, unknown> & { id: string }) {
  try {
    if (collection === 'decisions' && doc.type === 'Commitment') {
      const status = String(doc.status ?? '')
      if (status === 'completed') return
      const due = doc.dueAt ? new Date(String(doc.dueAt)) : parseDue(doc.by as string | undefined)
      if (due) {
        if (!doc.dueAt) patchDoc('decisions', doc.id, { dueAt: due.toISOString() })
        scheduleReminders('decision', doc.id, String(doc.title), doc.who as string | undefined, due)
      }
    }
    if (collection === 'assignments' && doc.status !== 'done' && doc.dueAt) {
      scheduleReminders('assignment', doc.id, String(doc.task), String(doc.assignee), new Date(String(doc.dueAt)))
    }
    if (collection === 'problems' && doc.committed && doc.analysis) enqueue('plan_adopted', Date.now() + 1000, { id: doc.id }, `adopt:${doc.id}`)
    if (collection === 'problems' && doc.outcome === 'worked') enqueue('learn_playbook', Date.now() + 1000, { id: doc.id }, `playbook:${doc.id}`)
    if (collection === 'problems' || collection === 'conversations' || collection === 'decisions') enqueue('reindex_memory', Date.now() + 60_000, {}, `reindex:${Math.floor(Date.now() / 300_000)}`)
    if (collection === 'problems' && doc.severity === 'high' && !doc.analysis && doc.status === 'open') {
      enqueue('analyze_problem', Date.now(), { id: doc.id }, `analyze:${doc.id}`)
    }
    if (collection === 'conversations' && doc.extracted && (doc.status === 'extracted' || doc.status === 'committed') && !doc.recommendedAt) {
      enqueue('recommend', Date.now(), { id: doc.id }, `recommend:${doc.id}`)
    }
    if (collection === 'kpis') {
      enqueue('escalation_check', Date.now() + 2000, {}, `esc-now:${Math.floor(Date.now() / 60000)}`)
    }
  } catch (e) { console.warn('event rule failed:', (e as Error).message) }
}
