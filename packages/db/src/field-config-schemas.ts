// Per-FieldType Zod schemas for validating field_def.config at the write
// boundary. The structural FieldConfig type in field-types.ts is permissive
// (all keys optional) so a partial in-flight form compiles; these schemas
// enforce the semantic requirements at insert/update time:
//   - picklist  → exactly one of: non-empty inline options, or a globalPicklistId
//   - reference → targetObject must be present and non-empty
//   - formula   → formula expression must be present
//   - rollup    → rollup descriptor must be present
//   - ai        → aiPrompt must be present
//
// Callers (the field-editor mutation, the SF importer) feed user input through
// validateFieldConfig() before persisting. A passing config is guaranteed to
// render correctly downstream.

import { z } from 'zod';
import { FIELD_TYPE_IDS, type FieldConfig, type FieldType } from './field-types';
import { validateFormula } from './formula/index';

export const PicklistOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
});

const BaseConfigSchema = z
  .object({
    description: z.string().optional(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    defaultValue: z.unknown().optional(),
    confidential: z.boolean().optional(),
    encrypted: z.boolean().optional(),
    compoundKey: z.string().optional(),
  })
  .passthrough();

const TextConfigSchema = BaseConfigSchema.extend({
  maxLength: z.number().int().positive().optional(),
  mask: z.string().optional(),
});

const NumberConfigSchema = BaseConfigSchema.extend({
  precision: z.number().int().nonnegative().optional(),
  scale: z.number().int().nonnegative().optional(),
});

const CurrencyConfigSchema = NumberConfigSchema.extend({
  currencyCode: z
    .string()
    .length(3, 'currencyCode must be an ISO 4217 three-letter code')
    .optional(),
});

const PicklistConfigSchema = BaseConfigSchema.extend({
  options: z.array(PicklistOptionSchema).min(1, 'picklist requires at least one option').optional(),
  globalPicklistId: z.string().uuid().optional(),
  restrictToOptions: z.boolean().optional(),
  controllingField: z.string().optional(),
}).superRefine((cfg, ctx) => {
  // Exactly one source of options: inline `options` XOR a global set.
  const inline = (cfg.options?.length ?? 0) > 0;
  const set = Boolean(cfg.globalPicklistId);
  if (!inline && !set) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'picklist requires at least one option (inline options or a globalPicklistId)',
      path: ['options'],
    });
  }
  if (inline && set) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'picklist cannot carry both inline options and a globalPicklistId',
      path: ['globalPicklistId'],
    });
  }
});

const ReferenceConfigSchema = BaseConfigSchema.extend({
  targetObject: z
    .string()
    .min(1, 'reference requires a targetObject (the object_def.key it points at)'),
  relationshipName: z.string().optional(),
  onDelete: z.enum(['setNull', 'cascade', 'restrict']).optional(),
});

// Polymorphic lookup: no single target required. `targetObjects` optionally
// constrains which objects are valid; empty/omitted = any object.
const PolyReferenceConfigSchema = BaseConfigSchema.extend({
  targetObjects: z.array(z.string().min(1)).optional(),
  relationshipName: z.string().optional(),
  onDelete: z.enum(['setNull', 'cascade', 'restrict']).optional(),
});

const FormulaConfigSchema = BaseConfigSchema.extend({
  formula: z
    .string()
    .min(1, 'formula requires an expression')
    .superRefine((s, ctx) => {
      const r = validateFormula(s);
      if (!r.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid formula: ${r.message}`,
        });
      }
    }),
  returnType: z.enum(FIELD_TYPE_IDS).optional(),
});

const RollupConfigSchema = BaseConfigSchema.extend({
  rollup: z
    .object({
      childObject: z.string().min(1),
      via: z
        .string()
        .min(1, 'rollup requires `via` (the child lookup field pointing at this object)'),
      childField: z.string().optional(),
      fn: z.enum(['sum', 'count', 'avg', 'min', 'max']),
      filter: z.string().optional(),
    })
    .superRefine((r, ctx) => {
      // Every aggregate except COUNT needs a child field to aggregate.
      if (r.fn !== 'count' && !r.childField) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rollup fn '${r.fn}' requires a childField`,
          path: ['childField'],
        });
      }
    }),
});

const AiConfigSchema = BaseConfigSchema.extend({
  aiPrompt: z.string().min(1, 'ai field requires an aiPrompt'),
});

const DurationConfigSchema = BaseConfigSchema.extend({
  maxMinutes: z.number().int().positive().optional(),
});

const AddressConfigSchema = BaseConfigSchema.extend({
  countries: z.array(z.string().length(2)).optional(),
  requireCoordinates: z.boolean().optional(),
});

/** The schema to use for each FieldType — same shape as FieldConfigForType. */
export const FieldConfigSchemas = {
  text: TextConfigSchema,
  textarea: TextConfigSchema,
  email: TextConfigSchema,
  phone: TextConfigSchema,
  url: TextConfigSchema,
  number: NumberConfigSchema,
  currency: CurrencyConfigSchema,
  percent: NumberConfigSchema,
  autonumber: NumberConfigSchema,
  date: BaseConfigSchema,
  datetime: BaseConfigSchema,
  duration: DurationConfigSchema,
  checkbox: BaseConfigSchema,
  picklist: PicklistConfigSchema,
  multipicklist: PicklistConfigSchema,
  reference: ReferenceConfigSchema,
  reference_any: PolyReferenceConfigSchema,
  address: AddressConfigSchema,
  formula: FormulaConfigSchema,
  rollup: RollupConfigSchema,
  ai: AiConfigSchema,
} as const;

/** Validate a config payload against the schema for the given FieldType.
 *  Returns the parsed config on success; throws ZodError on failure. */
export function validateFieldConfig(type: FieldType, config: unknown): FieldConfig {
  return FieldConfigSchemas[type].parse(config) as FieldConfig;
}

/** Safe variant — returns a result object instead of throwing. */
export function safeValidateFieldConfig(
  type: FieldType,
  config: unknown,
): { ok: true; config: FieldConfig } | { ok: false; error: z.ZodError } {
  const result = FieldConfigSchemas[type].safeParse(config);
  if (result.success) return { ok: true, config: result.data as FieldConfig };
  return { ok: false, error: result.error };
}
