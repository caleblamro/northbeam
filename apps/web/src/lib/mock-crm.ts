// Mock CRM data for the app screens. Front-end only — representative records so
// the UI shows real density. Replace with tRPC + Drizzle when the data layer lands.

import type { DealStage } from './tones';

export type Owner = { id: string; name: string; email: string };
export type Health = 'good' | 'warn' | 'bad';

export type Account = {
  id: string;
  name: string;
  domain: string;
  plan: 'Enterprise' | 'Mid-market' | 'Startup';
  arr: number; // integer minor units (cents)
  contacts: number;
  health: Health;
  owner: Owner;
  industry: string;
};

export type ProbLevel = 'low' | 'mid' | 'high';

export type Contact = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  accountId: string;
  owner: Owner;
  lastActivity: string;
  stage: DealStage;
};

// Derived lead-style columns (source / size / interest / probability) for the
// Contacts list — computed deterministically from a contact so the table reads
// like a real leads board without bloating the mock records.
const SOURCES: Array<[string, boolean]> = [
  ['ORGANIC', false],
  ['SB2024', true],
  ['SUMMER2', true],
  ['DTJ25', true],
  ['AFF20', true],
];
const STAGE_PROB: Record<DealStage, ProbLevel> = {
  new: 'low',
  qualified: 'mid',
  negotiation: 'high',
  won: 'high',
  lost: 'low',
};
function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export function leadView(c: Contact) {
  const h = seed(c.id);
  const [source, external] = SOURCES[h % SOURCES.length] as [string, boolean];
  const size = (2 + (h % 22)) * 10_000_00; // $20k–$240k
  const up = c.stage === 'won' || c.stage === 'negotiation' || c.stage === 'qualified';
  const interest = Array.from({ length: 7 }, (_, i) => {
    const drift = up ? i : 6 - i;
    return 3 + ((seed(c.id + i) % 4) + drift) / 2;
  });
  return { source, external, size, interest, probability: STAGE_PROB[c.stage] };
}

export type Deal = {
  id: string;
  name: string;
  accountId: string;
  stage: DealStage;
  amount: number; // cents
  closeDate: string;
  owner: Owner;
  probability: number;
};

export type Activity = {
  id: string;
  kind: 'call' | 'email' | 'note' | 'stage' | 'migration';
  actor: string;
  summary: string;
  detail?: string;
  time: string;
};

export const OWNERS: Owner[] = [
  { id: 'jm', name: 'Jordan Mills', email: 'jordan@acme.com' },
  { id: 'ak', name: 'Aisha Khan', email: 'aisha@acme.com' },
  { id: 'rt', name: 'Ravi Teja', email: 'ravi@acme.com' },
];
const [JM, AK, RT] = OWNERS as [Owner, Owner, Owner];

export const ACCOUNTS: Account[] = [
  {
    id: 'vertex',
    name: 'Vertex Industries',
    domain: 'vertex.io',
    plan: 'Enterprise',
    arr: 240_000_00,
    contacts: 14,
    health: 'good',
    owner: JM,
    industry: 'Manufacturing',
  },
  {
    id: 'lumen',
    name: 'Lumen Labs',
    domain: 'lumenlabs.ai',
    plan: 'Mid-market',
    arr: 48_000_00,
    contacts: 6,
    health: 'good',
    owner: AK,
    industry: 'AI / ML',
  },
  {
    id: 'northwind',
    name: 'Northwind Trading',
    domain: 'northwind.co',
    plan: 'Mid-market',
    arr: 72_000_00,
    contacts: 9,
    health: 'warn',
    owner: RT,
    industry: 'Logistics',
  },
  {
    id: 'brightpath',
    name: 'Brightpath',
    domain: 'brightpath.com',
    plan: 'Startup',
    arr: 18_000_00,
    contacts: 4,
    health: 'good',
    owner: AK,
    industry: 'EdTech',
  },
  {
    id: 'meridian',
    name: 'Meridian Health',
    domain: 'meridianhealth.org',
    plan: 'Enterprise',
    arr: 310_000_00,
    contacts: 21,
    health: 'bad',
    owner: JM,
    industry: 'Healthcare',
  },
  {
    id: 'cobalt',
    name: 'Cobalt Systems',
    domain: 'cobalt.dev',
    plan: 'Startup',
    arr: 12_000_00,
    contacts: 3,
    health: 'good',
    owner: RT,
    industry: 'Developer tools',
  },
  {
    id: 'atlas',
    name: 'Atlas Freight',
    domain: 'atlasfreight.com',
    plan: 'Mid-market',
    arr: 64_000_00,
    contacts: 8,
    health: 'warn',
    owner: JM,
    industry: 'Logistics',
  },
  {
    id: 'pinnacle',
    name: 'Pinnacle Retail',
    domain: 'pinnacle.shop',
    plan: 'Enterprise',
    arr: 188_000_00,
    contacts: 17,
    health: 'good',
    owner: AK,
    industry: 'Retail',
  },
];

export const CONTACTS: Contact[] = [
  {
    id: 'c1',
    name: 'Marcus Chen',
    title: 'VP Sales',
    email: 'marcus@vertex.io',
    phone: '(415) 555-0142',
    accountId: 'vertex',
    owner: JM,
    lastActivity: '2 hours ago',
    stage: 'negotiation',
  },
  {
    id: 'c2',
    name: 'Priya Anand',
    title: 'CTO',
    email: 'priya@lumenlabs.ai',
    phone: '(628) 555-0110',
    accountId: 'lumen',
    owner: AK,
    lastActivity: '1 day ago',
    stage: 'qualified',
  },
  {
    id: 'c3',
    name: 'Sofia Reyes',
    title: 'Head of Procurement',
    email: 'sofia@northwind.co',
    phone: '(312) 555-0188',
    accountId: 'northwind',
    owner: RT,
    lastActivity: '3 days ago',
    stage: 'qualified',
  },
  {
    id: 'c4',
    name: 'David Okafor',
    title: 'Founder & CEO',
    email: 'david@brightpath.com',
    phone: '(206) 555-0173',
    accountId: 'brightpath',
    owner: AK,
    lastActivity: '5 hours ago',
    stage: 'won',
  },
  {
    id: 'c5',
    name: 'Hannah Müller',
    title: 'Operations Lead',
    email: 'hannah@vertex.io',
    phone: '(415) 555-0199',
    accountId: 'vertex',
    owner: JM,
    lastActivity: '1 week ago',
    stage: 'negotiation',
  },
  {
    id: 'c6',
    name: 'Liam Walsh',
    title: 'CFO',
    email: 'liam@lumenlabs.ai',
    phone: '(628) 555-0144',
    accountId: 'lumen',
    owner: AK,
    lastActivity: '4 days ago',
    stage: 'new',
  },
  {
    id: 'c7',
    name: 'Amara Singh',
    title: 'RevOps Manager',
    email: 'amara@northwind.co',
    phone: '(312) 555-0121',
    accountId: 'northwind',
    owner: RT,
    lastActivity: 'yesterday',
    stage: 'new',
  },
  {
    id: 'c8',
    name: 'Yuki Tanaka',
    title: 'Product Designer',
    email: 'yuki@brightpath.com',
    phone: '(206) 555-0166',
    accountId: 'brightpath',
    owner: AK,
    lastActivity: '2 weeks ago',
    stage: 'lost',
  },
  {
    id: 'c9',
    name: 'Elena Petrova',
    title: 'Director of IT',
    email: 'elena@meridianhealth.org',
    phone: '(617) 555-0133',
    accountId: 'meridian',
    owner: JM,
    lastActivity: '6 hours ago',
    stage: 'negotiation',
  },
  {
    id: 'c10',
    name: 'Tomás Herrera',
    title: 'Engineering Lead',
    email: 'tomas@cobalt.dev',
    phone: '(737) 555-0150',
    accountId: 'cobalt',
    owner: RT,
    lastActivity: '3 days ago',
    stage: 'qualified',
  },
  {
    id: 'c11',
    name: 'Grace Kim',
    title: 'VP Operations',
    email: 'grace@atlasfreight.com',
    phone: '(469) 555-0102',
    accountId: 'atlas',
    owner: JM,
    lastActivity: '1 day ago',
    stage: 'qualified',
  },
  {
    id: 'c12',
    name: 'Noah Bennett',
    title: 'Chief Merchant',
    email: 'noah@pinnacle.shop',
    phone: '(917) 555-0177',
    accountId: 'pinnacle',
    owner: AK,
    lastActivity: '8 hours ago',
    stage: 'negotiation',
  },
];

export const DEALS: Deal[] = [
  {
    id: 'd1',
    name: 'Vertex — Platform expansion',
    accountId: 'vertex',
    stage: 'negotiation',
    amount: 120_000_00,
    closeDate: 'Jun 28, 2026',
    owner: JM,
    probability: 70,
  },
  {
    id: 'd2',
    name: 'Lumen Labs — Annual renewal',
    accountId: 'lumen',
    stage: 'qualified',
    amount: 48_000_00,
    closeDate: 'Jul 15, 2026',
    owner: AK,
    probability: 45,
  },
  {
    id: 'd3',
    name: 'Northwind — Seat upgrade',
    accountId: 'northwind',
    stage: 'qualified',
    amount: 36_000_00,
    closeDate: 'Jul 02, 2026',
    owner: RT,
    probability: 40,
  },
  {
    id: 'd4',
    name: 'Brightpath — Renewal',
    accountId: 'brightpath',
    stage: 'won',
    amount: 18_000_00,
    closeDate: 'Jun 01, 2026',
    owner: AK,
    probability: 100,
  },
  {
    id: 'd5',
    name: 'Meridian — Enterprise rollout',
    accountId: 'meridian',
    stage: 'negotiation',
    amount: 220_000_00,
    closeDate: 'Aug 20, 2026',
    owner: JM,
    probability: 60,
  },
  {
    id: 'd6',
    name: 'Cobalt — Team plan',
    accountId: 'cobalt',
    stage: 'new',
    amount: 12_000_00,
    closeDate: 'Jul 30, 2026',
    owner: RT,
    probability: 20,
  },
  {
    id: 'd7',
    name: 'Atlas Freight — Expansion',
    accountId: 'atlas',
    stage: 'qualified',
    amount: 64_000_00,
    closeDate: 'Jul 22, 2026',
    owner: JM,
    probability: 50,
  },
  {
    id: 'd8',
    name: 'Pinnacle — Multi-region',
    accountId: 'pinnacle',
    stage: 'negotiation',
    amount: 188_000_00,
    closeDate: 'Aug 05, 2026',
    owner: AK,
    probability: 65,
  },
  {
    id: 'd9',
    name: 'Northwind — Pilot',
    accountId: 'northwind',
    stage: 'new',
    amount: 9_000_00,
    closeDate: 'Aug 12, 2026',
    owner: RT,
    probability: 15,
  },
  {
    id: 'd10',
    name: 'Cobalt — Legacy migration',
    accountId: 'cobalt',
    stage: 'lost',
    amount: 24_000_00,
    closeDate: 'May 18, 2026',
    owner: RT,
    probability: 0,
  },
];

export const ACTIVITIES: Activity[] = [
  {
    id: 'a1',
    kind: 'stage',
    actor: 'Marcus Chen',
    summary: 'moved Vertex — Platform expansion to Negotiation',
    time: '2h ago',
  },
  {
    id: 'a2',
    kind: 'note',
    actor: 'You',
    summary: 'left a note on Lumen Labs',
    detail: 'Priya wants the renewal quote split into two line items before legal review.',
    time: '4h ago',
  },
  {
    id: 'a3',
    kind: 'email',
    actor: 'Aisha Khan',
    summary: 'emailed David Okafor',
    detail: 'Re: Brightpath renewal — signed, countersigned, closed.',
    time: '5h ago',
  },
  {
    id: 'a4',
    kind: 'migration',
    actor: 'System',
    summary: 'Salesforce migration completed',
    detail: '12,480 records mapped across Contacts, Accounts, and Opportunities.',
    time: 'Yesterday',
  },
  {
    id: 'a5',
    kind: 'call',
    actor: 'Ravi Teja',
    summary: 'logged a call with Sofia Reyes',
    detail: '20 min — discovery on the Northwind seat upgrade. Strong intent.',
    time: 'Yesterday',
  },
  {
    id: 'a6',
    kind: 'stage',
    actor: 'Aisha Khan',
    summary: 'closed Brightpath — Renewal as won',
    detail: '$18,000 · 12-month term',
    time: '2 days ago',
  },
];

export const STAGE_ORDER: DealStage[] = ['new', 'qualified', 'negotiation', 'won', 'lost'];

export function accountById(id: string): Account | undefined {
  return ACCOUNTS.find((a) => a.id === id);
}

/** cents → "$1.2M" / "$48,000" */
export function fmtMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (dollars >= 10_000) return `$${Math.round(dollars / 1000)}K`;
  return `$${dollars.toLocaleString('en-US')}`;
}

export function fmtMoneyFull(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US')}`;
}
