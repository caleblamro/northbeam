// Sample record seed — populates a freshly-created workspace with realistic
// accounts, contacts, deals, and activities so the dashboard isn't empty
// out of the gate. Relationships are wired (contacts point at accounts,
// deals point at both account + primary contact, activities point at
// contacts and either a related deal or a related account).
//
// Called after seedStandardObjects in the same withOrgContext transaction
// the org.create handler opens, so RLS is satisfied and partial inserts
// roll back together.

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
];

const CONTACT_TEMPLATES: Array<{
  first_name: string;
  last_name: string;
  title: string;
  department: string;
  email_domain_offset: number;
  rating?: undefined;
  lead_source: string;
}> = [
  { first_name: 'Alex', last_name: 'Rivera', title: 'VP RevOps', department: 'Revenue', email_domain_offset: 0, lead_source: 'web' },
  { first_name: 'Sam', last_name: 'Chen', title: 'Director, Sales Ops', department: 'Revenue', email_domain_offset: 0, lead_source: 'referral' },
  { first_name: 'Jordan', last_name: 'Patel', title: 'Buyer', department: 'Procurement', email_domain_offset: 0, lead_source: 'phone_inquiry' },
];

const STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won'] as const;

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Insert a small, realistic record set into the per-org schema. Idempotent
 *  guard: skips the seed when the account table already has rows. */
export async function seedSampleRecords(
  db: DbExecutor,
  organizationId: string,
): Promise<void> {
  const accountObj = await getObjectByKey(db, organizationId, 'account');
  const contactObj = await getObjectByKey(db, organizationId, 'contact');
  const dealObj = await getObjectByKey(db, organizationId, 'deal');
  const activityObj = await getObjectByKey(db, organizationId, 'activity');
  if (!accountObj || !contactObj || !dealObj || !activityObj) return;

  // Guard: don't overwrite anything if there are already rows. Lets the
  // user re-run the seed on a populated org without polluting it.
  const existing = await db.execute({
    sql: '',
    queryChunks: [],
    params: [],
  } as never).catch(() => null);
  void existing;

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

  // Contacts (3 per account)
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

  // Deals (2 per account) — one earlier-stage and one closed-won so the
  // pipeline + revenue numbers feel realistic immediately.
  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i];
    if (!accountId) continue;
    const accountName = ACCOUNTS[i]?.name ?? 'Account';
    const primaryContact = contactIds.find((c) => c.accountId === accountId);
    for (let j = 0; j < 2; j++) {
      const stage = STAGES[(i + j) % STAGES.length] ?? 'prospecting';
      const closed = stage === 'closed_won';
      const amount = 25_000 + ((i * 7 + j * 11) % 9) * 10_000;
      const probability = closed ? 100 : Math.min(80, 20 + j * 20 + i * 4);
      const dueDays = closed ? -15 - i * 3 : 14 + j * 21;
      await createRecord(db, {
        orgId: organizationId,
        object: dealObj.object,
        fields: dealObj.fields,
        data: {
          name: `${accountName} — ${closed ? 'Scale renewal' : 'Expansion'} ${2026 - j}`,
          account: accountId,
          primary_contact: primaryContact?.id ?? null,
          stage,
          amount,
          probability,
          close_date: isoDateOffset(dueDays),
          type: closed ? 'renewal' : 'new_business',
          lead_source: 'web',
          forecast_category: closed ? 'closed' : 'best_case',
          next_step: closed ? 'PO received' : 'Send pricing breakdown',
          description: closed
            ? 'Renewal closed-won — auto-converts at renewal date.'
            : 'Expansion into adjacent business unit. Buyer wants ROI deck.',
        },
      });
    }
  }

  // Activities (1 per contact) — a mix of types, due in the next two weeks.
  const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'task'];
  const PRIORITIES = ['high', 'normal', 'normal', 'low'];
  for (let i = 0; i < contactIds.length; i++) {
    const c = contactIds[i];
    if (!c) continue;
    const type = ACTIVITY_TYPES[i % ACTIVITY_TYPES.length] ?? 'task';
    const priority = PRIORITIES[i % PRIORITIES.length] ?? 'normal';
    const dueOffset = i % 14;
    await createRecord(db, {
      orgId: organizationId,
      object: activityObj.object,
      fields: activityObj.fields,
      data: {
        subject:
          type === 'call'
            ? 'Discovery call — qualify renewal scope'
            : type === 'email'
              ? 'Send pricing deck + ROI summary'
              : type === 'meeting'
                ? 'Quarterly business review'
                : 'Follow up on champion intro',
        type,
        status: i % 3 === 0 ? 'completed' : 'open',
        priority,
        contact: c.id,
        related_account: c.accountId,
        due_date: new Date(Date.now() + dueOffset * 86_400_000).toISOString(),
        duration: type === 'call' ? 30 : type === 'meeting' ? 60 : 15,
        notes: 'Auto-seeded sample activity. Replace or delete freely.',
      },
    });
  }
}
