'use client';

// Validation + conditional-format rule editors for the Object Manager detail
// page (Validation and Formatting tabs). Model: EverOn admin-objects.jsx rule
// editors, restyled with Northbeam primitives.
//
// ValidationRulesEditor — one card per validation_rule row; each card saves
// itself via trpc.validation.create/update/delete (per-rule saves, no batch).
// Conditions are Northbeam formulas that BLOCK the save when truthy; validity
// is checked client-side with the pure engine (parse-level + known-key only —
// cross-object refs resolve server-side) plus an optional "Test against
// sample" probe via trpc.validation.test.
//
// FormatRulesEditor — draft state + dirty save bar like object-layout-editor;
// rules live as one JSONB array on the object, saved via
// trpc.object.updateFormatRules. Conditions are filter rows (field/op/value,
// AND-ed), reusing FilterRow from filter-bar.tsx. Tones are the semantic
// vocabulary mapped onto CSS vars in swatch-picker.tsx's FORMAT_TONES
// (red→--danger, amber→--warning, green→--success, blue→--info,
// purple→--lilac, gray→--ink-muted).

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FilterRow } from '@/components/northbeam/filter-bar';
import { SectionCard } from '@/components/northbeam/section-card';
import { FORMAT_TONES, type Swatch, SwatchPicker } from '@/components/northbeam/swatch-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Switch } from '@/components/ui/switch';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { type Filter, isFilterable, opsForType } from '@/lib/filters';
import { collectFieldKeys, parseFormula, validateFormula } from '@northbeam/db/formula';
import type { FormatRule, FormatTone } from '@northbeam/db/views';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Paintbrush,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/* ════════════════════════════════════════════════════════════════════════
   Shared condition status line (formula parse + known-key check)
   ════════════════════════════════════════════════════════════════════════ */

type ConditionStatus =
  | { kind: 'idle' }
  | { kind: 'valid' }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; message: string };

/** Debounced client-side validity for a formula condition. Unknown same-record
 *  keys warn; dotted (related) refs only warn too — they're checked on save. */
function useConditionStatus(condition: string, fields: FieldDefLite[]): ConditionStatus {
  const [status, setStatus] = useState<ConditionStatus>({ kind: 'idle' });
  useEffect(() => {
    if (!condition.trim()) {
      setStatus({ kind: 'idle' });
      return;
    }
    const timer = setTimeout(() => {
      const result = validateFormula(condition);
      if (!result.ok) {
        setStatus({ kind: 'error', message: `${result.message} (at position ${result.pos})` });
        return;
      }
      const known = new Set(fields.map((f) => f.key));
      const unknown = [...collectFieldKeys(parseFormula(condition))].filter((k) => !known.has(k));
      if (unknown.length > 0) {
        const first = unknown[0] as string;
        const more = unknown.length > 1 ? ` (+${unknown.length - 1} more)` : '';
        setStatus({
          kind: 'warning',
          message: first.includes('.')
            ? `Can't verify related field {${first}} here${more} — it's checked on save.`
            : `Unknown field {${first}}${more}`,
        });
        return;
      }
      setStatus({ kind: 'valid' });
    }, 200);
    return () => clearTimeout(timer);
  }, [condition, fields]);
  return status;
}

function ConditionStatusLine({ status }: { status: ConditionStatus }) {
  if (status.kind === 'idle') {
    return (
      <p className="text-muted-foreground text-xs">
        Reference fields as <code className="font-mono">{'{key}'}</code>. The save is blocked when
        the condition is true.
      </p>
    );
  }
  if (status.kind === 'valid') {
    return (
      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}>
        <CheckCircle2 className="size-3.5" />
        Valid condition
      </p>
    );
  }
  if (status.kind === 'warning') {
    return (
      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--warning)' }}>
        <AlertTriangle className="size-3.5" />
        {status.message}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-destructive text-xs">
      <AlertCircle className="size-3.5" />
      {status.message}
    </p>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ValidationRulesEditor
   ════════════════════════════════════════════════════════════════════════ */

type ValidationRule = RouterOutputs['validation']['list'][number];

type RuleDraft = {
  name: string;
  condition: string;
  errorMessage: string;
  active: boolean;
};

function draftFrom(rule: ValidationRule | null): RuleDraft {
  return {
    name: rule?.name ?? '',
    condition: rule?.condition ?? '',
    errorMessage: rule?.errorMessage ?? '',
    active: rule?.active ?? true,
  };
}

export function ValidationRulesEditor({
  objectKey,
  fields,
}: {
  objectKey: string;
  fields: FieldDefLite[];
}) {
  const canManage = useCan('object.manage');
  const q = trpc.validation.list.useQuery({ objectKey });
  // Locally-added, not-yet-saved rules. Keyed so removal is stable.
  const [newDrafts, setNewDrafts] = useState<number[]>([]);
  const [nextDraftId, setNextDraftId] = useState(1);

  const addDraft = () => {
    setNewDrafts((d) => [...d, nextDraftId]);
    setNextDraftId((n) => n + 1);
  };
  const removeDraft = (id: number) => setNewDrafts((d) => d.filter((x) => x !== id));

  const rules = q.data ?? [];
  const empty = rules.length === 0 && newDrafts.length === 0;

  return (
    <SectionCard
      title={`Validation rules${q.data ? ` (${rules.length})` : ''}`}
      icon={ShieldCheck}
      action={
        canManage ? (
          <Button variant="outline" size="sm" onClick={addDraft}>
            <Plus />
            New rule
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">View-only</span>
        )
      }
    >
      {q.isLoading ? (
        <LoadingScreen size="sm" />
      ) : empty ? (
        <EmptyState
          icon={ShieldCheck}
          title="No validation rules"
          body="When a rule's condition evaluates to true, the save is blocked and the error message is shown on the form."
          size="sm"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            When a rule's condition is true, the save is blocked and the error message is shown.
            Each rule saves on its own.
          </p>
          {rules.map((rule) => (
            <ValidationRuleCard
              key={rule.id}
              objectKey={objectKey}
              rule={rule}
              fields={fields}
              canManage={canManage}
            />
          ))}
          {newDrafts.map((id) => (
            <ValidationRuleCard
              key={`new-${id}`}
              objectKey={objectKey}
              rule={null}
              fields={fields}
              canManage={canManage}
              onDiscard={() => removeDraft(id)}
              onCreated={() => removeDraft(id)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ValidationRuleCard({
  objectKey,
  rule,
  fields,
  canManage,
  onDiscard,
  onCreated,
}: {
  objectKey: string;
  /** null = a new, not-yet-saved rule. */
  rule: ValidationRule | null;
  fields: FieldDefLite[];
  canManage: boolean;
  onDiscard?: () => void;
  onCreated?: () => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<RuleDraft>(() => draftFrom(rule));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const status = useConditionStatus(draft.condition, fields);

  const invalidate = () => utils.validation.list.invalidate({ objectKey });
  const create = trpc.validation.create.useMutation({
    meta: { context: "Couldn't create the validation rule" },
    onSuccess: () => {
      invalidate();
      onCreated?.();
    },
  });
  const update = trpc.validation.update.useMutation({
    meta: { context: "Couldn't save the validation rule" },
    onSuccess: invalidate,
  });
  const remove = trpc.validation.delete.useMutation({
    meta: { context: "Couldn't delete the validation rule" },
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
    },
  });

  const source = draftFrom(rule);
  const dirty =
    rule === null ||
    draft.name !== source.name ||
    draft.condition !== source.condition ||
    draft.errorMessage !== source.errorMessage ||
    draft.active !== source.active;
  const complete =
    draft.name.trim().length > 0 &&
    draft.condition.trim().length > 0 &&
    draft.errorMessage.trim().length > 0 &&
    status.kind !== 'error';
  const saving = create.isPending || update.isPending;

  const save = () => {
    if (!complete) return;
    if (rule === null) {
      create.mutate({
        objectKey,
        name: draft.name.trim(),
        condition: draft.condition,
        errorMessage: draft.errorMessage.trim(),
        active: draft.active,
      });
    } else {
      update.mutate({
        id: rule.id,
        patch: {
          ...(draft.name !== source.name ? { name: draft.name.trim() } : {}),
          ...(draft.condition !== source.condition ? { condition: draft.condition } : {}),
          ...(draft.errorMessage !== source.errorMessage
            ? { errorMessage: draft.errorMessage.trim() }
            : {}),
          ...(draft.active !== source.active ? { active: draft.active } : {}),
        },
      });
    }
  };

  const testAgainstSample = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await utils.validation.test.fetch({ objectKey, condition: draft.condition });
      if (!res.ok) {
        setTestResult({ ok: false, message: res.message });
      } else if (!res.sample) {
        setTestResult({ ok: true, message: 'No records to test against yet.' });
      } else {
        setTestResult({
          ok: true,
          message: res.sample.triggered
            ? `Would block saving "${res.sample.name}".`
            : `Would allow saving "${res.sample.name}".`,
        });
      }
    } catch {
      setTestResult({ ok: false, message: "Couldn't run the test." });
    } finally {
      setTesting(false);
    }
  };

  const idBase = rule?.id ?? 'new';

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-l-2 bg-card p-3"
      style={{ borderLeftColor: 'var(--danger)' }}
    >
      <div className="flex items-start gap-3">
        <Field label="Rule name" className="flex-1" htmlFor={`vr-name-${idBase}`}>
          <Input
            id={`vr-name-${idBase}`}
            value={draft.name}
            placeholder="e.g. Amount required when won"
            disabled={!canManage}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </Field>
        <div className="flex items-center gap-2 pt-6">
          <Label htmlFor={`vr-active-${idBase}`} className="text-muted-foreground text-xs">
            Active
          </Label>
          <Switch
            id={`vr-active-${idBase}`}
            checked={draft.active}
            disabled={!canManage}
            onCheckedChange={(active) => setDraft((d) => ({ ...d, active }))}
          />
          {rule !== null ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete rule ${rule.name}`}
              disabled={!canManage}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Discard new rule"
              onClick={onDiscard}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      <Field label="Block save when this condition is true" htmlFor={`vr-cond-${idBase}`}>
        <Input
          id={`vr-cond-${idBase}`}
          value={draft.condition}
          placeholder='ISBLANK({amount}) && ISPICKVAL({stage}, "won")'
          spellCheck={false}
          disabled={!canManage}
          className="font-mono text-xs"
          onChange={(e) => {
            setDraft((d) => ({ ...d, condition: e.target.value }));
            setTestResult(null);
          }}
        />
      </Field>
      <ConditionStatusLine status={status} />

      <Field label="Error message" htmlFor={`vr-msg-${idBase}`}>
        <Input
          id={`vr-msg-${idBase}`}
          value={draft.errorMessage}
          placeholder="Shown on the form when the save is blocked."
          disabled={!canManage}
          onChange={(e) => setDraft((d) => ({ ...d, errorMessage: e.target.value }))}
        />
      </Field>

      {canManage && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={testing || !draft.condition.trim() || status.kind === 'error'}
            onClick={testAgainstSample}
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical />}
            Test against sample
          </Button>
          {testResult && (
            <span
              className="text-xs"
              style={{ color: testResult.ok ? 'var(--ink-muted)' : 'var(--danger)' }}
            >
              {testResult.message}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" onClick={save} disabled={!dirty || !complete || saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {rule === null ? 'Create rule' : 'Save rule'}
            </Button>
          </div>
        </div>
      )}

      {rule !== null && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete rule "${rule.name}"?`}
          description="Saves will no longer be checked against this condition."
          confirmLabel="Delete rule"
          tone="destructive"
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ id: rule.id })}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   FormatRulesEditor
   ════════════════════════════════════════════════════════════════════════ */

/** The 6 semantic tones as SwatchPicker entries — stored value is the tone
 *  name; the painted color is its theme-following CSS var. */
const TONE_SWATCHES: Swatch[] = (Object.keys(FORMAT_TONES) as FormatTone[]).map((tone) => ({
  name: FORMAT_TONES[tone].label,
  value: tone,
  color: FORMAT_TONES[tone].fg,
}));

export function FormatRulesEditor({
  objectId,
  objectKey,
  fields,
  rules,
}: {
  objectId: string;
  objectKey: string;
  fields: FieldDefLite[];
  rules: FormatRule[];
}) {
  const canManage = useCan('object.manage');
  const utils = trpc.useUtils();

  // Local draft starts from the persisted rules; reset after a save
  // round-trip (same pattern as LayoutEditor).
  const [draft, setDraft] = useState<FormatRule[]>(rules);
  useEffect(() => setDraft(rules), [rules]);

  const save = trpc.object.updateFormatRules.useMutation({
    meta: { context: "Couldn't save the format rules" },
    onSuccess: () => utils.object.get.invalidate({ key: objectKey }),
  });

  const filterable = useMemo(() => fields.filter(isFilterable), [fields]);
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);
  const complete = draft.every(
    (r) => r.label.trim().length > 0 && r.filters.every((f) => f.fieldKey),
  );

  const addRule = () => {
    setDraft((d) => [
      ...d,
      { id: crypto.randomUUID(), label: '', tone: 'blue', filters: [], active: true },
    ]);
  };
  const patchRule = (id: string, patch: Partial<FormatRule>) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRule = (id: string) => setDraft((d) => d.filter((r) => r.id !== id));

  return (
    <SectionCard
      title={`Format rules (${draft.length})`}
      icon={Paintbrush}
      action={
        canManage ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRule}>
              <Plus />
              New rule
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => setDraft(rules)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!dirty || !complete || save.isPending}
              onClick={() => save.mutate({ objectId, formatRules: draft })}
            >
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Save rules
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">View-only</span>
        )
      }
    >
      {draft.length === 0 ? (
        <EmptyState
          icon={Paintbrush}
          title="No format rules"
          body="Format rules highlight records that match every condition — as tone badges on the record header."
          size="sm"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            A record that matches every condition on a rule gets that rule's tone. Rules apply in
            order.
          </p>
          {draft.map((rule) => (
            <FormatRuleCard
              key={rule.id}
              rule={rule}
              fields={filterable}
              byKey={byKey}
              disabled={!canManage}
              onPatch={(patch) => patchRule(rule.id, patch)}
              onRemove={() => removeRule(rule.id)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function FormatRuleCard({
  rule,
  fields,
  byKey,
  disabled,
  onPatch,
  onRemove,
}: {
  rule: FormatRule;
  fields: FieldDefLite[];
  byKey: Map<string, FieldDefLite>;
  disabled: boolean;
  onPatch: (patch: Partial<FormatRule>) => void;
  onRemove: () => void;
}) {
  const addCondition = () => {
    const first = fields[0];
    if (!first) return;
    const op = opsForType(first.type)[0] ?? 'eq';
    onPatch({ filters: [...rule.filters, { fieldKey: first.key, op, value: null }] });
  };
  const patchFilter = (index: number, patch: Partial<Filter>) => {
    onPatch({
      filters: rule.filters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });
  };
  const removeFilter = (index: number) => {
    onPatch({ filters: rule.filters.filter((_, i) => i !== index) });
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-l-2 bg-card p-3"
      style={{ borderLeftColor: FORMAT_TONES[rule.tone].fg }}
    >
      <div className="flex items-start gap-3">
        <Field label="Label" className="flex-1" htmlFor={`fr-label-${rule.id}`}>
          <Input
            id={`fr-label-${rule.id}`}
            value={rule.label}
            placeholder="e.g. Closing this week"
            disabled={disabled}
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </Field>
        <Field label="Tone">
          <SwatchPicker
            label={`Tone for ${rule.label || 'rule'}`}
            value={rule.tone}
            swatches={TONE_SWATCHES}
            disabled={disabled}
            onChange={(tone) => onPatch({ tone: tone as FormatTone })}
            className="h-9"
          />
        </Field>
        <div className="flex items-center gap-2 pt-6">
          <Label htmlFor={`fr-active-${rule.id}`} className="text-muted-foreground text-xs">
            Active
          </Label>
          <Switch
            id={`fr-active-${rule.id}`}
            checked={rule.active}
            disabled={disabled}
            onCheckedChange={(active) => onPatch({ active })}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete rule ${rule.label || 'untitled'}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {rule.filters.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">
            No conditions yet — this rule matches nothing until one is added.
          </p>
        ) : (
          rule.filters.map((row, i) => (
            <FilterRow
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order-only edits
              key={i}
              index={i}
              row={row}
              fields={fields}
              byKey={byKey}
              onChange={(patch) => patchFilter(i, patch)}
              onRemove={() => removeFilter(i)}
            />
          ))
        )}
        {!disabled && (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={addCondition}>
              <Plus />
              Add condition
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
