import type { Request, Response, NextFunction } from 'express'

// Bearer-token auth. Set EA_OS_API_TOKEN on the server and EXPO_PUBLIC_API_TOKEN in the app.
// When the token is unset the server runs open (dev on a private LAN) and says so at boot.
export const token = () => process.env.EA_OS_API_TOKEN?.trim() || null

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const t = token()
  if (!t) return next()
  if (req.path === '/health' || req.path.startsWith('/t/')) return next()
  const h = req.headers.authorization ?? ''
  if (h === `Bearer ${t}`) return next()
  res.status(401).json({ error: 'Unauthorized' })
}

// Tiny in-memory rate limiter (per IP): 120 requests/minute, 20 audio uploads/minute.
const buckets = new Map<string, { n: number; reset: number }>()
export function rateLimit(limit: number, keyPrefix = '') {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyPrefix + (req.ip ?? 'x')
    const now = Date.now()
    const b = buckets.get(key)
    if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + 60_000 }); return next() }
    if (++b.n > limit) return res.status(429).json({ error: 'Too many requests' })
    next()
  }
}
