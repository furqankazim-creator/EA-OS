// Long-term memory: embeddings over transcripts, decisions, problems (+ outcomes) and playbooks.
// Provider order: OpenAI (if OPENAI_API_KEY) → local MiniLM via transformers.js (downloads ~25MB once)
// → hashed bag-of-words (offline fallback, weaker but never fails).
import { db, listDocs } from './db.js'

db.exec('CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, collection TEXT, doc_id TEXT, text TEXT, vec BLOB, provider TEXT, updated_at INTEGER)')
const q = {
  get: db.prepare('SELECT updated_at, provider FROM vectors WHERE key = ?'),
  put: db.prepare('INSERT OR REPLACE INTO vectors (key, collection, doc_id, text, vec, provider, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  all: db.prepare('SELECT key, collection, doc_id, text, vec FROM vectors WHERE provider = ?'),
  count: db.prepare('SELECT COUNT(*) n FROM vectors'),
}

type Embedder = { name: string; embed: (texts: string[]) => Promise<number[][]> }
let embedder: Embedder | null = null

async function getEmbedder(): Promise<Embedder> {
  if (embedder) return embedder
  if (process.env.OPENAI_API_KEY) {
    embedder = { name: 'openai', embed: async texts => {
      const r = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }) })
      if (!r.ok) throw new Error(`openai ${r.status}`)
      return ((await r.json()) as { data: { embedding: number[] }[] }).data.map(d => d.embedding)
    } }
    return embedder
  }
  try {
    const { pipeline } = await import('@huggingface/transformers')
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' } as never)
    embedder = { name: 'minilm', embed: async texts => {
      const out: number[][] = []
      for (const t of texts) { const r = await pipe(t, { pooling: 'mean', normalize: true } as never) as { data: Float32Array }; out.push(Array.from(r.data)) }
      return out
    } }
    console.log('memory: local MiniLM embeddings ready')
  } catch (e) {
    console.warn('memory: local embeddings unavailable, using hashed fallback:', (e as Error).message.slice(0, 80))
    embedder = { name: 'hash', embed: async texts => texts.map(hashVec) }
  }
  return embedder
}

function hashVec(text: string, dim = 512): number[] {
  const v = new Array(dim).fill(0)
  for (const w of text.toLowerCase().replace(/[^a-z0-9؀-ۿ ]/g, ' ').split(/\s+/).filter(x => x.length > 2)) {
    let h = 2166136261; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619) }
    v[Math.abs(h) % dim] += 1
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map(x => x / n)
}
const cos = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]; return s }
const toBlob = (v: number[]) => Buffer.from(new Float32Array(v).buffer)
const fromBlob = (b: Buffer) => Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4))

// What gets indexed: one text per document, with outcome/status baked in so retrieval carries the lesson.
function corpus(): { key: string; collection: string; id: string; text: string; updated: number }[] {
  const out: { key: string; collection: string; id: string; text: string; updated: number }[] = []
  for (const c of listDocs<{ id: string; createdAt: string; transcript: string; extracted?: { summary?: string }; _u?: number }>('conversations'))
    if (c.transcript) out.push({ key: `conversations:${c.id}`, collection: 'conversations', id: c.id, text: `[${c.createdAt.slice(0, 10)}] ${c.extracted?.summary ?? ''}\n${c.transcript.slice(0, 1500)}`, updated: c._u ?? 0 })
  for (const p of listDocs<{ id: string; title: string; description: string; status: string; outcome?: string; analysis?: { root_cause?: string; consensus_summary?: string }; date: string; _u?: number }>('problems'))
    out.push({ key: `problems:${p.id}`, collection: 'problems', id: p.id, text: `[problem ${p.date}] ${p.title}. ${p.description}. Root cause: ${p.analysis?.root_cause ?? '?'}. Plan: ${p.analysis?.consensus_summary?.slice(0, 400) ?? '?'}. Outcome: ${p.outcome ?? p.status}`, updated: p._u ?? 0 })
  for (const d of listDocs<{ id: string; type: string; title: string; description?: string; status: string; date: string; _u?: number }>('decisions'))
    if (d.type === 'Decision') out.push({ key: `decisions:${d.id}`, collection: 'decisions', id: d.id, text: `[decision ${d.date}] ${d.title}. ${d.description ?? ''} (${d.status})`, updated: d._u ?? 0 })
  for (const pb of listDocs<{ id: string; title: string; trigger: string; steps: { step: string }[]; _u?: number }>('playbooks'))
    out.push({ key: `playbooks:${pb.id}`, collection: 'playbooks', id: pb.id, text: `[playbook] ${pb.title}. When: ${pb.trigger}. Steps: ${(pb.steps ?? []).map(s => s.step).join('; ')}`, updated: pb._u ?? 0 })
  return out
}

export async function reindex(): Promise<{ indexed: number; total: number; provider: string }> {
  const e = await getEmbedder()
  const docs = corpus()
  const todo = docs.filter(d => { const r = q.get.get(d.key) as { updated_at: number; provider: string } | undefined; return !r || r.provider !== e.name || r.updated_at < d.updated })
  for (let i = 0; i < todo.length; i += 16) {
    const batch = todo.slice(i, i + 16)
    const vecs = await e.embed(batch.map(b => b.text))
    batch.forEach((b, j) => q.put.run(b.key, b.collection, b.id, b.text, toBlob(vecs[j]), e.name, Math.max(b.updated, Date.now())))
  }
  return { indexed: todo.length, total: (q.count.get() as { n: number }).n, provider: e.name }
}

export interface MemoryHit { collection: string; id: string; text: string; score: number }
export async function recall(query: string, k = 5, exclude?: string): Promise<MemoryHit[]> {
  const e = await getEmbedder()
  const [qv] = await e.embed([query])
  const rows = q.all.all(e.name) as { key: string; collection: string; doc_id: string; text: string; vec: Buffer }[]
  return rows.filter(r => r.key !== exclude).map(r => ({ collection: r.collection, id: r.doc_id, text: r.text, score: cos(qv, fromBlob(r.vec)) }))
    .sort((a, b) => b.score - a.score).slice(0, k).filter(h => h.score > (e.name === 'hash' ? 0.15 : 0.35))
}
export const memoryContext = async (query: string, exclude?: string) => {
  try {
    const hits = await recall(query, 4, exclude)
    return hits.length ? `Relevant history ("this happened before"):\n${hits.map(h => `- (${h.collection}, ${Math.round(h.score * 100)}%) ${h.text.slice(0, 350).replace(/\n/g, ' ')}`).join('\n')}` : ''
  } catch { return '' }
}
