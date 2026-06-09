'use client';

// Record detail page — highlight header + stat strip + Details/Related tabs +
// a sectioned, click-to-edit detail grid. Structure ported from the On Q OS
// handoff; rendered with our own components + tokens. Every section/field comes
// from the object's `layout` metadata, so this works for any object.

import { trpc } from '@/lib/api';
import type { FieldConfig, ObjectLayout } from '@northbeam/db/field-types';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../ui/button';
import { ObjChip } from './app-bits';
import { HidePageHead } from './app-shell';
import { type FieldDefLite, FieldInput, FieldValue } from './field-render';
import { EmptyState } from './page-head';
import { Spinner } from './primitives';
import { RecordFormDrawer } from './record-form';

const READONLY = new Set(['formula', 'rollup', 'ai', 'autonumber']);

export function RecordView({ objectKey, id }: { objectKey: string; id: string }) {
  const [tab, setTab] = useState<'details' | 'related'>('details');
  const [editing, setEditing] = useState(false);

  const rec = trpc.record.get.useQuery({ objectKey, id });
  const related = trpc.record.related.useQuery({ objectKey, id });

  if (rec.isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', padding: 64 }}>
        <Spinner style={{ color: 'var(--brand)' }} />
      </div>
    );
  }
  if (!rec.data) {
    return (
      <EmptyState icon="warning-circle" title="Record not found" body="It may have been deleted." />
    );
  }

  const { object, fields, row, refLabels } = rec.data;
  const layout = (object.layout ?? {}) as ObjectLayout;
  const byKey = new Map(fields.map((f) => [f.key, f as FieldDefLite]));
  const compactKeys = (layout.compactKeys ?? []).filter((k) => byKey.has(k));
  const statKeys = (layout.statKeys ?? []).filter((k) => byKey.has(k));
  const sections = layout.sections?.length
    ? layout.sections
    : [{ id: 'all', label: 'Details', cols: 2 as const, fields: fields.map((f) => f.key) }];
  const relatedGroups = related.data ?? [];
  const relatedCount = relatedGroups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="rec">
      <HidePageHead />

      <div className="rec-crumb">
        <Link href={`/${object.labelPlural.toLowerCase()}`}>{object.labelPlural}</Link>
        <span className="sep">›</span>
        <span className="here">{row.name}</span>
      </div>

      {/* highlight */}
      <div className="rec-hl">
        <div className="rec-hl__top">
          <ObjChip label={object.label} color={object.color} size={46} />
          <div className="rec-hl__text">
            <div className="rec-eyebrow">
              {object.label} <span className="mono">{id.slice(0, 8)}</span>
            </div>
            <h1 className="rec-title">{row.name}</h1>
            {compactKeys.length > 0 && (
              <div className="rec-compact">
                {compactKeys.map((k) => {
                  const f = byKey.get(k);
                  if (!f) return null;
                  const v = row.data[k];
                  if (v == null || v === '') return null;
                  return (
                    <span key={k}>
                      <span className="k">{f.label}:</span>
                      <FieldValue field={f} value={v} referenceLabel={refLabels[String(v)]} />
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="rec-hl__actions">
            <Button variant="secondary" icon="pencil-simple" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>

        {statKeys.length > 0 && (
          <div className="rec-stats">
            {statKeys.map((k) => {
              const f = byKey.get(k);
              if (!f) return null;
              return (
                <div className="rec-stat" key={k}>
                  <div className="rec-stat__lbl">{f.label}</div>
                  <div className="rec-stat__val">
                    <FieldValue field={f} value={row.data[k]} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="tabs">
        <button
          type="button"
          className="tab"
          data-active={tab === 'details' ? 'true' : undefined}
          onClick={() => setTab('details')}
        >
          Details
        </button>
        <button
          type="button"
          className="tab"
          data-active={tab === 'related' ? 'true' : undefined}
          onClick={() => setTab('related')}
        >
          Related
          {relatedCount > 0 && <span className="count">{relatedCount}</span>}
        </button>
      </div>

      {tab === 'details' && (
        <div className="rec-grid">
          {sections.map((sec) => {
            const cols = sec.cols ?? 2;
            const secFields = sec.fields.map((k) => byKey.get(k)).filter(Boolean) as FieldDefLite[];
            if (!secFields.length) return null;
            return (
              <div key={sec.id} className={`rcard${cols === 1 ? ' rcard--full' : ''}`}>
                <div className="rcard__head">
                  <span className="rcard__title">{sec.label}</span>
                </div>
                <div
                  className="rcard__body rfields"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
                >
                  {secFields.map((f) => (
                    <InlineField
                      key={f.key}
                      objectKey={objectKey}
                      recordId={id}
                      field={f}
                      value={row.data[f.key]}
                      refLabel={refLabels[String(row.data[f.key])]}
                      fullWidth={cols > 1 && (f.type === 'textarea' || f.type === 'multipicklist')}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'related' && (
        <div className="rec-grid rec-grid--single">
          {relatedGroups.length === 0 ? (
            <EmptyState
              icon="users-three"
              title="Nothing related yet"
              body="Records that reference this one will appear here."
            />
          ) : (
            relatedGroups.map((g) => {
              const gByKey = new Map(g.fields.map((f) => [f.key, f as FieldDefLite]));
              const gLayout = (g.object.layout ?? {}) as ObjectLayout;
              const cols = (gLayout.listColumns ?? [])
                .map((k) => gByKey.get(k))
                .filter(Boolean)
                .slice(0, 4) as FieldDefLite[];
              return (
                <div key={`${g.object.key}.${g.via.key}`} className="rcard rcard--full">
                  <div className="rcard__head">
                    <ObjChip label={g.object.label} color={g.object.color} size={20} />
                    <span className="rcard__title">{g.object.labelPlural}</span>
                    <span className="count">{g.rows.length}</span>
                  </div>
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Name</th>
                          {cols.map((c) => (
                            <th key={c.key}>{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.id} data-clickable="true">
                            <td>
                              <Link
                                href={`/${g.object.key}/${r.id}`}
                                style={{ color: 'var(--ink)', fontWeight: 600 }}
                              >
                                {r.name}
                              </Link>
                            </td>
                            {cols.map((c) => (
                              <td key={c.key}>
                                <FieldValue field={c} value={r.data[c.key]} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {editing && (
        <RecordFormDrawer
          open
          onClose={() => setEditing(false)}
          objectKey={objectKey}
          objectLabel={object.label}
          fields={fields as FieldDefLite[]}
          sections={layout.sections}
          record={{ id: row.id, data: row.data }}
          refLabels={refLabels}
        />
      )}
    </div>
  );
}

/* ── one click-to-edit field on the detail grid ─────────────────────────────── */
function InlineField({
  objectKey,
  recordId,
  field,
  value,
  refLabel,
  fullWidth,
}: {
  objectKey: string;
  recordId: string;
  field: FieldDefLite;
  value: unknown;
  refLabel?: string;
  fullWidth?: boolean;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(value);
  const cfg: FieldConfig = field.config ?? {};
  const readOnly = READONLY.has(field.type);

  const update = trpc.record.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.record.get.invalidate({ objectKey, id: recordId }),
        utils.record.related.invalidate(),
        utils.record.list.invalidate(),
      ]);
      setEditing(false);
    },
  });

  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);

  return (
    <div className={`rfield${fullWidth ? ' rfield--full' : ''}`}>
      <div className="rfield__lbl">
        {field.label}
        {field.required && <span className="req">*</span>}
      </div>
      {editing ? (
        <div className="rfield__edit">
          <FieldInput
            field={field}
            value={draft}
            onChange={setDraft}
            referenceValue={
              field.type === 'reference' && draft
                ? { value: String(draft), label: refLabel ?? String(draft) }
                : null
            }
            loadReference={(q) =>
              utils.record.searchRefs.fetch({ objectKey: cfg.targetObject ?? '', q })
            }
          />
          <div className="rfield__edit-actions">
            <Button
              size="sm"
              variant="primary"
              loading={update.isPending}
              onClick={() =>
                update.mutate({ objectKey, id: recordId, data: { [field.key]: draft } })
              }
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : readOnly ? (
        <div className={`rfield__val${empty ? ' rfield__val--empty' : ''}`}>
          {empty ? '—' : <FieldValue field={field} value={value} referenceLabel={refLabel} />}
        </div>
      ) : (
        <div
          className="rfield__disp"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          title="Click to edit"
        >
          <span className={empty ? 'rfield__val--empty' : undefined}>
            {empty ? 'Empty' : <FieldValue field={field} value={value} referenceLabel={refLabel} />}
          </span>
          <PencilIcon />
        </div>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      className="pencil"
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
