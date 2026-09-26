// First-run seed so the server has the same team/clients the app ships with.
import { listDocs, putDoc } from './db.js'

export function seedIfEmpty() {
  if (!listDocs('staff').length) {
    for (const s of [
      { id: 's0', name: 'Ahmed', role: 'Founder & CEO', status: 'active', salary: 0 },
      { id: 's1', name: 'Zahoor', role: 'Operations & Dev', status: 'active', salary: 75000 },
      { id: 's2', name: 'Furqan', role: 'Backend Developer', status: 'active', salary: 65000 },
      { id: 's3', name: 'Bilal', role: 'Sales & Outreach', status: 'active', salary: 55000 },
      { id: 's4', name: 'Sana', role: 'Design Lead', status: 'on_leave', salary: 60000 },
    ]) putDoc('staff', s.id, s, Date.now(), 'seed')
    console.log('seeded staff')
  }
  if (!listDocs('clients').length) {
    for (const c of [
      { id: 'c1', name: 'Acme Corp', email: 'accounts@acmecorp.com', aliases: ['Acme'] },
      { id: 'c2', name: 'TechBase Ltd', email: 'team@techbase.pk', aliases: ['TechBase'] },
      { id: 'c3', name: 'Novex', email: '', aliases: [] },
    ]) putDoc('clients', c.id, c, Date.now(), 'seed')
    console.log('seeded clients')
  }
}
