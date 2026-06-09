// The field-type system — the metadata layer's vocabulary. Every field on every
// object (standard or custom, native or Salesforce-imported) is one of these.
//
// Used by:
//   - field_def.type column (packages/db/src/schema.ts)
//   - the object-manager / field-editor UI (type picker, grouped)
//   - the per-type input + display renderers in apps/web
//   - the Salesforce auto-mapper (SF_TYPE_MAP)

export const FIELD_TYPES = [
  // ── Text ──────────────────────────────────────────────────────────────
  { id: 'text', label: 'Text', icon: 'text-aa', group: 'Text', storage: 'text' },
  { id: 'textarea', label: 'Long text', icon: 'text-align-left', group: 'Text', storage: 'text' },
  { id: 'email', label: 'Email', icon: 'envelope-simple', group: 'Text', storage: 'text' },
  { id: 'phone', label: 'Phone', icon: 'phone', group: 'Text', storage: 'text' },
  { id: 'url', label: 'URL', icon: 'link-simple', group: 'Text', storage: 'text' },
  // ── Number ────────────────────────────────────────────────────────────
  { id: 'number', label: 'Number', icon: 'hash', group: 'Number', storage: 'number' },
  {
    id: 'currency',
    label: 'Currency',
    icon: 'currency-circle-dollar',
    group: 'Number',
    storage: 'number',
  },
  { id: 'percent', label: 'Percent', icon: 'percent', group: 'Number', storage: 'number' },
  {
    id: 'autonumber',
    label: 'Auto number',
    icon: 'list-numbers',
    group: 'Number',
    storage: 'number',
  },
  // ── Date & boolean ──────────────────────────────────────────────────────
  { id: 'date', label: 'Date', icon: 'calendar-blank', group: 'Date & time', storage: 'date' },
  { id: 'datetime', label: 'Date / time', icon: 'clock', group: 'Date & time', storage: 'date' },
  { id: 'checkbox', label: 'Checkbox', icon: 'check-square', group: 'Choice', storage: 'bool' },
  // ── Choice ──────────────────────────────────────────────────────────────
  {
    id: 'picklist',
    label: 'Picklist',
    icon: 'caret-circle-down',
    group: 'Choice',
    storage: 'text',
  },
  {
    id: 'multipicklist',
    label: 'Multi-select',
    icon: 'list-checks',
    group: 'Choice',
    storage: 'json',
  },
  // ── Relationship ─────────────────────────────────────────────────────────
  {
    id: 'reference',
    label: 'Lookup',
    icon: 'arrow-bend-up-right',
    group: 'Relationship',
    storage: 'ref',
  },
  // ── Advanced / derived (read-only) ───────────────────────────────────────
  { id: 'formula', label: 'Formula', icon: 'function', group: 'Advanced', storage: 'computed' },
  { id: 'rollup', label: 'Roll-up summary', icon: 'sigma', group: 'Advanced', storage: 'computed' },
  { id: 'ai', label: 'AI field', icon: 'sparkle', group: 'Advanced', storage: 'computed' },
] as const;

export type FieldType = (typeof FIELD_TYPES)[number]['id'];
/** How the value is physically stored inside record.data (JSONB). */
export type FieldStorage = (typeof FIELD_TYPES)[number]['storage'];

export const FIELD_TYPE_IDS = FIELD_TYPES.map((f) => f.id) as [FieldType, ...FieldType[]];

export function fieldTypeMeta(id: FieldType) {
  return FIELD_TYPES.find((f) => f.id === id) ?? FIELD_TYPES[0];
}

export type PicklistOption = { value: string; label: string; color?: string };
export type RollupFn = 'sum' | 'count' | 'avg' | 'min' | 'max';

/** Type-specific configuration, stored as field_def.config (JSONB). All optional;
 *  which keys are meaningful depends on the field type. */
export type FieldConfig = {
  helpText?: string;
  defaultValue?: unknown;
  // text
  maxLength?: number;
  // number / currency / percent
  precision?: number;
  scale?: number; // currency/percent stored as integer minor units when scale set
  currencyCode?: string; // e.g. 'USD'
  // picklist / multipicklist
  options?: PicklistOption[];
  restrictToOptions?: boolean;
  // reference (lookup)
  targetObject?: string; // object_def.key it points at
  relationshipName?: string; // reverse name, e.g. account → "contacts"
  onDelete?: 'setNull' | 'cascade' | 'restrict';
  // formula / rollup / ai (read-only, computed)
  formula?: string;
  returnType?: FieldType;
  rollup?: { childObject: string; childField: string; fn: RollupFn; filter?: string };
  aiPrompt?: string;
};

/** Salesforce SOAP/Metadata field type → our FieldType. Drives the auto-mapper.
 *  Anything unknown falls back to 'text' and gets flagged for review. */
export const SF_TYPE_MAP: Record<string, FieldType> = {
  string: 'text',
  textarea: 'textarea',
  email: 'email',
  phone: 'phone',
  url: 'url',
  picklist: 'picklist',
  multipicklist: 'multipicklist',
  boolean: 'checkbox',
  int: 'number',
  integer: 'number',
  long: 'number',
  double: 'number',
  currency: 'currency',
  percent: 'percent',
  date: 'date',
  datetime: 'datetime',
  reference: 'reference',
  id: 'text',
  formula: 'formula',
  address: 'textarea',
  combobox: 'picklist',
};

export function mapSalesforceType(sfType: string): { type: FieldType; confident: boolean } {
  const t = SF_TYPE_MAP[sfType.toLowerCase()];
  return t ? { type: t, confident: true } : { type: 'text', confident: false };
}

/* ────────────────────────────────────────────────────────────────────────────
   Object layout — drives the record detail page, the sectioned create/edit form,
   and the default list view. Stored as object_def.layout (JSONB). All field
   references are field_def.key values. The Salesforce importer populates this the
   same way the standard-object seed does.
   ────────────────────────────────────────────────────────────────────────── */

export type LayoutSection = {
  id: string;
  label: string;
  /** Grid columns for this section's fields (1 or 2). Defaults to 2. */
  cols?: 1 | 2;
  /** Field keys, in display order. */
  fields: string[];
};

export type ObjectLayout = {
  /** Detail-grid + create/edit sections. */
  sections?: LayoutSection[];
  /** Field keys surfaced in the record highlight header (under the name). */
  compactKeys?: string[];
  /** Field keys shown as big-number tiles in the record stat strip. */
  statKeys?: string[];
  /** Default list-view columns (besides the computed Name). */
  listColumns?: string[];
};
