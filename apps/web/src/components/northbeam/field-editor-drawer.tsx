'use client';

// Direct port of design_handoff_northbeam/studio-fieldeditor.jsx (AI-assist
// features skipped). Right-drawer field editor in two steps: a grouped
// type-picker grid, then a per-type config form. Pre-validates with the pure
// config schemas (@northbeam/db/field-config-schemas) so a bad payload never
// costs a round-trip; submits through trpc.field.create/update. Editing keeps
// type + API key locked (physical column); system fields additionally lock
// the required flag and can't be deleted — mirroring the field router rules.

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import {
  FormulaEditorPanel,
  type FormulaRefPath,
} from '@/components/northbeam/formula-editor-panel';
import { PicklistOptionsEditor } from '@/components/northbeam/picklist-options-editor';
import { type RollupDraft, RollupEditorPanel } from '@/components/northbeam/rollup-editor-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { safeValidateFieldConfig } from '@northbeam/db/field-config-schemas';
import {
  type FieldConfig,
  type FieldType,
  PICKABLE_FIELD_TYPES,
  type PicklistOption,
  type RollupFieldConfig,
  fieldTypeMeta,
  narrowFieldConfig,
} from '@northbeam/db/field-types';
import { ArrowLeft, Square, SquareCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ObjChip, RecordDrawer } from './app-bits';
import { CurrencyCombobox } from './currency-combobox';
import { Icon } from './icons';

import { KEY_RE, keyFromLabel as keyify } from '@northbeam/db/keys';

/* ── type descriptions (UI-only copy — FIELD_TYPES carries no desc) ───────── */

const TYPE_DESC: Record<FieldType, string> = {
  text: 'A short single line of text',
  textarea: 'Multiple lines of text',
  email: 'An email address, validated on entry',
  phone: 'A phone number with display formatting',
  url: 'A web link, clickable on records',
  number: 'A plain number, whole or decimal',
  currency: 'A money amount with a currency code',
  percent: 'A percentage, shown with a % sign',
  autonumber: 'An auto-incrementing record number',
  date: 'A calendar date',
  datetime: 'A date with a time of day',
  duration: 'A length of time, like 1h 30m',
  checkbox: 'A simple yes / no toggle',
  picklist: 'Pick one value from a list',
  multipicklist: 'Pick several values from a list',
  reference: 'A link to a record on another object',
  reference_any: 'A link to a record on any object (polymorphic)',
  address: 'A structured street address',
  formula: 'Computed from other fields on save',
  rollup: 'Aggregates child records, like SUM of deals',
  ai: 'Computed automatically from the record',
};

/** The subset of a field def the drawer reads. Structural — the rows from
 *  trpc.object.get satisfy it directly. */
export type EditorField = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  config?: FieldConfig | null;
  required?: boolean | null;
  isSystem?: boolean | null;
};

/* ── draft state ─────────────────────────────────────────────────────────── */

type Draft = {
  label: string;
  key: string;
  keyTouched: boolean;
  required: boolean;
  helpText: string;
  description: string;
  precision?: number;
  currencyCode?: string;
  placeholder: string;
  maxLength: string;
  options: PicklistOption[];
  globalPicklistId?: string;
  restrictToOptions: boolean;
  targetObject?: string;
  onDeleteRef: 'setNull' | 'restrict';
  formula: string;
  returnType?: FieldType;
  rollup: RollupDraft;
};

function draftFrom(editing: EditorField | null | undefined): Draft {
  const cfg = (editing?.config ?? {}) as FieldConfig;
  return {
    label: editing?.label ?? '',
    key: editing?.key ?? '',
    keyTouched: Boolean(editing),
    required: Boolean(editing?.required),
    helpText: cfg.helpText ?? '',
    description: cfg.description ?? '',
    precision: cfg.precision,
    currencyCode: cfg.currencyCode,
    placeholder: cfg.placeholder ?? '',
    maxLength: cfg.maxLength != null ? String(cfg.maxLength) : '',
    options: cfg.options ?? [],
    globalPicklistId: cfg.globalPicklistId,
    restrictToOptions: cfg.restrictToOptions ?? false,
    targetObject: cfg.targetObject,
    onDeleteRef: cfg.onDelete === 'restrict' ? 'restrict' : 'setNull',
    formula: cfg.formula ?? '',
    returnType: cfg.returnType,
    rollup: cfg.rollup ?? {},
  };
}

const TEXTUAL_TYPES = new Set<FieldType>(['text', 'textarea', 'email', 'phone', 'url']);
const NUMERIC_TYPES = new Set<FieldType>(['number', 'percent', 'currency']);

/** Assemble the config payload: existing config (passthrough keys like mask /
 *  compoundKey survive) overlaid with the drafted, type-relevant keys. The
 *  picklist XOR is enforced here — a set binding strips inline options and
 *  vice versa. */
function buildConfig(type: FieldType, draft: Draft, base: FieldConfig): FieldConfig {
  const cfg: FieldConfig = { ...base };
  const put = (key: 'helpText' | 'description' | 'placeholder', value: string) => {
    const trimmed = value.trim();
    cfg[key] = trimmed || undefined;
  };
  put('helpText', draft.helpText);
  put('description', draft.description);
  if (NUMERIC_TYPES.has(type)) {
    if (draft.precision != null) cfg.precision = draft.precision;
    else cfg.precision = undefined;
  }
  if (type === 'currency') {
    if (draft.currencyCode) cfg.currencyCode = draft.currencyCode;
    else cfg.currencyCode = undefined;
  }
  if (TEXTUAL_TYPES.has(type)) {
    put('placeholder', draft.placeholder);
    const max = Number.parseInt(draft.maxLength, 10);
    if (Number.isFinite(max) && max > 0) cfg.maxLength = max;
    else cfg.maxLength = undefined;
  }
  if (type === 'picklist' || type === 'multipicklist') {
    cfg.restrictToOptions = draft.restrictToOptions;
    if (draft.globalPicklistId) {
      cfg.globalPicklistId = draft.globalPicklistId;
      cfg.options = undefined; // hydrated at read from the set
    } else {
      cfg.globalPicklistId = undefined;
      cfg.options = draft.options;
    }
  }
  if (type === 'reference') {
    if (draft.targetObject) cfg.targetObject = draft.targetObject;
    cfg.onDelete = draft.onDeleteRef;
  }
  if (type === 'formula') {
    cfg.formula = draft.formula.trim();
    if (draft.returnType) cfg.returnType = draft.returnType;
  }
  if (type === 'rollup') {
    cfg.rollup = draft.rollup as RollupFieldConfig['rollup'];
  }
  // Cleared keys were set to undefined above (biome noDelete) — strip them so
  // the stored JSONB stays tidy.
  return Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)) as FieldConfig;
}

/* ── the drawer ──────────────────────────────────────────────────────────── */

export function FieldEditorDrawer({
  open,
  onClose,
  objectKey,
  objectLabel,
  fields,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  objectKey: string;
  objectLabel: string;
  fields: EditorField[];
  /** null/undefined → create flow (starts at the type picker). */
  editing?: EditorField | null;
}) {
  const [step, setStep] = useState<'type' | 'config'>('type');
  const [type, setType] = useState<FieldType>('text');
  const [draft, setDraft] = useState<Draft>(() => draftFrom(editing));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed whenever the drawer opens (or opens on a different field).
  useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(editing));
    setType(editing?.type ?? 'text');
    setStep(editing ? 'config' : 'type');
    setConfirmDelete(false);
  }, [open, editing]);

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  const systemLock = Boolean(editing?.isSystem);
  const meta = fieldTypeMeta(type);

  const utils = trpc.useUtils();
  const invalidate = () => utils.object.get.invalidate({ key: objectKey });
  const createField = trpc.field.create.useMutation({
    meta: { context: "Couldn't create the field" },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const updateField = trpc.field.update.useMutation({
    meta: { context: "Couldn't save the field" },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const deleteField = trpc.field.delete.useMutation({
    meta: { context: "Couldn't delete the field" },
    onSuccess: () => {
      setConfirmDelete(false);
      invalidate();
      onClose();
    },
  });
  const pending = createField.isPending || updateField.isPending;

  // Client pre-validation — the same schemas the server runs, so "save
  // disabled while formula/rollup/picklist config is incomplete" is exact.
  const builtConfig = useMemo(
    () => buildConfig(type, draft, (editing?.config ?? {}) as FieldConfig),
    [type, draft, editing],
  );
  const configCheck = useMemo(
    () => safeValidateFieldConfig(type, builtConfig),
    [type, builtConfig],
  );
  const keyOk = KEY_RE.test(draft.key);
  const dupKey = !editing && fields.some((f) => f.key === draft.key);
  const canSave = draft.label.trim().length > 0 && keyOk && !dupKey && configCheck.ok;
  const configIssue = configCheck.ok ? null : configCheck.error.issues[0]?.message;

  const submit = () => {
    if (!canSave || !configCheck.ok) return;
    if (editing) {
      updateField.mutate({
        objectKey,
        fieldId: editing.id,
        patch: {
          label: draft.label.trim(),
          config: configCheck.config,
          // The required flag on system fields is fixed server-side — omit it.
          ...(systemLock ? {} : { required: draft.required }),
        },
      });
    } else {
      createField.mutate({
        objectKey,
        label: draft.label.trim(),
        key: draft.key,
        type,
        config: configCheck.config,
        required: draft.required,
      });
    }
  };

  const title = editing
    ? `Edit ${editing.label}`
    : step === 'type'
      ? 'Add a field'
      : `New ${meta.label} field`;
  const subtitle =
    step === 'type'
      ? 'Choose what kind of data this field holds'
      : 'Configure the field, then save';

  return (
    <>
      <RecordDrawer
        open={open}
        onClose={onClose}
        title={title}
        subtitle={subtitle}
        avatar={
          step === 'config' && !editing ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to types"
              onClick={() => setStep('type')}
            >
              <ArrowLeft />
            </Button>
          ) : undefined
        }
        footer={
          step === 'config' ? (
            <>
              {editing && !systemLock && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={pending || deleteField.isPending}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 />
                  Delete
                </Button>
              )}
              {configIssue && (
                <span className="min-w-0 truncate text-muted-foreground text-xs">
                  {configIssue}
                </span>
              )}
              <div className="spacer" />
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!canSave || pending}>
                {pending ? 'Saving…' : editing ? 'Save changes' : 'Create field'}
              </Button>
            </>
          ) : undefined
        }
      >
        {step === 'type' ? (
          <TypePicker
            onPick={(t) => {
              setType(t);
              setStep('config');
            }}
          />
        ) : (
          <>
            <SelectedTypeCard type={type} onChange={editing ? undefined : () => setStep('type')} />

            <Field label="Field label" required>
              <Input
                value={draft.label}
                placeholder="e.g. Renewal date"
                onChange={(e) =>
                  patch({
                    label: e.target.value,
                    ...(draft.keyTouched ? {} : { key: keyify(e.target.value) }),
                  })
                }
              />
            </Field>

            <Field
              label="API name"
              description={
                editing
                  ? 'Locked — the key maps to a physical column.'
                  : 'Used in formulas, automations, and the API.'
              }
              error={
                editing || !draft.key
                  ? undefined
                  : !keyOk
                    ? 'Lowercase letters, digits, and underscores, starting with a letter.'
                    : dupKey
                      ? `A field with key "${draft.key}" already exists on this object.`
                      : undefined
              }
            >
              <Input
                value={draft.key}
                disabled={Boolean(editing)}
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(e) => patch({ key: e.target.value, keyTouched: true })}
              />
            </Field>

            <TypeConfigBlock
              type={type}
              draft={draft}
              patch={patch}
              objectKey={objectKey}
              objectLabel={objectLabel}
              fields={fields}
              editing={editing}
            />

            <Field label="Help text" optional description="Shown to users under the input.">
              <Textarea
                rows={2}
                value={draft.helpText}
                onChange={(e) => patch({ helpText: e.target.value })}
              />
            </Field>

            {/* Required — full-width check row, per the studio drawer. */}
            <button
              type="button"
              disabled={systemLock}
              aria-pressed={draft.required}
              onClick={() => patch({ required: !draft.required })}
              className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className="grid size-8 shrink-0 place-items-center rounded-md"
                style={{
                  background: 'var(--surface-sunken)',
                  color: draft.required ? 'var(--brand)' : 'var(--ink-subtle)',
                }}
              >
                {draft.required ? (
                  <SquareCheck className="size-4" />
                ) : (
                  <Square className="size-4" />
                )}
              </span>
              <span className="min-w-0">
                <b className="block font-semibold text-sm">Required</b>
                <span className="block text-muted-foreground text-xs">
                  {systemLock
                    ? 'The required flag on system fields is fixed.'
                    : "Records can't be saved without this field."}
                </span>
              </span>
            </button>
          </>
        )}
      </RecordDrawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${editing?.label ?? 'field'}?`}
        description="This permanently removes the field and its data from every record. Fields used by formulas, roll-ups, or the record name can't be deleted."
        confirmLabel="Delete field"
        tone="destructive"
        pending={deleteField.isPending}
        onConfirm={() => {
          if (editing) deleteField.mutate({ objectKey, fieldId: editing.id });
        }}
      />
    </>
  );
}

/* ── step 1: type picker ─────────────────────────────────────────────────── */

function TypePicker({ onPick }: { onPick: (type: FieldType) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, (typeof PICKABLE_FIELD_TYPES)[number][]>();
    for (const t of PICKABLE_FIELD_TYPES) {
      const list = map.get(t.group) ?? [];
      list.push(t);
      map.set(t.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <>
      {groups.map(([group, types]) => (
        <div key={group} className="flex flex-col gap-2">
          <div className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            {group}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t.id)}
                className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/30"
              >
                <TypeIconTile icon={t.icon} />
                <span className="min-w-0">
                  <b className="block font-semibold text-sm">{t.label}</b>
                  <small className="block text-muted-foreground text-xs leading-snug">
                    {TYPE_DESC[t.id]}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TypeIconTile({ icon, className }: { icon: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground',
        className,
      )}
    >
      <Icon name={icon} size={16} />
    </span>
  );
}

/** Step-2 summary of the chosen type, with a "Change" link on create. */
function SelectedTypeCard({ type, onChange }: { type: FieldType; onChange?: () => void }) {
  const meta = fieldTypeMeta(type);
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5">
      <TypeIconTile icon={meta.icon} />
      <span className="min-w-0">
        <b className="block font-semibold text-sm">{meta.label}</b>
        <small className="block text-muted-foreground text-xs">{TYPE_DESC[type]}</small>
      </span>
      {onChange && (
        <Button variant="link" size="sm" className="ml-auto" onClick={onChange}>
          Change
        </Button>
      )}
    </div>
  );
}

/* ── step 2: per-type config blocks ──────────────────────────────────────── */

function TypeConfigBlock({
  type,
  draft,
  patch,
  objectKey,
  objectLabel,
  fields,
  editing,
}: {
  type: FieldType;
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  objectKey: string;
  objectLabel: string;
  fields: EditorField[];
  editing?: EditorField | null;
}) {
  if (NUMERIC_TYPES.has(type)) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <PrecisionSelect value={draft.precision} onChange={(precision) => patch({ precision })} />
        {type === 'currency' && (
          <Field label="Currency">
            <CurrencyPicker
              value={draft.currencyCode}
              onChange={(currencyCode) => patch({ currencyCode })}
            />
          </Field>
        )}
      </div>
    );
  }
  if (TEXTUAL_TYPES.has(type)) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Placeholder" optional>
          <Input
            value={draft.placeholder}
            placeholder="Ghost text inside the input"
            onChange={(e) => patch({ placeholder: e.target.value })}
          />
        </Field>
        <Field label="Max length" optional>
          <Input
            type="number"
            min={1}
            value={draft.maxLength}
            placeholder="No limit"
            onChange={(e) => patch({ maxLength: e.target.value })}
          />
        </Field>
      </div>
    );
  }
  if (type === 'picklist' || type === 'multipicklist') {
    return <PicklistConfigBlock draft={draft} patch={patch} />;
  }
  if (type === 'reference') {
    return <ReferenceConfigBlock draft={draft} patch={patch} />;
  }
  if (type === 'formula') {
    return <FormulaConfigBlock draft={draft} patch={patch} fields={fields} editing={editing} />;
  }
  if (type === 'rollup') {
    return (
      <RollupEditorPanel
        objectKey={objectKey}
        objectLabel={objectLabel}
        value={draft.rollup}
        onChange={(rollup) => patch({ rollup })}
      />
    );
  }
  // date / datetime / duration / checkbox / address (and imported inert
  // types like ai) — base fields only.
  return null;
}

function PrecisionSelect({
  value,
  onChange,
}: {
  value?: number;
  onChange: (next?: number) => void;
}) {
  return (
    <Field label="Decimal places">
      <Select
        value={value != null ? String(value) : 'auto'}
        onValueChange={(v) => onChange(v === 'auto' ? undefined : Number(v))}
      >
        <SelectTrigger className="w-full" aria-label="Decimal places">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Automatic</SelectItem>
          {[0, 1, 2, 3, 4].map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// CurrencyCombobox requires a string value; isolate the ''-vs-undefined shim.
function CurrencyPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (code: string) => void;
}) {
  return <CurrencyCombobox value={value ?? ''} onValueChange={onChange} className="w-full" />;
}

function FormulaConfigBlock({
  draft,
  patch,
  fields,
  editing,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  fields: EditorField[];
  editing?: EditorField | null;
}) {
  const refPaths = useRefPaths(fields, editing);
  return (
    <Field label="Formula" description="Computed on every record when it changes.">
      <FormulaEditorPanel
        fields={formulaFields(fields, editing)}
        refPaths={refPaths}
        formula={draft.formula}
        onChange={(formula) => patch({ formula })}
        returnType={draft.returnType}
        onReturnTypeChange={(returnType) => patch({ returnType })}
        showReturnType
      />
    </Field>
  );
}

function PicklistConfigBlock({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
}) {
  const sets = trpc.picklist.list.useQuery();
  const bound = draft.globalPicklistId
    ? sets.data?.find((s) => s.id === draft.globalPicklistId)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Options source"
        description="Bind to a shared set to keep options in sync across objects."
      >
        <Select
          value={draft.globalPicklistId ?? 'inline'}
          onValueChange={(v) => {
            if (v === 'inline') {
              // Unbind — seed the inline list from the set so nothing is lost.
              patch({
                globalPicklistId: undefined,
                options: draft.options.length > 0 ? draft.options : (bound?.values ?? []),
              });
            } else {
              patch({ globalPicklistId: v });
            }
          }}
        >
          <SelectTrigger className="w-full" aria-label="Options source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inline">This field only (inline options)</SelectItem>
            {(sets.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                <span className="text-muted-foreground text-xs">
                  {s.values.length} values · {s.usedByCount} fields
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {draft.globalPicklistId ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
          <p className="text-muted-foreground text-xs">
            Options come from the <b className="text-foreground">{bound?.name ?? 'selected'}</b> set
            — editing the set updates every field bound to it.
          </p>
          {bound && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bound.values.map((v) => (
                <span
                  key={v.value}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ background: v.color ?? 'var(--surface-sunken)' }}
                  />
                  {v.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Field label="Choices">
          <PicklistOptionsEditor
            options={draft.options}
            onChange={(options) => patch({ options })}
          />
        </Field>
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <div className="min-w-0">
          <div className="font-semibold text-sm">Restrict to these values</div>
          <p className="text-muted-foreground text-xs">
            Reject saves with a value that isn't in the list.
          </p>
        </div>
        <Switch
          checked={draft.restrictToOptions}
          onCheckedChange={(restrictToOptions) => patch({ restrictToOptions })}
          aria-label="Restrict to these values"
        />
      </div>
    </div>
  );
}

function ReferenceConfigBlock({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
}) {
  const objects = trpc.object.list.useQuery({});
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Related object" description="Records will link to this object.">
        <Select
          value={draft.targetObject ?? ''}
          onValueChange={(targetObject) => patch({ targetObject })}
        >
          <SelectTrigger className="w-full" aria-label="Related object">
            <SelectValue placeholder="Pick an object…" />
          </SelectTrigger>
          <SelectContent>
            {(objects.data ?? []).map((o) => (
              <SelectItem key={o.key} value={o.key}>
                <ObjChip label={o.label} color={o.color ?? undefined} size={18} />
                {o.labelPlural}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="If the referenced record is deleted">
        <Select
          value={draft.onDeleteRef}
          onValueChange={(v) => patch({ onDeleteRef: v as Draft['onDeleteRef'] })}
        >
          <SelectTrigger className="w-full" aria-label="On delete behavior">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="setNull">Clear this field</SelectItem>
            <SelectItem value="restrict">Block the delete</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/* ── formula helpers ─────────────────────────────────────────────────────── */

function formulaFields(fields: EditorField[], editing?: EditorField | null): FieldDefLite[] {
  return fields
    .filter((f) => f.key !== editing?.key)
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      config: f.config ?? undefined,
      required: f.required ?? undefined,
    }));
}

/** One-hop related paths ({ref.field}) for the formula insert menu, fetched
 *  lazily from the cached object.get of each lookup's target. */
function useRefPaths(fields: EditorField[], editing?: EditorField | null): FormulaRefPath[] {
  const targets = useMemo(() => {
    const map = new Map<string, { refKey: string; refLabel: string }[]>();
    for (const f of fields) {
      if (f.type !== 'reference' || f.key === editing?.key) continue;
      const target = narrowFieldConfig('reference', f.config).targetObject;
      if (!target) continue;
      const list = map.get(target) ?? [];
      list.push({ refKey: f.key, refLabel: f.label });
      map.set(target, list);
    }
    return [...map.entries()];
  }, [fields, editing?.key]);

  const queries = trpc.useQueries((t) => targets.map(([key]) => t.object.get({ key })));

  return useMemo(() => {
    const out: FormulaRefPath[] = [];
    targets.forEach(([, refs], i) => {
      const data = queries[i]?.data;
      if (!data) return;
      for (const { refKey, refLabel } of refs) {
        for (const tf of data.fields) {
          out.push({ path: `${refKey}.${tf.key}`, label: tf.label, group: refLabel });
        }
      }
    });
    return out;
  }, [targets, queries]);
}
