// Extraction eval harness: approved (committed) notes become the test set; run on every prompt/model change.
//   npm run eval:build   → writes eval/notes.json from committed conversations in the DB
//   npm run eval         → re-extracts each note and scores per category (count match + item overlap)
import 'dotenv/config'
import fs from 'node:fs'
import { listDocs } from '../src/db.js'
import { chat, parseJson } from '../src/llm.js'
import { SYSTEM_PROMPT } from '../src/routes/conversations.js'

type Ex = Record<string, unknown[]> & { summary?: string }
const CATS = ['instructions', 'decisions', 'commitments', 'finance', 'health', 'problems', 'staff_mentions', 'kpi_updates', 'leads']
const file = 'eval/notes.json'

if (process.argv[2] === 'build') {
  const notes = listDocs<{ id: string; transcript: string; extracted: Ex; status: string }>('conversations').filter(c => c.status === 'committed' && c.transcript && c.extracted)
    .map(c => ({ id: c.id, transcript: c.transcript, expected: c.extracted }))
  fs.writeFileSync(file, JSON.stringify(notes, null, 2))
  console.log(`wrote ${notes.length} approved notes → ${file}`)
  process.exit(0)
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2)
const overlap = (a: unknown, b: unknown) => { const A = new Set(norm(JSON.stringify(a))), B = new Set(norm(JSON.stringify(b))); let i = 0; A.forEach(w => { if (B.has(w)) i++ }); return A.size && B.size ? (2 * i) / (A.size + B.size) : 0 }

const notes = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string; transcript: string; expected: Ex }[]
if (!notes.length) { console.log('no notes — run eval:build after committing a few notes'); process.exit(1) }
const totals: Record<string, { countOk: number; itemScore: number; n: number }> = Object.fromEntries(CATS.map(c => [c, { countOk: 0, itemScore: 0, n: 0 }]))
const t0 = Date.now()
for (const n of notes) {
  const got = parseJson(await chat({ system: SYSTEM_PROMPT, user: `Transcript:\n${n.transcript}`, json: true, kind: 'eval' })) as Ex
  for (const c of CATS) {
    const e = (n.expected[c] ?? []) as unknown[], g = (got[c] ?? []) as unknown[]
    totals[c].n++
    if (e.length === g.length) totals[c].countOk++
    const best = e.length ? e.reduce((a, item) => a + Math.max(0, ...g.map(x => overlap(item, x))), 0) / e.length : g.length ? 0 : 1
    totals[c].itemScore += best
  }
  process.stdout.write('.')
}
console.log(`\n${notes.length} notes · ${Math.round((Date.now() - t0) / 1000)}s\n`)
console.log('category          count-match   item-similarity')
for (const c of CATS) { const t = totals[c]; console.log(`${c.padEnd(18)}${String(Math.round(100 * t.countOk / t.n)).padStart(5)}%      ${String(Math.round(100 * t.itemScore / t.n)).padStart(5)}%`) }
const all = CATS.reduce((a, c) => a + totals[c].itemScore / totals[c].n, 0) / CATS.length
console.log(`\noverall item-similarity: ${Math.round(all * 100)}%`)
