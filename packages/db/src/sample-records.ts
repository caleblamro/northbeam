// Sample record seed — populates a freshly-created workspace with realistic
// accounts, contacts, deals, and activities so the dashboard isn't empty
// out of the gate. Relationships are wired (contacts point at accounts,
// deals point at both account + primary contact, activities point at
// contacts and either a related deal or a related account).
//
// Called after seedStandardObjects in the same withOrgContext transaction
// the org.create handler opens, so RLS is satisfied and partial inserts
// roll back together.
//
// Medium scale: ~250 records (12 accounts × 5 contacts × 3 deals × ~3
// activities). Big enough to stress filters / sort / pagination; small
// enough that org.create stays ~2s on a fresh DB.

import type { DbExecutor } from './client.js';
import { createRecord } from './dynamic/records.js';
import { getObjectByKey } from './queries/crm.js';

const ACCOUNTS: Array<{
  name: string;
  website: string;
  type: string;
  industry: string;
  rating: string;
  employees: number;
  annual_revenue: number;
  phone: string;
  description: string;
}> = [
  {
    name: 'Acme Corp',
    website: 'https://acme.example',
    type: 'customer',
    industry: 'technology',
    rating: 'hot',
    employees: 480,
    annual_revenue: 42_000_000,
    phone: '+1 (415) 555-0142',
    description: 'Long-time customer on the Scale plan. Expansion conversation in flight.',
  },
  {
    name: 'Globex Industries',
    website: 'https://globex.example',
    type: 'customer',
    industry: 'manufacturing',
    rating: 'warm',
    employees: 5_200,
    annual_revenue: 380_000_000,
    phone: '+1 (212) 555-0178',
    description: 'Manufacturing customer renewing in Q3. Procurement-driven cycle.',
  },
  {
    name: 'Initech Solutions',
    website: 'https://initech.example',
    type: 'customer',
    industry: 'consulting',
    rating: 'hot',
    employees: 220,
    annual_revenue: 18_000_000,
    phone: '+1 (646) 555-0163',
    description: 'Consulting firm — referred via Cyberdyne. Rolling out across 4 BUs.',
  },
  {
    name: 'Soylent Corp',
    website: 'https://soylent.example',
    type: 'partner',
    industry: 'food_beverage',
    rating: 'warm',
    employees: 1_500,
    annual_revenue: 95_000_000,
    phone: '+1 (510) 555-0119',
    description: 'Channel partner. Reselling Northbeam to mid-market clients.',
  },
  {
    name: 'Wayne Enterprises',
    website: 'https://wayne.example',
    type: 'prospect',
    industry: 'engineering',
    rating: 'hot',
    employees: 12_400,
    annual_revenue: 1_400_000_000,
    phone: '+1 (212) 555-0211',
    description: 'Enterprise prospect — security review in progress. Targeting Q4 close.',
  },
  {
    name: 'Stark Industries',
    website: 'https://stark.example',
    type: 'customer',
    industry: 'engineering',
    rating: 'hot',
    employees: 8_300,
    annual_revenue: 920_000_000,
    phone: '+1 (310) 555-0188',
    description: 'Customer since 2024. Champion: VP RevOps. Renewal locked in 18 months.',
  },
  {
    name: 'Hooli',
    website: 'https://hooli.example',
    type: 'prospect',
    industry: 'technology',
    rating: 'warm',
    employees: 14_000,
    annual_revenue: 1_650_000_000,
    phone: '+1 (415) 555-0223',
    description: 'Late-stage prospect. Multi-product evaluation; competing against incumbent.',
  },
  {
    name: 'Pied Piper',
    website: 'https://piedpiper.example',
    type: 'customer',
    industry: 'technology',
    rating: 'hot',
    employees: 75,
    annual_revenue: 6_500_000,
    phone: '+1 (650) 555-0156',
    description: 'Series B startup. Engineering-led adoption. High product velocity.',
  },
  {
    name: 'Vandelay Industries',
    website: 'https://vandelay.example',
    type: 'customer',
    industry: 'apparel',
    rating: 'cold',
    employees: 360,
    annual_revenue: 22_500_000,
    phone: '+1 (212) 555-0297',
    description: 'Importing/exporting — at-risk. Low product usage, no champion.',
  },
  {
    name: 'Sterling Cooper',
    website: 'https://sterlingcooper.example',
    type: 'prospect',
    industry: 'communications',
    rating: 'warm',
    employees: 480,
    annual_revenue: 38_000_000,
    phone: '+1 (212) 555-0388',
    description: 'Advertising agency. Mid-funnel; waiting on creative director sign-off.',
  },
  {
    name: 'Umbrella Corp',
    website: 'https://umbrella.example',
    type: 'customer',
    industry: 'biotechnology',
    rating: 'warm',
    employees: 3_400,
    annual_revenue: 410_000_000,
    phone: '+1 (215) 555-0411',
    description: 'Biotech customer. Compliance-heavy; long procurement cycles.',
  },
  {
    name: 'Massive Dynamic',
    website: 'https://massivedynamic.example',
    type: 'prospect',
    industry: 'engineering',
    rating: 'hot',
    employees: 22_000,
    annual_revenue: 2_300_000_000,
    phone: '+1 (212) 555-0455',
    description: 'Fortune 500 R&D division. Standardization push across business units.',
  },
];

type ContactTemplate = {
  first_name: string;
  last_name: string;
  title: string;
  department: string;
  lead_source: string;
};

const CONTACT_TEMPLATES: ContactTemplate[] = [
  {
    first_name: 'Alex',
    last_name: 'Rivera',
    title: 'VP RevOps',
    department: 'Revenue',
    lead_source: 'web',
  },
  {
    first_name: 'Sam',
    last_name: 'Chen',
    title: 'Director, Sales Ops',
    department: 'Revenue',
    lead_source: 'referral',
  },
  {
    first_name: 'Jordan',
    last_name: 'Patel',
    title: 'Procurement Manager',
    department: 'Finance',
    lead_source: 'phone_inquiry',
  },
  {
    first_name: 'Morgan',
    last_name: 'Khan',
    title: 'Head of Customer Success',
    department: 'Customer Success',
    lead_source: 'partner',
  },
  {
    first_name: 'Riley',
    last_name: 'Nguyen',
    title: 'Solutions Architect',
    department: 'Engineering',
    lead_source: 'trade_show',
  },
];

const STAGES = [
  'prospecting',
  'qualification',
  'needs_analysis',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;

const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'task'] as const;
const PRIORITIES = ['high', 'normal', 'normal', 'low'] as const;
const ACTIVITY_SUBJECTS: Record<(typeof ACTIVITY_TYPES)[number], string[]> = {
  call: [
    'Discovery call — qualify renewal scope',
    'Pricing follow-up',
    'Champion sync — internal alignment',
    'Procurement cadence call',
  ],
  email: [
    'Send pricing deck + ROI summary',
    'Recap of last week — proposed next steps',
    'Renewal terms draft',
    'Intro to Solutions Engineer',
  ],
  meeting: [
    'Quarterly business review',
    'Live demo — admin console + reporting',
    'Mutual action plan workshop',
    'Executive sponsor sync',
  ],
  task: [
    'Send champion intro to CS',
    'Update opportunity stage in CRM',
    'Confirm legal review status',
    'Draft renewal forecast',
  ],
};

function isoOffsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoOffsetDatetime(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export async function seedSampleRecords(db: DbExecutor, organizationId: string): Promise<void> {
  const accountObj = await getObjectByKey(db, organizationId, 'account');
  const contactObj = await getObjectByKey(db, organizationId, 'contact');
  const dealObj = await getObjectByKey(db, organizationId, 'deal');
  const activityObj = await getObjectByKey(db, organizationId, 'activity');
  if (!accountObj || !contactObj || !dealObj || !activityObj) return;

  // Accounts
  const accountIds: string[] = [];
  for (const a of ACCOUNTS) {
    const created = await createRecord(db, {
      orgId: organizationId,
      object: accountObj.object,
      fields: accountObj.fields,
      data: {
        name: a.name,
        website: a.website,
        type: a.type,
        industry: a.industry,
        rating: a.rating,
        employees: a.employees,
        annual_revenue: a.annual_revenue,
        phone: a.phone,
        description: a.description,
      },
    });
    accountIds.push(created.id);
  }

  // Contacts (5 per account = 60 total)
  const contactIds: Array<{ id: string; accountId: string }> = [];
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i];
    if (!accountId) continue;
    const accountName = ACCOUNTS[i]?.name ?? 'Account';
    const slug = accountName.toLowerCase().replace(/[^a-z]+/g, '');
    for (const c of CONTACT_TEMPLATES) {
      const email = `${c.first_name.toLowerCase()}.${c.last_name.toLowerCase()}@${slug}.example`;
      const created = await createRecord(db, {
        orgId: organizationId,
        object: contactObj.object,
        fields: contactObj.fields,
        data: {
          name: `${c.first_name} ${c.last_name}`,
          first_name: c.first_name,
          last_name: c.last_name,
          title: c.title,
          department: c.department,
          email,
          phone: ACCOUNTS[i]?.phone ?? '',
          account: accountId,
          lead_source: c.lead_source,
        },
      });
      contactIds.push({ id: created.id, accountId });
    }
  }

  // Deals (3 per account = 36 total)
  // Mix: 1 closed_won (renewal), 1 in-flight, 1 early-stage. Stages rotate so
  // the pipeline picklist breakdown has spread.
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i];
    if (!accountId) continue;
    const accountName = ACCOUNTS[i]?.name ?? 'Account';
    const accountContacts = contactIds.filter((c) => c.accountId === accountId);
    for (let j = 0; j < 3; j++) {
      const stage =
        j === 0 ? 'closed_won' : (STAGES[(i + j) % (STAGES.length - 2)] ?? 'prospecting');
      const closed = stage === 'closed_won' || stage === 'closed_lost';
      const won = stage === 'closed_won';
      const amount = 15_000 + ((i * 5 + j * 13) % 12) * 12_500;
      const probability = won
        ? 100
        : stage === 'closed_lost'
          ? 0
          : Math.min(85, 15 + j * 25 + i * 3);
      const dueDays = closed ? -30 - i * 4 - j * 7 : 14 + j * 30;
      const primary = accountContacts[j % accountContacts.length];
      await createRecord(db, {
        orgId: organizationId,
        object: dealObj.object,
        fields: dealObj.fields,
        data: {
          name: `${accountName} — ${won ? 'Scale renewal' : j === 1 ? 'Expansion' : 'Pilot'} ${2026 - j}`,
          account: accountId,
          primary_contact: primary?.id ?? null,
          stage,
          amount,
          probability,
          close_date: isoOffsetDate(dueDays),
          type: won ? 'renewal' : 'new_business',
          lead_source: j === 0 ? 'referral' : 'web',
          forecast_category: won ? 'closed' : j === 1 ? 'commit' : 'best_case',
          next_step: won
            ? 'PO received'
            : j === 1
              ? 'Send pricing breakdown'
              : 'Schedule technical deep-dive',
          description: won
            ? 'Renewal closed-won — auto-converts at renewal date.'
            : j === 1
              ? 'Expansion into adjacent BU. Buyer wants ROI deck + reference call.'
              : 'Early-stage pilot. Discovery in flight; sizing the seat count.',
        },
      });
    }
  }

  // Activities (~3 per contact × 60 contacts = ~180 total)
  // Mix of types/priorities/status to drive pipeline + activity dashboards.
  for (let i = 0; i < contactIds.length; i++) {
    const c = contactIds[i];
    if (!c) continue;
    for (let j = 0; j < 3; j++) {
      const type = ACTIVITY_TYPES[(i + j) % ACTIVITY_TYPES.length] ?? 'task';
      const priority = PRIORITIES[(i + j * 2) % PRIORITIES.length] ?? 'normal';
      const subjects = ACTIVITY_SUBJECTS[type];
      const subject = subjects[(i + j) % subjects.length] ?? `${type} follow-up`;
      const dueOffsetDays = ((i * 3 + j * 5) % 21) - 7; // -7 to +13 days
      const status = dueOffsetDays < -2 ? 'completed' : j === 0 ? 'open' : 'open';
      await createRecord(db, {
        orgId: organizationId,
        object: activityObj.object,
        fields: activityObj.fields,
        data: {
          subject,
          type,
          status,
          priority,
          contact: c.id,
          related_account: c.accountId,
          due_date: isoOffsetDatetime(dueOffsetDays),
          duration: type === 'call' ? 30 : type === 'meeting' ? 60 : type === 'email' ? 10 : 20,
          notes: 'Auto-seeded sample activity. Replace or delete freely.',
        },
      });
    }
  }
}
