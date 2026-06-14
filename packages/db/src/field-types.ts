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
    // Marked unavailable until the per-(org,object,field) sequence engine ships.
    unavailable: true,
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
  //
  // These three are recognised by the data layer (storage/coercion/DDL) but no
  // compute engine populates them yet. Marking them `unavailable` hides them
  // from the field-picker so a customer can't create one and see `null`. The
  // type stays in the union so any already-imported SF formula/rollup field
  // continues to render its existing value. Once docs/architecture-plan.md §A0
  // (compute engine) ships, drop the flag.
  {
    id: 'formula',
    label: 'Formula',
    icon: 'function',
    group: 'Advanced',
    storage: 'computed',
    unavailable: true,
  },
  {
    id: 'rollup',
    label: 'Roll-up summary',
    icon: 'sigma',
    group: 'Advanced',
    storage: 'computed',
    unavailable: true,
  },
  {
    id: 'ai',
    label: 'AI field',
    icon: 'sparkle',
    group: 'Advanced',
    storage: 'computed',
    unavailable: true,
  },
] as const;

export type FieldType = (typeof FIELD_TYPES)[number]['id'];
/** How the value is physically stored inside record.data (JSONB). */
export type FieldStorage = (typeof FIELD_TYPES)[number]['storage'];

export const FIELD_TYPE_IDS = FIELD_TYPES.map((f) => f.id) as [FieldType, ...FieldType[]];

/** Only the field types a user can actively pick when creating a custom field.
 *  Filters out types that exist in the union (for back-compat with already-
 *  imported data) but aren't yet supported end-to-end. */
export const PICKABLE_FIELD_TYPES = FIELD_TYPES.filter(
  (f) => !('unavailable' in f && f.unavailable),
);

export function fieldTypeMeta(id: FieldType) {
  return FIELD_TYPES.find((f) => f.id === id) ?? FIELD_TYPES[0];
}

/** True if the type is recognised but not yet supported (no engine populates it). */
export function isFieldTypeAvailable(id: FieldType): boolean {
  const meta = FIELD_TYPES.find((f) => f.id === id);
  return Boolean(meta && !('unavailable' in meta && meta.unavailable));
}

export type PicklistOption = { value: string; label: string; color?: string };
export type RollupFn = 'sum' | 'count' | 'avg' | 'min' | 'max';

/** Display semantics shared by every config (Directus-style):
 *    - `description`: rendered ABOVE the input as muted explanatory text.
 *    - `placeholder`: rendered INSIDE the input as ghost text.
 *    - `helpText`:    rendered BELOW the input as small muted text.
 *  Plus universal security/provenance flags carried regardless of type. */
export type BaseFieldConfig = {
  description?: string;
  placeholder?: string;
  helpText?: string;
  defaultValue?: unknown;
  /** field-level security: hidden from non-admin roles. */
  confidential?: boolean;
  /** value was an encrypted string in the source system. */
  encrypted?: boolean;
  /** compound-field grouping (e.g. all billing_address subfields share a key). */
  compoundKey?: string;
};

/** text | textarea | email | phone | url */
export type TextFieldConfig = BaseFieldConfig & {
  maxLength?: number;
  /** A user-facing input-mask pattern (e.g. "(999) 999-9999"). Distinct from
   *  the type-level masks (date, datetime) — this lets any text field carry
   *  its own format. See lib/mask.applyMask in apps/web. */
  mask?: string;
};

/** number | percent | autonumber */
export type NumberFieldConfig = BaseFieldConfig & {
  precision?: number;
  /** Currency/percent stored as integer minor units when scale set. */
  scale?: number;
};

/** currency */
export type CurrencyFieldConfig = NumberFieldConfig & {
  /** ISO 4217 code (e.g. 'USD', 'EUR'). Workspace-level default lives on
   *  organization.metadata.defaultCurrency. */
  currencyCode?: string;
};

/** date | datetime */
export type DateFieldConfig = BaseFieldConfig;

/** checkbox */
export type CheckboxFieldConfig = BaseFieldConfig;

/** picklist | multipicklist — `options` is semantically required but kept
 *  optional at the type level so partial in-flight forms compile; runtime
 *  validation rejects an empty picklist via {@link FieldConfigSchemas}. */
export type PicklistFieldConfig = BaseFieldConfig & {
  options?: PicklistOption[];
  restrictToOptions?: boolean;
  /** Controlling field key for dependent picklists (SF controllerName). */
  controllingField?: string;
};

/** reference (lookup) — `targetObject` is semantically required. */
export type ReferenceFieldConfig = BaseFieldConfig & {
  /** object_def.key the lookup points at. */
  targetObject?: string;
  /** reverse name, e.g. account → "contacts" */
  relationshipName?: string;
  onDelete?: 'setNull' | 'cascade' | 'restrict';
};

/** formula — `formula` and `returnType` are semantically required. */
export type FormulaFieldConfig = BaseFieldConfig & {
  formula?: string;
  returnType?: FieldType;
};

/** rollup — `rollup` is semantically required. */
export type RollupFieldConfig = BaseFieldConfig & {
  rollup?: { childObject: string; childField: string; fn: RollupFn; filter?: string };
};

/** ai — `aiPrompt` is semantically required. */
export type AiFieldConfig = BaseFieldConfig & {
  aiPrompt?: string;
};

/** Mapping from FieldType → its semantically-correct config shape. Use with
 *  {@link narrowFieldConfig} or {@link FieldConfigForType} for type-safe access
 *  to type-specific keys without `as` casts. */
export type FieldConfigForType = {
  text: TextFieldConfig;
  textarea: TextFieldConfig;
  email: TextFieldConfig;
  phone: TextFieldConfig;
  url: TextFieldConfig;
  number: NumberFieldConfig;
  currency: CurrencyFieldConfig;
  percent: NumberFieldConfig;
  autonumber: NumberFieldConfig;
  date: DateFieldConfig;
  datetime: DateFieldConfig;
  checkbox: CheckboxFieldConfig;
  picklist: PicklistFieldConfig;
  multipicklist: PicklistFieldConfig;
  reference: ReferenceFieldConfig;
  formula: FormulaFieldConfig;
  rollup: RollupFieldConfig;
  ai: AiFieldConfig;
};

/** The structural union — accepts any key from any type-specific config. Stored
 *  as `field_def.config` (JSONB). Tools that need to *write* a config should
 *  reach for the typed variant ({@link TextFieldConfig}, etc.) so required keys
 *  appear in completions and the variant's runtime validator catches mistakes. */
export type FieldConfig = TextFieldConfig &
  NumberFieldConfig &
  CurrencyFieldConfig &
  PicklistFieldConfig &
  ReferenceFieldConfig &
  FormulaFieldConfig &
  RollupFieldConfig &
  AiFieldConfig;

/** Cast a (FieldType, FieldConfig) pair into the appropriate type-specific
 *  variant. Use at the point of access to read type-specific keys safely:
 *
 *      const cfg = narrowFieldConfig(field.type, field.config);
 *      if (field.type === 'reference') {
 *        cfg.targetObject; // ← typed as string | undefined
 *      }
 *
 *  The cast is structural; the schema-level validation happens at write time
 *  (see Zod schemas in field-config-schemas.ts). */
export function narrowFieldConfig<T extends FieldType>(
  _type: T,
  config: FieldConfig | null | undefined,
): FieldConfigForType[T] {
  return (config ?? {}) as FieldConfigForType[T];
}

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
  encryptedstring: 'text',
  time: 'text',
  anytype: 'text',
  base64: 'text',
  location: 'text',
};

// NOTE for mapper authors: Salesforce `describe` NEVER returns type 'formula' —
// formula fields report their RETURN type (string/double/date/…) with
// `calculated: true`. Always branch on `calculated` before consulting this map,
// or formulas silently import as plain editable fields.

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
