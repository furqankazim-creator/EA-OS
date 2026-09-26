import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { conversations } from './routes/conversations.js'
import { challenges } from './routes/challenges.js'
import { assistant } from './routes/assistant.js'
import { sync } from './routes/sync.js'
import { ops, publicRoutes } from './routes/ops.js'
import { provider, groqChatModel, geminiModel } from './llm.js'
import { requireAuth, rateLimit, token } from './auth.js'
import { startEngine } from './jobs/engine.js'
import './jobs/handlers.js'
import { seedIfEmpty } from './seed.js'
import { smtpConfigured } from './emails.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '30mb' }))   // audio arrives inline as base64
app.use(publicRoutes)                       // /t/:id staff task pages — public by design
app.use(requireAuth)
app.use(rateLimit(240))
app.use('/api/conversations/extract', rateLimit(30, 'extract:'))

app.get('/health', (_req, res) => res.json({
  ok: true, provider: provider(), model: provider() === 'groq' ? groqChatModel() : geminiModel(),
  hasKey: !!(provider() === 'groq' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY),
  auth: !!token(), smtp: smtpConfigured(), version: 2,
}))
app.use('/api/conversations', conversations)
app.use('/api/challenges', challenges)
app.use('/api/assistant', assistant)
app.use('/api/sync', sync)
app.use('/api', ops)

const port = Number(process.env.PORT ?? 3001)
app.listen(port, '0.0.0.0', () => {
  console.log(`EA-OS server on http://0.0.0.0:${port}`)
  console.log(`provider: ${provider()} · auth: ${token() ? 'bearer token' : 'OPEN (set EA_OS_API_TOKEN)'} · smtp: ${smtpConfigured() ? 'configured' : 'not configured'}`)
  if (provider() === 'groq' && !process.env.GROQ_API_KEY) console.warn('⚠  GROQ_API_KEY is not set')
  seedIfEmpty()
  startEngine()
})
