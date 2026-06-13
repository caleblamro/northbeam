// Standard CRM objects + fields, seeded into every workspace as `isSystem`
// object defs. These are the canonical targets that Salesforce standard objects
// map onto (Account→account, Contact→contact, Opportunity→deal, Task/Event→
// activity). Custom SF objects/fields create their own defs alongside these.
//
// Every field is typed per its Salesforce equivalent and carries Directus-style
// `description` (above the input), `placeholder` (inside the input), and
// `helpText` (below the input) where useful. This is the source of truth a SF
// migration maps onto — keep the field types as close to SF as we can.

import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { createObjectTable, ensureSchema } from './dynamic/ddl.js';
import { fieldColumnName, objectTableName } from './dynamic/identifiers.js';
import { pgTypeFor } from './dynamic/pgtypes.js';
import type { FieldConfig, FieldType, ObjectLayout, PicklistOption } from './field-types.js';
import { getObjectByKey } from './queries/crm.js';
import { fieldDef, objectDef } from './schema.js';

type SeedField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  config?: FieldConfig;
};
type SeedObject = {
  key: string;
  label: string;
  labelPlural: string;
  icon: string;
  color: string;
  description: string;
  fields: SeedField[];
  layout: ObjectLayout;
};

/* ── shared picklists ─────────────────────────────────────────────────────── */

const STAGE_OPTIONS: PicklistOption[] = [
  { value: 'prospecting', label: 'Prospecting', color: '#8792a2' },
  { value: 'qualification', label: 'Qualification', color: '#8792a2' },
  { value: 'needs_analysis', label: 'Needs analysis', color: '#3d5afe' },
  { value: 'proposal', label: 'Proposal / quote', color: '#3d5afe' },
  { value: 'negotiation', label: 'Negotiation', color: '#9a6800' },
  { value: 'closed_won', label: 'Closed won', color: '#117a52' },
  { value: 'closed_lost', label: 'Closed lost', color: '#df1b41' },
];

const LEAD_SOURCE_OPTIONS: PicklistOption[] = [
  { value: 'web', label: 'Web' },
  { value: 'phone_inquiry', label: 'Phone inquiry' },
  { value: 'partner', label: 'Partner referral' },
  { value: 'referral', label: 'Customer referral' },
  { value: 'trade_show', label: 'Trade show' },
  { value: 'employee', label: 'Employee referral' },
  { value: 'external', label: 'External referral' },
  { value: 'other', label: 'Other' },
];

const SALUTATION_OPTIONS: PicklistOption[] = [
  { value: 'mr', label: 'Mr.' },
  { value: 'mrs', label: 'Mrs.' },
  { value: 'ms', label: 'Ms.' },
  { value: 'dr', label: 'Dr.' },
  { value: 'prof', label: 'Prof.' },
];

const RATING_OPTIONS: PicklistOption[] = [
  { value: 'hot', label: 'Hot', color: '#df1b41' },
  { value: 'warm', label: 'Warm', color: '#9a6800' },
  { value: 'cold', label: 'Cold', color: '#3d5afe' },
];

/* ── standard objects ─────────────────────────────────────────────────────── */

export const STANDARD_OBJECTS: SeedObject[] = [
  /* ───────────────────────────── ACCOUNT ───────────────────────────── */
  {
    key: 'account',
    label: 'Account',
    labelPlural: 'Accounts',
    icon: 'buildings',
    color: '#635bff',
    description: 'Companies you do business with.',
    fields: [
      {
        key: 'name',
        label: 'Account name',
        type: 'text',
        required: true,
        config: {
          placeholder: 'Acme Corp',
          description: 'The company name as you want it to appear everywhere.',
        },
      },
      {
        key: 'website',
        label: 'Website',
        type: 'url',
        config: {
          placeholder: 'https://acme.com',
        },
      },
      {
        key: 'type',
        label: 'Type',
        type: 'picklist',
        config: {
          description: 'Where this account is in its lifecycle with you.',
          options: [
            { value: 'prospect', label: 'Prospect' },
            { value: 'customer', label: 'Customer' },
            { value: 'partner', label: 'Partner' },
            { value: 'vendor', label: 'Vendor' },
            { value: 'reseller', label: 'Reseller' },
            { value: 'other', label: 'Other' },
          ],
        },
      },
      {
        key: 'industry',
        label: 'Industry',
        type: 'picklist',
        config: {
          options: [
            { value: 'agriculture', label: 'Agriculture' },
            { value: 'apparel', label: 'Apparel' },
            { value: 'banking', label: 'Banking' },
            { value: 'biotechnology', label: 'Biotechnology' },
            { value: 'chemicals', label: 'Chemicals' },
            { value: 'communications', label: 'Communications' },
            { value: 'construction', label: 'Construction' },
            { value: 'consulting', label: 'Consulting' },
            { value: 'education', label: 'Education' },
            { value: 'electronics', label: 'Electronics' },
            { value: 'energy', label: 'Energy' },
            { value: 'engineering', label: 'Engineering' },
            { value: 'entertainment', label: 'Entertainment' },
            { value: 'finance', label: 'Finance' },
            { value: 'food_beverage', label: 'Food & beverage' },
            { value: 'government', label: 'Government' },
            { value: 'healthcare', label: 'Healthcare' },
            { value: 'hospitality', label: 'Hospitality' },
            { value: 'insurance', label: 'Insurance' },
            { value: 'logistics', label: 'Logistics' },
            { value: 'manufacturing', label: 'Manufacturing' },
            { value: 'media', label: 'Media' },
            { value: 'nonprofit', label: 'Not for profit' },
            { value: 'real_estate', label: 'Real estate' },
            { value: 'retail', label: 'Retail' },
            { value: 'software', label: 'Software' },
            { value: 'technology', label: 'Technology' },
            { value: 'telecommunications', label: 'Telecommunications' },
            { value: 'transportation', label: 'Transportation' },
            { value: 'other', label: 'Other' },
          ],
        },
      },
      {
        key: 'rating',
        label: 'Rating',
        type: 'picklist',
        config: {
          description: 'A quick read on how qualified this account is.',
          options: RATING_OPTIONS,
        },
      },
      {
        key: 'account_source',
        label: 'Source',
        type: 'picklist',
        config: {
          description: 'How this account came to you.',
          options: LEAD_SOURCE_OPTIONS,
        },
      },
      {
        key: 'employees',
        label: 'Employees',
        type: 'number',
        config: {
          placeholder: '100',
          helpText: 'Headcount across the entire company.',
        },
      },
      {
        key: 'annual_revenue',
        label: 'Annual revenue',
        type: 'currency',
        config: {
          currencyCode: 'USD',
          placeholder: '1,000,000',
        },
      },
      {
        key: 'phone',
        label: 'Phone',
        type: 'phone',
        config: { placeholder: '(555) 123-4567' },
      },
      {
        key: 'fax',
        label: 'Fax',
        type: 'phone',
        config: { placeholder: '(555) 123-4568' },
      },
      {
        key: 'account_number',
        label: 'Account number',
        type: 'text',
        config: { helpText: 'Your internal identifier for this account.' },
      },
      {
        key: 'ticker_symbol',
        label: 'Ticker symbol',
        type: 'text',
        config: { placeholder: 'NYSE: ACME' },
      },
      {
        key: 'parent_account',
        label: 'Parent account',
        type: 'reference',
        config: {
          targetObject: 'account',
          relationshipName: 'child_accounts',
          description: 'Use this when this account rolls up to a holding company or parent org.',
        },
      },
      // Billing address
      { key: 'billing_street', label: 'Billing street', type: 'text', config: { placeholder: '500 Howard St' } },
      { key: 'billing_city', label: 'Billing city', type: 'text', config: { placeholder: 'San Francisco' } },
      { key: 'billing_state', label: 'Billing state / province', type: 'text', config: { placeholder: 'CA' } },
      { key: 'billing_postal_code', label: 'Billing postal code', type: 'text', config: { placeholder: '94105' } },
      { key: 'billing_country', label: 'Billing country', type: 'text', config: { placeholder: 'United States' } },
      // Shipping address
      { key: 'shipping_street', label: 'Shipping street', type: 'text' },
      { key: 'shipping_city', label: 'Shipping city', type: 'text' },
      { key: 'shipping_state', label: 'Shipping state / province', type: 'text' },
      { key: 'shipping_postal_code', label: 'Shipping postal code', type: 'text' },
      { key: 'shipping_country', label: 'Shipping country', type: 'text' },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        config: {
          placeholder: 'What this account does, why they buy, who decides…',
          helpText: 'Free-form context that the rest of the team should know.',
        },
      },
    ],
    layout: {
      compactKeys: ['industry', 'type', 'phone'],
      statKeys: ['annual_revenue', 'employees'],
      listColumns: ['industry', 'type', 'employees', 'annual_revenue', 'phone'],
      sections: [
        {
          id: 'about',
          label: 'Account information',
          cols: 2,
          fields: ['name', 'website', 'type', 'industry', 'rating', 'account_source'],
        },
        {
          id: 'firmographics',
          label: 'Firmographics',
          cols: 2,
          fields: ['employees', 'annual_revenue', 'phone', 'fax', 'ticker_symbol', 'account_number'],
        },
        { id: 'hierarchy', label: 'Hierarchy', cols: 1, fields: ['parent_account'] },
        {
          id: 'billing',
          label: 'Billing address',
          cols: 2,
          fields: ['billing_street', 'billing_city', 'billing_state', 'billing_postal_code', 'billing_country'],
        },
        {
          id: 'shipping',
          label: 'Shipping address',
          cols: 2,
          fields: ['shipping_street', 'shipping_city', 'shipping_state', 'shipping_postal_code', 'shipping_country'],
        },
        { id: 'notes', label: 'Description', cols: 1, fields: ['description'] },
      ],
    },
  },

  /* ───────────────────────────── CONTACT ───────────────────────────── */
  {
    key: 'contact',
    label: 'Contact',
    labelPlural: 'Contacts',
    icon: 'user',
    color: '#0ea5e9',
    description: 'People at your accounts.',
    fields: [
      {
        key: 'salutation',
        label: 'Salutation',
        type: 'picklist',
        config: { options: SALUTATION_OPTIONS, helpText: 'Optional title prefix.' },
      },
      {
        key: 'first_name',
        label: 'First name',
        type: 'text',
        config: { placeholder: 'Marcus' },
      },
      {
        key: 'last_name',
        label: 'Last name',
        type: 'text',
        required: true,
        config: { placeholder: 'Chen' },
      },
      {
        key: 'title',
        label: 'Title',
        type: 'text',
        config: { placeholder: 'VP of Sales' },
      },
      {
        key: 'department',
        label: 'Department',
        type: 'text',
        config: { placeholder: 'Sales' },
      },
      {
        key: 'account',
        label: 'Account',
        type: 'reference',
        config: {
          targetObject: 'account',
          relationshipName: 'contacts',
          description: 'The company this person works at.',
        },
      },
      {
        key: 'reports_to',
        label: 'Reports to',
        type: 'reference',
        config: {
          targetObject: 'contact',
          relationshipName: 'direct_reports',
          description: 'This contact\'s manager. Used to build the org chart.',
        },
      },
      {
        key: 'email',
        label: 'Email',
        type: 'email',
        config: { placeholder: 'marcus@acme.com' },
      },
      {
        key: 'phone',
        label: 'Phone',
        type: 'phone',
        config: { placeholder: '(555) 123-4567' },
      },
      {
        key: 'mobile_phone',
        label: 'Mobile phone',
        type: 'phone',
        config: { placeholder: '(555) 555-1212' },
      },
      {
        key: 'fax',
        label: 'Fax',
        type: 'phone',
      },
      {
        key: 'birthdate',
        label: 'Birthdate',
        type: 'date',
        config: { helpText: 'Used for relationship-building moments.' },
      },
      {
        key: 'lead_source',
        label: 'Lead source',
        type: 'picklist',
        config: {
          description: 'How this contact first entered your pipeline.',
          options: LEAD_SOURCE_OPTIONS,
        },
      },
      // Mailing address
      { key: 'mailing_street', label: 'Mailing street', type: 'text' },
      { key: 'mailing_city', label: 'Mailing city', type: 'text' },
      { key: 'mailing_state', label: 'Mailing state / province', type: 'text' },
      { key: 'mailing_postal_code', label: 'Mailing postal code', type: 'text' },
      { key: 'mailing_country', label: 'Mailing country', type: 'text' },
      // Other address (assistant / home etc.)
      { key: 'other_street', label: 'Other street', type: 'text' },
      { key: 'other_city', label: 'Other city', type: 'text' },
      { key: 'other_state', label: 'Other state / province', type: 'text' },
      { key: 'other_postal_code', label: 'Other postal code', type: 'text' },
      { key: 'other_country', label: 'Other country', type: 'text' },
      {
        key: 'do_not_call',
        label: 'Do not call',
        type: 'checkbox',
        config: { helpText: 'Respect this contact\'s opt-out for phone outreach.' },
      },
      {
        key: 'email_opt_out',
        label: 'Email opt-out',
        type: 'checkbox',
        config: { helpText: 'Respect this contact\'s opt-out for email outreach.' },
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        config: {
          placeholder: 'Background, interests, who they know on your team…',
        },
      },
    ],
    layout: {
      compactKeys: ['title', 'email', 'phone'],
      listColumns: ['email', 'account', 'title', 'phone'],
      sections: [
        {
          id: 'identity',
          label: 'Contact information',
          cols: 2,
          fields: ['salutation', 'first_name', 'last_name', 'title', 'department'],
        },
        {
          id: 'relationship',
          label: 'Relationship',
          cols: 2,
          fields: ['account', 'reports_to', 'lead_source'],
        },
        {
          id: 'reach',
          label: 'Contact details',
          cols: 2,
          fields: ['email', 'phone', 'mobile_phone', 'fax', 'birthdate'],
        },
        {
          id: 'mailing',
          label: 'Mailing address',
          cols: 2,
          fields: ['mailing_street', 'mailing_city', 'mailing_state', 'mailing_postal_code', 'mailing_country'],
        },
        {
          id: 'other_address',
          label: 'Other address',
          cols: 2,
          fields: ['other_street', 'other_city', 'other_state', 'other_postal_code', 'other_country'],
        },
        {
          id: 'preferences',
          label: 'Communication preferences',
          cols: 2,
          fields: ['do_not_call', 'email_opt_out'],
        },
        { id: 'notes', label: 'Description', cols: 1, fields: ['description'] },
      ],
    },
  },

  /* ───────────────────────────── DEAL (Opportunity) ───────────────────────────── */
  {
    key: 'deal',
    label: 'Deal',
    labelPlural: 'Deals',
    icon: 'currency-circle-dollar',
    color: '#10b981',
    description: 'Opportunities in your pipeline.',
    fields: [
      {
        key: 'name',
        label: 'Deal name',
        type: 'text',
        required: true,
        config: { placeholder: 'Acme — Platform expansion' },
      },
      {
        key: 'account',
        label: 'Account',
        type: 'reference',
        config: {
          targetObject: 'account',
          relationshipName: 'deals',
          description: 'The company this deal belongs to.',
        },
      },
      {
        key: 'primary_contact',
        label: 'Primary contact',
        type: 'reference',
        config: {
          targetObject: 'contact',
          relationshipName: 'deals',
          description: 'The main champion or decision-maker.',
        },
      },
      {
        key: 'stage',
        label: 'Stage',
        type: 'picklist',
        required: true,
        config: { description: 'Where this deal is in the sales process.', options: STAGE_OPTIONS },
      },
      {
        key: 'amount',
        label: 'Amount',
        type: 'currency',
        config: {
          currencyCode: 'USD',
          placeholder: '50,000',
          description: 'Annualised contract value or one-time deal size.',
        },
      },
      {
        key: 'probability',
        label: 'Probability',
        type: 'percent',
        config: {
          placeholder: '50',
          helpText: 'Chance of closing this deal — usually inferred from stage.',
        },
      },
      {
        key: 'close_date',
        label: 'Close date',
        type: 'date',
        required: true,
        config: { description: 'When you expect this deal to close.' },
      },
      {
        key: 'type',
        label: 'Type',
        type: 'picklist',
        config: {
          options: [
            { value: 'new_business', label: 'New business' },
            { value: 'existing_business', label: 'Existing business' },
            { value: 'renewal', label: 'Renewal' },
            { value: 'expansion', label: 'Expansion' },
            { value: 'downsell', label: 'Downsell' },
          ],
        },
      },
      {
        key: 'lead_source',
        label: 'Lead source',
        type: 'picklist',
        config: { options: LEAD_SOURCE_OPTIONS },
      },
      {
        key: 'forecast_category',
        label: 'Forecast category',
        type: 'picklist',
        config: {
          description: 'Which forecast bucket this deal lands in.',
          options: [
            { value: 'pipeline', label: 'Pipeline' },
            { value: 'best_case', label: 'Best case' },
            { value: 'commit', label: 'Commit' },
            { value: 'closed', label: 'Closed' },
            { value: 'omitted', label: 'Omitted' },
          ],
        },
      },
      {
        key: 'next_step',
        label: 'Next step',
        type: 'text',
        config: {
          placeholder: 'Send a revised proposal by Friday',
          helpText: 'The single most-important next action.',
        },
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        config: {
          placeholder: 'Deal context, history, who is involved on both sides…',
        },
      },
    ],
    layout: {
      compactKeys: ['account', 'stage', 'close_date'],
      statKeys: ['amount', 'probability'],
      listColumns: ['account', 'amount', 'stage', 'close_date', 'probability'],
      sections: [
        {
          id: 'overview',
          label: 'Deal information',
          cols: 2,
          fields: ['name', 'account', 'primary_contact', 'stage'],
        },
        {
          id: 'forecast',
          label: 'Forecast',
          cols: 2,
          fields: ['amount', 'probability', 'close_date', 'forecast_category'],
        },
        {
          id: 'classification',
          label: 'Classification',
          cols: 2,
          fields: ['type', 'lead_source'],
        },
        { id: 'action', label: 'Next step', cols: 1, fields: ['next_step'] },
        { id: 'notes', label: 'Description', cols: 1, fields: ['description'] },
      ],
    },
  },

  /* ───────────────────────────── ACTIVITY (Task / Event) ───────────────────────────── */
  {
    key: 'activity',
    label: 'Activity',
    labelPlural: 'Activities',
    icon: 'lightning',
    color: '#f59e0b',
    description: 'Calls, emails, notes, meetings, and tasks.',
    fields: [
      {
        key: 'subject',
        label: 'Subject',
        type: 'text',
        required: true,
        config: { placeholder: 'Discovery call with Marcus' },
      },
      {
        key: 'type',
        label: 'Type',
        type: 'picklist',
        required: true,
        config: {
          description: 'What kind of activity this is.',
          options: [
            { value: 'call', label: 'Call' },
            { value: 'email', label: 'Email' },
            { value: 'note', label: 'Note' },
            { value: 'meeting', label: 'Meeting' },
            { value: 'task', label: 'Task' },
          ],
        },
      },
      {
        key: 'status',
        label: 'Status',
        type: 'picklist',
        config: {
          options: [
            { value: 'not_started', label: 'Not started' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'waiting', label: 'Waiting on someone else' },
            { value: 'completed', label: 'Completed' },
            { value: 'deferred', label: 'Deferred' },
          ],
        },
      },
      {
        key: 'priority',
        label: 'Priority',
        type: 'picklist',
        config: {
          options: [
            { value: 'high', label: 'High', color: '#df1b41' },
            { value: 'normal', label: 'Normal' },
            { value: 'low', label: 'Low', color: '#8792a2' },
          ],
        },
      },
      {
        key: 'contact',
        label: 'Contact',
        type: 'reference',
        config: {
          targetObject: 'contact',
          relationshipName: 'activities',
          description: 'The person this activity is with or about.',
        },
      },
      {
        key: 'related_deal',
        label: 'Related deal',
        type: 'reference',
        config: {
          targetObject: 'deal',
          relationshipName: 'activities',
          description: 'The deal this activity advances.',
        },
      },
      {
        key: 'related_account',
        label: 'Related account',
        type: 'reference',
        config: {
          targetObject: 'account',
          relationshipName: 'activities',
        },
      },
      {
        key: 'due_date',
        label: 'Due date',
        type: 'datetime',
        config: { description: 'When this activity is due — or when it happened.' },
      },
      {
        key: 'reminder',
        label: 'Reminder',
        type: 'datetime',
        config: { helpText: 'Notify the owner at this time.' },
      },
      {
        key: 'duration_minutes',
        label: 'Duration',
        type: 'number',
        config: {
          placeholder: '30',
          helpText: 'Length in minutes (for calls + meetings).',
        },
      },
      {
        key: 'notes',
        label: 'Notes',
        type: 'textarea',
        config: {
          placeholder: 'Key takeaways, next steps, who said what…',
        },
      },
    ],
    layout: {
      compactKeys: ['type', 'contact', 'due_date'],
      listColumns: ['type', 'contact', 'status', 'priority', 'due_date'],
      sections: [
        {
          id: 'detail',
          label: 'Activity',
          cols: 2,
          fields: ['subject', 'type', 'status', 'priority'],
        },
        {
          id: 'related',
          label: 'Related to',
          cols: 2,
          fields: ['contact', 'related_deal', 'related_account'],
        },
        {
          id: 'timing',
          label: 'Timing',
          cols: 2,
          fields: ['due_date', 'reminder', 'duration_minutes'],
        },
        { id: 'body', label: 'Notes', cols: 1, fields: ['notes'] },
      ],
    },
  },
];

/** Idempotently seed the standard objects + fields for an org, and create their
 *  physical tables in the org's Postgres schema. Safe to re-run. */
export async function seedStandardObjects(db: Database, organizationId: string): Promise<void> {
  await ensureSchema(db, organizationId);
  for (const obj of STANDARD_OBJECTS) {
    const [existing] = await db
      .select({ id: objectDef.id })
      .from(objectDef)
      .where(and(eq(objectDef.organizationId, organizationId), eq(objectDef.key, obj.key)))
      .limit(1);

    let objectId = existing?.id;
    if (!objectId) {
      const [inserted] = await db
        .insert(objectDef)
        .values({
          organizationId,
          key: obj.key,
          tableName: objectTableName(obj.key),
          label: obj.label,
          labelPlural: obj.labelPlural,
          icon: obj.icon,
          color: obj.color,
          description: obj.description,
          layout: obj.layout,
          isSystem: true,
          source: 'system',
        })
        .returning({ id: objectDef.id });
      objectId = inserted?.id;
    } else {
      // Backfill layout + table name for orgs seeded before those columns existed.
      await db
        .update(objectDef)
        .set({ layout: obj.layout, tableName: objectTableName(obj.key) })
        .where(eq(objectDef.id, objectId));
    }
    if (!objectId) continue;

    let order = 0;
    for (const f of obj.fields) {
      await db
        .insert(fieldDef)
        .values({
          organizationId,
          objectId,
          key: f.key,
          columnName: fieldColumnName(f.key),
          pgType: pgTypeFor(f.type, f.config ?? {}),
          label: f.label,
          type: f.type,
          config: f.config ?? {},
          required: f.required ?? false,
          isSystem: true,
          source: 'system',
          orderIndex: order++,
        })
        .onConflictDoNothing();
    }

    // Create the object's physical table from the persisted defs.
    const seeded = await getObjectByKey(db, organizationId, obj.key);
    if (seeded) await createObjectTable(db, organizationId, seeded.object, seeded.fields);
  }
}
