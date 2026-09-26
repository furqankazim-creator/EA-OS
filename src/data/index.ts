import type { Conversation, Decision, Expense, Problem, HealthEntry, KpiUpdate, StaffMember, Assignment } from '@/types'

// Seed data. Dates are anchored to "now" so Today/Yesterday grouping works on any day.
const at = (daysAgo: number, hh: number, mm: number) => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hh, mm, 0, 0); return d.toISOString()
}

export const CONVERSATIONS: Conversation[] = [
  {
    id: 'c1', createdAt: at(0, 14, 32), durationSec: 135, lang: 'en-US', source: 'sample', status: 'committed',
    transcript: 'Had a meeting with Zahoor. We decided to pivot the sales strategy. I\'m committing to deliver the new positioning deck by Friday. Also, I\'m behind on my 100k target—I\'ve only made 60k this month. Spent 1,500 PKR on coffee and office supplies.',
    extracted: {
      summary: 'Sales strategy pivot agreed with Zahoor; positioning deck due Friday. Revenue at 60k of 100k target.',
      instructions: [
        { text: 'Call Zahoor to confirm strategy', assigned_to: null },
        { text: 'Prepare positioning deck outline', assigned_to: null },
        { text: 'Send current revenue report to team', assigned_to: null },
      ],
      decisions: [{ title: 'Pivot sales strategy to inbound-first', description: 'Agreed with Zahoor after reviewing outbound results.' }],
      commitments: [{ who: 'Ahmed (me)', what: 'Deliver positioning deck', by: 'Friday', source_quote: 'I\'m committing to deliver the new positioning deck by Friday.' }],
      finance: [{ amount: 1500, currency: 'PKR', office_portion: 1300, personal_portion: 200, category: 'Office', description: 'Coffee and office supplies' }],
      health: [], problems: [],
      staff_mentions: [{ name: 'Zahoor', context: 'Met to discuss the sales strategy pivot' }],
      kpi_updates: [{ metric: 'Revenue', value: 60000, unit: 'PKR', trend: 'up' }],
      suggestions: [{ text: 'Consider doubling outreach touchpoints for next 2 weeks', rationale: 'Revenue is 40% behind target with 14 days left.' }],
      leads: [],
    },
  },
  {
    id: 'c2', createdAt: at(0, 11, 8), durationSec: 242, lang: 'en-US', source: 'sample', status: 'committed',
    transcript: 'Reviewed Q3 deliverables with the client. Three items still pending—design revisions, the API docs, and the billing module. Furqan needs to wrap up the backend by Thursday. I committed to the final delivery by Sep 22.',
    extracted: {
      summary: 'Q3 review with client: three deliverables pending. Furqan owns backend by Thursday; final delivery committed for Sep 22.',
      instructions: [{ text: 'Follow up on design revisions', assigned_to: null }],
      decisions: [],
      commitments: [
        { who: 'Ahmed (me)', what: 'Final Q3 delivery to client', by: 'Sep 22', source_quote: 'I committed to the final delivery by Sep 22.' },
        { who: 'Furqan', what: 'Backend module completion', by: 'Thursday', source_quote: 'Furqan needs to wrap up the backend by Thursday.' },
      ],
      finance: [], health: [], problems: [],
      staff_mentions: [{ name: 'Furqan', context: 'Responsible for wrapping up the backend module' }],
      kpi_updates: [], suggestions: [], leads: [],
    },
  },
  {
    id: 'c3', createdAt: at(0, 9, 15), durationSec: 105, lang: 'en-US', source: 'sample', status: 'committed',
    transcript: 'Morning check-in. Revenue is at 62k this month, target is 100k. Team is mostly on track. Need Bilal to send the investor update by EOD.',
    extracted: {
      summary: 'Morning check-in: revenue 62k vs 100k target. Bilal to send investor update by EOD.',
      instructions: [{ text: 'Send investor update by EOD', assigned_to: 'Bilal' }],
      decisions: [], commitments: [], finance: [], health: [], problems: [],
      staff_mentions: [{ name: 'Bilal', context: 'Asked to send the investor update by EOD' }],
      kpi_updates: [{ metric: 'Revenue', value: 62000, unit: 'PKR', trend: 'up' }],
      suggestions: [],
      leads: [],
    },
  },
  {
    id: 'c4', createdAt: at(1, 16, 50), durationSec: 210, lang: 'en-US', source: 'sample', status: 'committed',
    transcript: 'Sales pipeline is completely dry. No new leads this week. We need to urgently run outreach—email campaigns, LinkedIn. Decided to hire a part-time sales person for the next two months.',
    extracted: {
      summary: 'Sales pipeline is empty. Urgent outreach planned; decided to hire a part-time salesperson for two months.',
      instructions: [
        { text: 'Launch LinkedIn outreach campaign', assigned_to: null },
        { text: 'Draft email campaign for leads', assigned_to: null },
      ],
      decisions: [{ title: 'Hire part-time sales person for Q4', description: 'Two-month engagement to rebuild the pipeline.' }],
      commitments: [], finance: [], health: [],
      problems: [{ title: 'Sales pipeline is empty — no new leads this week', description: 'No inbound or outbound leads. Revenue at risk for next quarter.', severity: 'high' }],
      staff_mentions: [],
      kpi_updates: [],
      suggestions: [{ text: 'Run paid LinkedIn ads to supplement outreach', rationale: 'Fastest way to fill top of funnel while organic outreach ramps.' }],
      leads: [],
    },
  },
  {
    id: 'c5', createdAt: at(1, 10, 22), durationSec: 178, lang: 'en-US', source: 'sample', status: 'committed',
    transcript: 'Finance review: spent 12,450 PKR this week. Rent 45,000, salaries coming up 450,000. Need to chase the three overdue invoices—Acme Corp, TechBase, and Novex. Total outstanding is around 2.4M PKR.',
    extracted: {
      summary: 'Weekly finance review: 12,450 PKR spent, rent and payroll upcoming. 2.4M PKR outstanding across three overdue invoices.',
      instructions: [{ text: 'Chase overdue invoices: Acme, TechBase, Novex', assigned_to: null }],
      decisions: [], commitments: [],
      finance: [
        { amount: 45000, currency: 'PKR', office_portion: 45000, personal_portion: 0, category: 'Rent', description: 'Office rent' },
        { amount: 450000, currency: 'PKR', office_portion: 450000, personal_portion: 0, category: 'Payroll', description: 'Monthly salaries' },
      ],
      health: [],
      problems: [{ title: 'Outstanding receivables: 2.4M PKR across 3 clients', description: 'Acme Corp, TechBase and Novex invoices are overdue.', severity: 'high' }],
      staff_mentions: [], kpi_updates: [],
      suggestions: [{ text: 'Send formal demand notice for invoices >30 days overdue', rationale: 'Escalation typically accelerates payment on aged receivables.' }],
      leads: [],
    },
  },
]

export const DECISIONS: Decision[] = [
  { id: 'd1', title: 'Pivot sales strategy to inbound-first', date: 'Sep 16', status: 'active', source: '14:32 conversation', type: 'Decision' },
  { id: 'd2', title: 'Hire part-time sales person for Q4', date: 'Sep 15', status: 'pending', source: '16:50 conversation', type: 'Decision' },
  { id: 'd3', title: 'Deliver positioning deck by Sep 20', date: 'Sep 16', who: 'Ahmed (me)', by: 'Sep 20', status: 'in_progress', source: '14:32 conversation', type: 'Commitment' },
  { id: 'd4', title: 'Wrap up backend module', date: 'Sep 15', who: 'Furqan', by: 'Sep 18', status: 'in_progress', source: '11:08 conversation', type: 'Commitment' },
  { id: 'd5', title: 'Send investor update EOD', date: 'Sep 16', who: 'Bilal', by: 'Sep 16', status: 'overdue', source: '09:15 conversation', type: 'Commitment' },
  { id: 'd6', title: 'Chase 3 overdue invoices (2.4M PKR)', date: 'Sep 15', status: 'pending', source: '10:22 conversation', type: 'Commitment' },
]

export const EXPENSES: Expense[] = [
  { id: 'e1', desc: 'Coffee + office supplies', amount: 1500, currency: 'PKR', office: 1300, personal: 200, category: 'Meals', date: 'Sep 16, 14:35', dateAt: at(0, 14, 35), verified: false, auto: true },
  { id: 'e2', desc: 'Team biryani lunch', amount: 1720, currency: 'PKR', office: 1520, personal: 200, category: 'Meals', date: 'Sep 15, 13:10', dateAt: at(1, 13, 10), verified: true, auto: true },
  { id: 'e3', desc: 'Petrol + parking', amount: 800, currency: 'PKR', office: 800, personal: 0, category: 'Transport', date: 'Sep 15, 09:40', dateAt: at(1, 9, 40), verified: true, auto: true },
  { id: 'e4', desc: 'Office stationery', amount: 450, currency: 'PKR', office: 450, personal: 0, category: 'Supplies', date: 'Sep 14, 15:20', dateAt: at(2, 15, 20), verified: false, auto: false },
  { id: 'e5', desc: 'Client dinner', amount: 3800, currency: 'PKR', office: 3800, personal: 0, category: 'Client', date: 'Sep 13, 20:00', dateAt: at(3, 20, 0), verified: true, auto: true },
]

export const TEAM: StaffMember[] = [
  { id: 's1', name: 'Zahoor', role: 'Operations & Dev', status: 'active', assignments: 3, salary: 75000, phone: '' },
  { id: 's2', name: 'Furqan', role: 'Backend Developer', status: 'active', assignments: 2, salary: 65000, phone: '' },
  { id: 's3', name: 'Bilal', role: 'Sales & Outreach', status: 'active', assignments: 1, salary: 55000, phone: '' },
  { id: 's4', name: 'Sana', role: 'Design Lead', status: 'on_leave', assignments: 0, salary: 60000, phone: '' },
]

// Pre-configured executive challenges. The first ships with a completed board analysis as a demo.
export const PROBLEMS: Problem[] = [
  {
    id: 'p1', title: 'Sales pipeline is dry — no new leads', severity: 'high', date: 'Sep 15', status: 'action_planned', source: '16:50 conversation',
    description: 'No new inbound or outbound leads this week. Pipeline empty. Revenue at risk for next quarter.',
    analysis: {
      consensus_summary: 'The pipeline collapsed because lead generation was entirely dependent on the founder\'s ad-hoc outreach; when his attention shifted to delivery, top-of-funnel stopped. The board agrees on a two-track plan: reactivate the existing network within 72 hours for fast revenue, and in parallel stand up a repeatable outbound system owned by Bilal with a daily quota and weekly review.',
      root_cause: 'Lead generation was a founder-dependent activity with no owner, no cadence and no measurement — so it silently stopped.',
      models: [
        { name: 'Gemini 2.5 Pro', verdict: 'Build a distribution loop: referral incentive for existing clients plus a weekly content post that feeds a LinkedIn outreach sequence.', pros: ['Compounds over time', 'Low cash cost'], cons: ['Slow to show results (4–6 weeks)', 'Needs consistent publishing'] },
        { name: 'Claude 3.7 Sonnet', verdict: 'Fix the measurement first: define lead stages, track conversion per channel, and only scale the channel with the best CAC.', pros: ['Prevents spending on dead channels', 'Creates a durable funnel model'], cons: ['Analysis can delay action', 'Small sample sizes early'] },
        { name: 'GPT-4o', verdict: 'Run a 14-day outbound sprint: Bilal sends 50 personalized messages/day, daily 10-minute standup, Friday pipeline review.', pros: ['Immediate activity', 'Clear ownership and cadence'], cons: ['Burnout risk at 50/day', 'Quality can drop'] },
        { name: 'Grok 3 (Contrarian)', verdict: 'Stop building funnels. Call your 20 best past clients personally this week and ask for work or a referral. That is the whole plan.', pros: ['Fastest path to cash', 'Zero tooling'], cons: ['Not scalable', 'Depends on founder time'] },
      ],
      disagreements: ['Speed vs. system: Grok and GPT-4o want action this week; Gemini and Claude want measurement and loops that pay off in a month.', 'Who owns outreach: founder-led (Grok) vs. delegated to Bilal (GPT-4o).'],
      action_items: [
        { task: 'Send personalized outreach to top 20 past clients/contacts', assignee: 'Ahmed', deadline_days: 3 },
        { task: 'Build target list of 300 prospects and start 50/day LinkedIn + email sequence', assignee: 'Bilal', deadline_days: 5 },
        { task: 'Set up pipeline tracking sheet with stage conversion rates', assignee: 'Zahoor', deadline_days: 2 },
      ],
      decisions_to_record: [
        { title: 'Bilal owns outbound lead generation with a 5 qualified conversations/week target', description: 'Removes founder dependency; reviewed every Friday.' },
        { title: 'Network reactivation first, paid ads only if pipeline is still <10 leads by Sep 30', description: 'Cash-preserving sequencing.' },
      ],
      engine: 'demo', generated_at: '2026-09-15T16:55:00.000Z',
    },
  },
  {
    id: 'p2', title: 'Outbound sales conversion dropped by 45%', severity: 'high', date: 'Sep 14', status: 'open',
    description: 'Reply rate on cold outreach fell from 9% to 5% over six weeks; booked calls down from 12/week to 6. Same list sources, same scripts.',
    analysis: null,
  },
  {
    id: 'p3', title: 'Core client billing dispute over scope creep & retainer terms', severity: 'high', date: 'Sep 13', status: 'open',
    description: 'Acme Corp is withholding the 850k PKR invoice, claiming the billing module was in scope of the retainer. Relationship and cash flow at risk.',
    analysis: null,
  },
  {
    id: 'p4', title: 'Backend server latency spiking during peak traffic hours', severity: 'medium', date: 'Sep 12', status: 'open',
    description: 'API p95 latency goes from 300ms to 2.5s between 8–10pm. Two client complaints this week. Furqan suspects unindexed queries on the billing tables.',
    analysis: null,
  },
]

export const ASSIGNMENTS: Assignment[] = [
  { id: 'a1', task: 'Send personalized outreach to top 20 past clients/contacts', assignee: 'Ahmed', due: 'Sep 18', dueAt: '2026-09-18T00:00:00.000Z', status: 'in_progress', source: 'AI Solver: Sales pipeline is dry', problemId: 'p1' },
  { id: 'a2', task: 'Build target list of 300 prospects and start 50/day sequence', assignee: 'Bilal', due: 'Sep 20', dueAt: '2026-09-20T00:00:00.000Z', status: 'pending', source: 'AI Solver: Sales pipeline is dry', problemId: 'p1' },
  { id: 'a3', task: 'Set up pipeline tracking sheet with stage conversion rates', assignee: 'Zahoor', due: 'Sep 17', dueAt: '2026-09-17T00:00:00.000Z', status: 'done', source: 'AI Solver: Sales pipeline is dry', problemId: 'p1' },
]

export const HEALTH_LOG: HealthEntry[] = [
  { id: 'h1', date: 'Sep 16', time: '08:30', type: 'injury', note: 'Knee pain acting up again, difficulty sitting for long', source: 'conversation', severity: 'medium' },
  { id: 'h2', date: 'Sep 15', time: '14:00', type: 'diet', note: 'Couldn\'t focus during afternoon calls — too much coffee', source: 'conversation', severity: 'low' },
  { id: 'h3', date: 'Sep 14', time: '09:00', type: 'sleep', note: 'Good energy, slept 7 hrs. Productive morning.', source: 'manual', severity: 'good' },
  { id: 'h4', date: 'Sep 12', time: '20:00', type: 'diet', note: 'Headache after long day. Skipped dinner.', source: 'conversation', severity: 'medium' },
]

export const KPI_UPDATES: KpiUpdate[] = [
  { id: 'k1', metric: 'Revenue', value: 62000, unit: 'PKR', trend: 'up', date: 'Sep 16, 09:15', dateAt: at(0, 9, 15), source: '09:15 conversation' },
  { id: 'k2', metric: 'Revenue', value: 60000, unit: 'PKR', trend: 'up', date: 'Sep 16, 14:32', dateAt: at(0, 14, 32), source: '14:32 conversation' },
  { id: 'k3', metric: 'Pipeline', value: 8, unit: 'leads', trend: 'down', date: 'Sep 15, 16:50', dateAt: at(1, 16, 50), source: '16:50 conversation' },
]

// Pre-configured executive voice samples for environments without microphone access.
export const QUICK_SAMPLES: { title: string; transcript: string }[] = [
  {
    title: 'Outbound Sales & Lead Gen Crisis',
    transcript: 'Okay so this week has been rough on sales. Pipeline is basically empty, zero inbound, and Bilal only booked two calls. We decided to run a 30-day outbound sprint starting Monday — LinkedIn plus cold email, 50 prospects a day. Bilal, you own the lead list, I need it by Wednesday. I\'m committing to personally message my top 20 past clients by Friday. Also revenue update: we are at 58k against the 100k target, so pipeline is a high severity problem right now.',
  },
  {
    title: 'Office Refreshments & Biryani Split',
    transcript: 'Quick expense note. Team biryani lunch today was 4,200 rupees, out of which around 600 was my own order so that\'s personal, rest is office. Also paid 900 for tea and biscuits for the office kitchen. Zahoor mentioned the water dispenser is broken again, someone needs to call the vendor. Decided we\'ll switch the water supplier next month.',
  },
  {
    title: 'Post-Squat Back Strain Recovery',
    transcript: 'Health log. Did heavy squats yesterday, 100 kg, and my lower back is strained today, maybe a 5 out of 10 pain. Slept only five hours. Going to skip legs for a week and do mobility work instead. Also I skipped breakfast again — need to fix that. Reminder to book the physio appointment, Sana can share her physio\'s number.',
  },
]
