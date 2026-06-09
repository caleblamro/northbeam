// Standard CRM objects + fields, seeded into every workspace as `isSystem`
// object defs. These are the canonical targets that Salesforce standard objects
// map onto (Account→account, Contact→contact, Opportunity→deal, Task/Event→
// activity). Custom SF objects/fields create their own defs alongside these.

import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import type { FieldConfig, FieldType, ObjectLayout } from './field-types.js';
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

const STAGE_OPTIONS = [
  { value: 'new', label: 'New', color: '#8792a2' },
  { value: 'qualified', label: 'Qualified', color: '#3d5afe' },
  { value: 'negotiation', label: 'Negotiation', color: '#9a6800' },
  { value: 'won', label: 'Closed won', color: '#117a52' },
  { value: 'lost', label: 'Closed lost', color: '#df1b41' },
];

export const STANDARD_OBJECTS: SeedObject[] = [
  {
    key: 'account',
    label: 'Account',
    labelPlural: 'Accounts',
    icon: 'buildings',
    color: '#635bff',
    description: 'Companies you do business with.',
    fields: [
      { key: 'name', label: 'Account name', type: 'text', required: true },
      { key: 'website', label: 'Website', type: 'url' },
      {
        key: 'industry',
        label: 'Industry',
        type: 'picklist',
        config: {
          options: [
            { value: 'manufacturing', label: 'Manufacturing' },
            { value: 'ai', label: 'AI / ML' },
            { value: 'logistics', label: 'Logistics' },
            { value: 'healthcare', label: 'Healthcare' },
            { value: 'retail', label: 'Retail' },
            { value: 'edtech', label: 'EdTech' },
            { value: 'other', label: 'Other' },
          ],
        },
      },
      { key: 'employees', label: 'Employees', type: 'number' },
      {
        key: 'annual_revenue',
        label: 'Annual revenue',
        type: 'currency',
        config: { currencyCode: 'USD' },
      },
      { key: 'phone', label: 'Phone', type: 'phone' },
      {
        key: 'plan',
        label: 'Plan',
        type: 'picklist',
        config: {
          options: [
            { value: 'enterprise', label: 'Enterprise' },
            { value: 'midmarket', label: 'Mid-market' },
            { value: 'startup', label: 'Startup' },
          ],
        },
      },
    ],
    layout: {
      compactKeys: ['industry', 'plan', 'phone'],
      statKeys: ['annual_revenue', 'employees'],
      listColumns: ['industry', 'plan', 'employees', 'annual_revenue', 'phone'],
      sections: [
        {
          id: 'about',
          label: 'Account information',
          cols: 2,
          fields: ['name', 'website', 'industry', 'plan'],
        },
        {
          id: 'firmographics',
          label: 'Firmographics',
          cols: 2,
          fields: ['employees', 'annual_revenue', 'phone'],
        },
      ],
    },
  },
  {
    key: 'contact',
    label: 'Contact',
    labelPlural: 'Contacts',
    icon: 'user',
    color: '#0ea5e9',
    description: 'People at your accounts.',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text' },
      { key: 'last_name', label: 'Last name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'title', label: 'Title', type: 'text' },
      {
        key: 'account',
        label: 'Account',
        type: 'reference',
        config: { targetObject: 'account', relationshipName: 'contacts' },
      },
      { key: 'stage', label: 'Stage', type: 'picklist', config: { options: STAGE_OPTIONS } },
    ],
    layout: {
      compactKeys: ['title', 'email', 'phone'],
      listColumns: ['email', 'account', 'title', 'stage'],
      sections: [
        {
          id: 'identity',
          label: 'Contact information',
          cols: 2,
          fields: ['first_name', 'last_name', 'email', 'phone', 'title'],
        },
        { id: 'relationship', label: 'Relationship', cols: 2, fields: ['account', 'stage'] },
      ],
    },
  },
  {
    key: 'deal',
    label: 'Deal',
    labelPlural: 'Deals',
    icon: 'currency-circle-dollar',
    color: '#10b981',
    description: 'Opportunities in your pipeline.',
    fields: [
      { key: 'name', label: 'Deal name', type: 'text', required: true },
      {
        key: 'account',
        label: 'Account',
        type: 'reference',
        config: { targetObject: 'account', relationshipName: 'deals' },
      },
      { key: 'amount', label: 'Amount', type: 'currency', config: { currencyCode: 'USD' } },
      { key: 'stage', label: 'Stage', type: 'picklist', config: { options: STAGE_OPTIONS } },
      { key: 'close_date', label: 'Close date', type: 'date' },
      { key: 'probability', label: 'Probability', type: 'percent' },
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
          fields: ['name', 'account', 'stage'],
        },
        {
          id: 'forecast',
          label: 'Forecast',
          cols: 2,
          fields: ['amount', 'probability', 'close_date'],
        },
      ],
    },
  },
  {
    key: 'activity',
    label: 'Activity',
    labelPlural: 'Activities',
    icon: 'lightning',
    color: '#f59e0b',
    description: 'Calls, emails, notes, and meetings.',
    fields: [
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      {
        key: 'type',
        label: 'Type',
        type: 'picklist',
        config: {
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
        key: 'contact',
        label: 'Contact',
        type: 'reference',
        config: { targetObject: 'contact', relationshipName: 'activities' },
      },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'due_date', label: 'Due date', type: 'datetime' },
    ],
    layout: {
      compactKeys: ['type', 'contact', 'due_date'],
      listColumns: ['type', 'contact', 'due_date'],
      sections: [
        {
          id: 'detail',
          label: 'Activity',
          cols: 2,
          fields: ['subject', 'type', 'contact', 'due_date'],
        },
        { id: 'body', label: 'Notes', cols: 1, fields: ['notes'] },
      ],
    },
  },
];

/** Idempotently seed the standard objects + fields for an org. Safe to re-run. */
export async function seedStandardObjects(db: Database, organizationId: string): Promise<void> {
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
      // Backfill layout for orgs seeded before the layout column existed.
      await db.update(objectDef).set({ layout: obj.layout }).where(eq(objectDef.id, objectId));
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
  }
}
