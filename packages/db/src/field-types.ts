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
  {
    id: 'duration',
    label: 'Duration',
    icon: 'timer',
    group: 'Date & time',
    storage: 'number',
  },
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
  // ── Structured composite ────────────────────────────────────────────────
  {
    id: 'address',
    label: 'Address',
    icon: 'map-pin',
    group: 'Structured',
    storage: 'json',
  },
  // ── Advanced / derived (read-only) ───────────────────────────────────────
  //
  // `formula` is now backed by the engine in src/formula/. `rollup` and `ai`
  // remain inert until their respective workers ship (rollup needs aggregation
  // over a child object; ai needs the LLM worker). Marking the inert ones
  // `unavailable` hides them from the field-picker so a customer can't create
  // one and see `null`. The types stay in the union so already-imported SF
  // formula / rollup fields continue to render their existing value.
  {
    id: 'formula',
    label: 'Formula',
    icon: 'function',
    group: 'Advanced',
    storage: 'computed',
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

/** duration — stored as integer minutes (bigint). The UI accepts loose text
 *  ("1h3m", "90m", "1.5h", "2:30") and writes the canonical minute value. */
export type DurationFieldConfig = BaseFieldConfig & {
  /** Cap on the input value (in minutes). Off by default. */
  maxMinutes?: number;
};

/** address — stored as JSONB matching the AddressValue shape:
 *    { line1, line2, city, region, postal_code, country,
 *      formatted, coordinates: {lat, lng}, mapbox_id }
 *  All keys optional so partial / manually-entered values round-trip cleanly. */
export type AddressFieldConfig = BaseFieldConfig & {
  /** Limit the autocomplete to one or more ISO 3166-1 alpha-2 country codes. */
  countries?: string[];
  /** Override the workspace default — useful for a "shipping" vs "billing"
   *  field on the same object where the rules differ. */
  requireCoordinates?: boolean;
};

/** AddressValue — the JSONB row stored for an `address` field. Mirrors the
 *  shape returned by Mapbox Search Box retrieve, normalized + flattened. */
export type AddressValue = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  formatted?: string;
  coordinates?: { lat: number; lng: number };
  mapbox_id?: string;
};

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
  duration: DurationFieldConfig;
  checkbox: CheckboxFieldConfig;
  picklist: PicklistFieldConfig;
  multipicklist: PicklistFieldConfig;
  reference: ReferenceFieldConfig;
  address: AddressFieldConfig;
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
  DurationFieldConfig &
  AddressFieldConfig &
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
  address: 'address',
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
   Duration helpers — parser/formatter for the `duration` field type. Lives
   here (and not in dynamic/pgtypes) so the web app can import via the public
   `@northbeam/db/field-types` subpath without pulling in drizzle / pg.
   ────────────────────────────────────────────────────────────────────────── */

/** Parse loose duration text into integer minutes. Accepts:
 *    "1h3m", "1h 3m", "1.5h", "90m", "2:30" (h:m), "150" (raw minutes),
 *    "2 hours 30 minutes". Returns null when nothing parses. */
export function parseDurationMinutes(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const colon = s.match(/^(\d+):([0-5]?\d)$/);
  if (colon && colon[1] && colon[2]) {
    return Number(colon[1]) * 60 + Number(colon[2]);
  }

  const hMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?|hr)/);
  const mMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:m(?:in(?:utes?)?)?)/);
  if (hMatch || mMatch) {
    const h = hMatch?.[1] ? Number(hMatch[1]) : 0;
    const m = mMatch?.[1] ? Number(mMatch[1]) : 0;
    const total = h * 60 + m;
    return Number.isFinite(total) ? total : null;
  }

  const bare = Number(s);
  if (Number.isFinite(bare)) return Math.round(bare);

  return null;
}

/** Format integer minutes as "1h 30m" / "1h" / "30m". Returns "" for 0/null. */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Record value schema — emits a Zod schema for the *values* a record can hold
   from a FieldDef[]. Distinct from the FieldConfigSchemas in
   field-config-schemas.ts (which validate the *config* of a field
   definition). This one is what the create/edit form uses on the client +
   what the API should run on insert/update once server-side write
   validation moves to a single source of truth.

   Permissive by default — every field is nullable unless `required`. Type
   checks happen; complex per-config rules (min/max, regex masks) get layered
   in as the field-editor surface stabilises.
   ────────────────────────────────────────────────────────────────────────── */

// Re-exported here from a single import site so the web form layer can pull
// both the schema builder and the field types from `@northbeam/db/field-types`.
import { z } from 'zod';

type FieldDefForSchema = {
  key: string;
  type: FieldType;
  required?: boolean | null;
  config?: FieldConfig | null;
};

const AddressValueSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().length(2).optional(),
  formatted: z.string().optional(),
  coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  mapbox_id: z.string().optional(),
});

function baseSchemaFor(field: FieldDefForSchema): z.ZodType<unknown> {
  const cfg = field.config ?? ({} as FieldConfig);
  switch (field.type) {
    case 'text':
    case 'textarea': {
      let s = z.string();
      if (typeof cfg.maxLength === 'number') {
        s = s.max(cfg.maxLength, `Must be ${cfg.maxLength} characters or fewer.`);
      }
      return s;
    }
    case 'email':
      return z.string().email("That doesn't look like an email address.");
    case 'url':
      return z.string().url("That doesn't look like a valid URL.");
    case 'phone':
      // Loose — we accept E.164 and any human-typed variant. Strict format
      // checks live closer to the input mask.
      return z.string().min(3, 'Too short for a phone number.');
    case 'number':
    case 'percent':
    case 'autonumber':
      return z
        .number({ message: 'Enter a number.' })
        .refine(Number.isFinite, 'Enter a number.');
    case 'currency':
      return z
        .number({ message: 'Enter an amount.' })
        .refine(Number.isFinite, 'Enter an amount.');
    case 'duration':
      return z.number().int().nonnegative('Duration must be 0 or more.');
    case 'date':
      return z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
    case 'datetime':
      return z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date.');
    case 'checkbox':
      return z.boolean();
    case 'picklist': {
      const opts = cfg.options?.map((o) => o.value) ?? [];
      if (!opts.length) return z.string();
      return z.enum(opts as [string, ...string[]], { message: 'Pick one of the options.' });
    }
    case 'multipicklist': {
      const opts = cfg.options?.map((o) => o.value) ?? [];
      const item = opts.length ? z.enum(opts as [string, ...string[]]) : z.string();
      return z.array(item);
    }
    case 'reference':
      return z.string().uuid('Pick a record from the list.');
    case 'address':
      return AddressValueSchema;
    case 'formula':
    case 'rollup':
    case 'ai':
      // Computed — never enters the form payload, but the schema returns a
      // permissive shape so a hand-built form that does pass one doesn't blow
      // up validation.
      return z.unknown();
    default:
      return z.unknown();
  }
}

/** Build a Zod object schema for a record's writable fields. Required-ness
 *  is honored at the field level; everything else is `.nullish()` so partial
 *  / in-flight forms parse cleanly. */
export function recordValueSchema(
  fields: FieldDefForSchema[],
): z.ZodObject<Record<string, z.ZodType<unknown>>> {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const f of fields) {
    if (f.type === 'formula' || f.type === 'rollup' || f.type === 'ai' || f.type === 'autonumber') {
      continue;
    }
    const base = baseSchemaFor(f);
    shape[f.key] = f.required ? base : base.nullish();
  }
  return z.object(shape);
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
