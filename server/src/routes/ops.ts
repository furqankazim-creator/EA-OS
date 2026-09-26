// Emails (approve-then-send), invoices, automation control, settings.
import { Router } from 'express'
import express from 'express'
import { listDocs, getDoc, putDoc, patchDoc, uid, getSettings, DEFAULT_SETTINGS } from '../db.js'
import { sendEmail, smtpConfigured, draftWithLLM, type Email } from '../emails.js'
import { listJobs, enqueue, type JobKind } from '../jobs/engine.js'
import { escalation, burnAndRunway, kpiHistory, fmtDate, snapshot, clientProfile, type Invoice, type Decision, type Assignment } from '../logic.js'
import { notify } from '../notify.js'
import { standardScenarios } from '../simulate.js'
import { usageSummary } from '../llm.js'
import { reindex, recall } from '../memory.js'
import { metrics } from '../metrics.js'

export const ops = Router()

// ─── Emails ───
ops.get('/emails', (_req, res) => res.json({ emails: listDocs<Email>('emails'), smtpConfigured: smtpConfigured() }))
ops.post('/emails/draft', async (req, res) => {
  const { to, brief, kind = 'custom' } = req.body as { to: string; brief: string; kind?: Email['kind'] }
  if (!to || !brief) return res.status(400).json({ error: 'to and brief required' })
  try { res.json(await draftWithLLM(kind, to, brief, undefined, 'manual')) } catch (e) { res.status(502).json({ error: (e as Error).message }) }
})
ops.post('/emails/:id/send', async (req, res) => {
  try { res.json(await sendEmail(req.params.id)) } catch (e) { res.status(smtpConfigured() ? 502 : 409).json({ error: (e as Error).message }) }
})
ops.patch('/emails/:id', (req, res) => { res.json({ ok: patchDoc('emails', req.params.id, req.body, 'app') }) })
ops.delete('/emails/:id', (req, res) => { res.json({ ok: putDoc('emails', req.params.id, null, Date.now(), 'app') }) })

// ─── Invoices ───
ops.get('/invoices', (_req, res) => res.json(listDocs<Invoice>('invoices')))
ops.post('/invoices', (req, res) => {
  const b = req.body as Partial<Invoice> & { dueDays?: number; sourceCommitmentId?: string }
  if (!b.client || !b.amount) return res.status(400).json({ error: 'client and amount required' })
  const issued = new Date(); const due = new Date(); due.setDate(due.getDate() + (b.dueDays ?? 14))
  const n = listDocs<Invoice>('invoices').length + 89
  const inv: Invoice = { id: uid(), number: b.number ?? `INV-${issued.getFullYear()}-${String(n).padStart(3, '0')}`, client: b.client, email: b.email, amount: Number(b.amount), currency: b.currency ?? getSettings().currency, issuedAt: issued.toISOString(), dueAt: b.dueAt ?? due.toISOString(), status: b.status ?? 'sent', description: b.description, chaseStage: 0, sourceCommitmentId: b.sourceCommitmentId }
  putDoc('invoices', inv.id, inv as unknown as Record<string, unknown>, Date.now(), 'app')
  res.json(inv)
})
ops.patch('/invoices/:id', (req, res) => res.json({ ok: patchDoc('invoices', req.params.id, req.body, 'app') }))

// ─── Automation ───
ops.get('/automation', (_req, res) => res.json({ jobs: listJobs(60), escalation: escalation('Revenue'), pipeline: escalation('Pipeline'), finance: burnAndRunway(), revenueHistory: kpiHistory('Revenue', 7) }))
ops.post('/automation/run/:kind', (req, res) => {
  const kind = req.params.kind as JobKind
  const ok = enqueue(kind, Date.now(), req.body ?? {}, `manual:${kind}:${Date.now()}`)
  res.json({ ok, note: ok ? 'queued — runs within 20s' : 'not queued' })
})
ops.get('/brief', (_req, res) => {
  const briefs = listDocs<{ ts: string; kind: string; text: string }>('briefs').filter(b => b.kind === 'morning')
  res.json({ latest: briefs[0] ?? null, snapshot: snapshot() })
})

// ─── Forecast, metrics, usage, memory ───
ops.get('/finance/forecast', (_req, res) => res.json({ scenarios: standardScenarios(), generatedAt: new Date().toISOString() }))
ops.get('/metrics', (_req, res) => res.json(metrics()))
ops.get('/usage', (req, res) => res.json(usageSummary(Number(req.query.days ?? 7))))
ops.post('/memory/reindex', async (_req, res) => { try { res.json(await reindex()) } catch (e) { res.status(500).json({ error: (e as Error).message }) } })
ops.get('/memory/search', async (req, res) => { try { res.json(await recall(String(req.query.q ?? ''), 8)) } catch (e) { res.status(500).json({ error: (e as Error).message }) } })

// ─── Report page (shareable memo) ───
ops.get('/report', (_req, res) => {
  const m = metrics(); const snap = snapshot(); const sc = standardScenarios(); const s = getSettings()
  const brief = listDocs<{ kind: string; text: string; ts: string }>('briefs').find(b => b.kind === 'weekly_review')
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EA-OS memo</title>
<body style="margin:0;background:#080808;color:#f0f0f0;font-family:-apple-system,Inter,sans-serif;padding:24px;max-width:720px">
<div style="font:12px monospace;color:#ff6b00;letter-spacing:2px">EA-OS · FOUNDER MEMO · ${fmtDate(new Date())}</div>
<h1 style="font-size:22px;margin:8px 0 16px">${s.founderName} — state of the business</h1>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
${[['Revenue', `${snap.esc.actual.toLocaleString()} / ${snap.esc.target.toLocaleString()}`, snap.esc.label], ['Forecast', snap.esc.forecast.toLocaleString(), `${snap.esc.daysLeft} days left`], ['Runway', `${snap.finance.runwayMonths} mo`, `cash ${snap.finance.cash.toLocaleString()}`], ['Receivables', snap.finance.receivables.toLocaleString(), `${snap.invoices.length} invoices`], ['Cash low (base)', sc[1].minCash.toLocaleString(), `week ${sc[1].minCashWeek}`], ['Open problems', String(snap.openProblems.length), snap.openProblems.filter(p => p.severity === 'high').length + ' high']].map(([l, v, sub]) => `<div style="border:1px solid #222;padding:10px"><div style="font:9px monospace;color:#666">${l.toUpperCase()}</div><div style="font:700 16px monospace;color:#ff6b00">${v}</div><div style="font:9px monospace;color:#555">${sub}</div></div>`).join('')}
</div>
<h3 style="font:12px monospace;color:#888;margin:16px 0 6px">WEEKLY REVIEW</h3><p style="font-size:14px;line-height:1.6;color:#ccc">${brief?.text ?? 'No weekly review yet.'}</p>
<h3 style="font:12px monospace;color:#888;margin:16px 0 6px">OPERATING METRICS (30 DAYS)</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px">${Object.entries(m).map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #1a1a1a;color:#888">${k.replace(/_/g, ' ')}</td><td style="padding:6px 0;border-bottom:1px solid #1a1a1a;text-align:right;font-family:monospace">${typeof v === 'number' ? v.toLocaleString() : String(v)}</td></tr>`).join('')}</table>
<h3 style="font:12px monospace;color:#888;margin:16px 0 6px">13-WEEK CASH (PESSIMISTIC / BASE / OPTIMISTIC)</h3>
<table style="width:100%;border-collapse:collapse;font:12px monospace">${sc[0].weeks.map((w, i) => `<tr><td style="color:#666;padding:3px 0">W${w.week}</td><td style="text-align:right;color:${sc[0].weeks[i].cash < 0 ? '#f87171' : '#aaa'}">${sc[0].weeks[i].cash.toLocaleString()}</td><td style="text-align:right;color:${sc[1].weeks[i].cash < 0 ? '#f87171' : '#f0f0f0'}">${sc[1].weeks[i].cash.toLocaleString()}</td><td style="text-align:right;color:#4ade80">${sc[2].weeks[i].cash.toLocaleString()}</td></tr>`).join('')}</table>
<h3 style="font:12px monospace;color:#888;margin:16px 0 6px">OPEN PROBLEMS</h3>${snap.openProblems.map(p => `<div style="padding:6px 0;border-bottom:1px solid #1a1a1a"><span style="font:9px monospace;color:${p.severity === 'high' ? '#f87171' : '#facc15'}">${p.severity.toUpperCase()}</span> ${p.title}</div>`).join('') || '<p style="color:#666">None</p>'}
<p style="font:9px monospace;color:#444;margin-top:24px">Generated by EA-OS from voice notes, commitments, invoices and KPIs. Nothing here was typed.</p></body>`
  res.type('html').send(html)
})

// ─── Settings ───
ops.get('/settings', (_req, res) => res.json(getSettings()))
ops.put('/settings', (req, res) => {
  const merged = { ...getSettings(), ...req.body, notifications: { ...getSettings().notifications, ...(req.body.notifications ?? {}) }, email: { ...getSettings().email, ...(req.body.email ?? {}) }, location: { ...getSettings().location, ...(req.body.location ?? {}) } }
  putDoc('settings', 'main', merged, Date.now(), 'app')
  res.json(merged)
})
ops.post('/settings/reset', (_req, res) => { putDoc('settings', 'main', DEFAULT_SETTINGS as unknown as Record<string, unknown>); res.json(DEFAULT_SETTINGS) })

// ─── Client profiles ───
ops.get('/clients/:id/profile', (req, res) => res.json(clientProfile(req.params.id)))

// ─── Recommendations: run now for a conversation ───
ops.post('/conversations/:id/recommend', (req, res) => { patchDoc('conversations', req.params.id, { recommendedAt: undefined }); res.json({ ok: enqueue('recommend', Date.now(), { id: req.params.id }, `recommend:${req.params.id}:${Date.now()}`) }) })

// ─── Test notification ───
ops.post('/notify/test', async (_req, res) => res.json(await notify({ kind: 'test', title: 'EA-OS', body: 'Push notifications are working.', link: { tab: 'home' } })))

export const _unused = { fmtDate, getDoc, uid }
export type { Decision }

// ─── Public task page for staff (linked from the WhatsApp message; no auth, unguessable id) ───
export const publicRoutes = Router()
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const page = (a: Assignment | null, done: boolean) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EA-OS task</title>
<body style="margin:0;background:#080808;color:#f0f0f0;font-family:-apple-system,Inter,sans-serif;padding:24px;max-width:480px">
<div style="font:12px monospace;color:#ff6b00;letter-spacing:2px">EA-OS · TASK</div>
${a ? `<h2 style="font-size:20px;margin:12px 0 6px">${esc(a.task)}</h2>
<div style="font:12px monospace;color:#888">OWNER: ${esc(a.assignee)} · DUE: ${esc(a.due)} · ${esc(a.source)}</div>
${done || a.status === 'done' ? `<div style="margin-top:24px;padding:14px;border:1px solid #14532d;color:#4ade80;font:13px monospace">✓ MARKED DONE — thank you</div>`
: `<form method="post" action="/t/${a.id}/done" style="margin-top:24px"><button style="width:100%;padding:16px;background:#ff6b00;border:0;color:#000;font:700 14px monospace;letter-spacing:1px">✓ MARK DONE</button></form>
<form method="post" action="/t/${a.id}/start" style="margin-top:8px"><button style="width:100%;padding:12px;background:transparent;border:1px solid #333;color:#aaa;font:12px monospace">I'VE STARTED</button></form>`}
<form method="post" action="/t/${a.id}/reply" style="margin-top:20px"><div style="font:9px monospace;color:#666;margin-bottom:6px">UPDATE / QUESTION FOR ${esc((a.source || '').includes('Solver') ? 'THE FOUNDER' : 'AHMED')}</div><textarea name="text" rows="3" style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;color:#eee;padding:10px;font:14px -apple-system,sans-serif" placeholder="e.g. Blocked — need the client's logo files"></textarea><button style="margin-top:8px;width:100%;padding:12px;background:transparent;border:1px solid #ff6b00;color:#ff6b00;font:12px monospace">SEND UPDATE</button></form>
${((a as Assignment & { replies?: { at: string; text: string }[] }).replies ?? []).map(r => `<div style="margin-top:10px;padding:8px;border-left:2px solid #333;font-size:13px;color:#aaa"><div style="font:9px monospace;color:#555">${esc(r.at.slice(0, 16).replace('T', ' '))}</div>${esc(r.text)}</div>`).join('')}`
: `<p style="color:#888">This task no longer exists.</p>`}</body>`
publicRoutes.get('/t/:id', (req, res) => res.type('html').send(page(getDoc<Assignment>('assignments', req.params.id)?.data ?? null, false)))
publicRoutes.post('/t/:id/done', async (req, res) => {
  const a = getDoc<Assignment>('assignments', req.params.id)?.data
  if (a && a.status !== 'done') { patchDoc('assignments', a.id, { status: 'done', doneAt: new Date().toISOString(), doneVia: 'link' }, `staff:${a.assignee}`); await notify({ kind: 'task_done', title: `${a.assignee} marked done`, body: a.task, link: { tab: 'ops', id: a.id } }) }
  res.type('html').send(page(a ?? null, true))
})
publicRoutes.post('/t/:id/reply', express.urlencoded({ extended: false }), async (req, res) => {
  const a = getDoc<Assignment & { replies?: { at: string; text: string }[] }>('assignments', req.params.id)?.data
  const text = String((req.body as { text?: string })?.text ?? '').trim().slice(0, 1000)
  if (a && text) {
    patchDoc('assignments', a.id, { replies: [...(a.replies ?? []), { at: new Date().toISOString(), text }] }, `staff:${a.assignee}`)
    await notify({ kind: 'staff_reply', title: `${a.assignee}: update on "${a.task.slice(0, 40)}"`, body: text, link: { tab: 'ops', id: a.id } })
  }
  res.redirect(`/t/${req.params.id}`)
})
publicRoutes.post('/t/:id/start', (req, res) => {
  const a = getDoc<Assignment>('assignments', req.params.id)?.data
  if (a && a.status === 'pending') patchDoc('assignments', a.id, { status: 'in_progress' }, `staff:${a.assignee}`)
  res.redirect(`/t/${req.params.id}`)
})
