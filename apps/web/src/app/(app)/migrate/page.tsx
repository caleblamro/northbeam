'use client';

// The Salesforce migration wizard, wired to the real pipeline:
// connect (OAuth or dev token) → pick objects → review the auto-mapping →
// execute → live progress → summary. State machine follows migration_run.status.

import { ObjChip } from '@/components/northbeam/app-bits';
import { Icon } from '@/components/northbeam/icons';
import { EmptyState } from '@/components/northbeam/page-head';
import { Spinner } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import Link from 'next/link';
import { useMemo, useState } from 'react';

// Dev default mirrors lib/api/provider.tsx.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function MigratePage() {
  const status = trpc.salesforce.status.useQuery();
  const latest = trpc.salesforce.latestRun.useQuery(undefined, {
    enabled: Boolean(status.data?.connected),
  });
  // null = follow latest; 'new' = force the discover screen; otherwise a run id.
  const [override, setOverride] = useState<string | null>(null);
  const runId = override === 'new' ? null : (override ?? latest.data?.id ?? null);

  if (status.isLoading || (status.data?.connected && latest.isLoading)) {
    return <Centered spinner />;
  }
  if (!status.data?.connected) {
    return (
      <ConnectScreen
        oauthConfigured={status.data?.oauthConfigured ?? false}
        status={status.data?.status ?? null}
      />
    );
  }
  if (!runId) return <DiscoverScreen onCreated={setOverride} />;
  return <RunScreen key={runId} runId={runId} onStartOver={() => setOverride('new')} />;
}

/* ── 1 · connect ────────────────────────────────────────────────────────────── */
function ConnectScreen({
  oauthConfigured,
  status,
}: {
  oauthConfigured: boolean;
  status: string | null;
}) {
  return (
    <div className="rcard" style={{ maxWidth: 560 }}>
      <div className="rcard__body" style={{ display: 'grid', gap: 12, padding: 28 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Connect your Salesforce org</h2>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
          Northbeam reads your objects, fields, record types, and records through the Salesforce
          API, maps them onto native objects, and imports everything in one run.
        </p>
        {status === 'error' && (
          <p style={{ margin: 0, color: 'var(--danger)' }}>
            The stored connection token expired or was revoked — reconnect to continue.
          </p>
        )}
        {oauthConfigured ? (
          <a href={`${API_URL}/api/salesforce/oauth/start`} style={{ justifySelf: 'start' }}>
            <Button variant="primary" icon="arrows-clockwise">
              Connect Salesforce
            </Button>
          </a>
        ) : (
          <div
            style={{
              background: 'var(--surface-sunken)',
              borderRadius: 'var(--radius-md)',
              padding: 14,
              fontSize: 'var(--text-sm)',
              color: 'var(--ink-secondary)',
            }}
          >
            <b>Dev setup:</b> no Connected App configured (SF_CLIENT_ID / SF_TOKEN_KEY). Seed a
            connection from your sf CLI session instead:
            <pre style={{ margin: '8px 0 0', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              pnpm --filter @northbeam/api sf:dev-connect &lt;orgId&gt; testOrg
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 2 · discover & pick objects ────────────────────────────────────────────── */
function DiscoverScreen({ onCreated }: { onCreated: (runId: string) => void }) {
  const discover = trpc.salesforce.discover.useQuery();
  const createRun = trpc.salesforce.createRun.useMutation({
    onSuccess: (r) => onCreated(r.runId),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (discover.isError) {
    return (
      <EmptyState
        icon="warning-circle"
        title="Couldn't reach Salesforce"
        body={discover.error.message}
      />
    );
  }
  if (!discover.data) return <Centered spinner label="Reading your org's objects…" />;

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="toolbar">
        <span style={{ color: 'var(--ink-muted)' }}>
          {discover.data.length} importable objects · {picked.size} selected
        </span>
        <span className="toolbar__spacer" />
        <Button
          variant="primary"
          icon="arrow-right"
          disabled={picked.size === 0}
          loading={createRun.isPending}
          onClick={() => createRun.mutate({ objects: [...picked] })}
        >
          Analyze {picked.size || ''} object{picked.size === 1 ? '' : 's'}
        </Button>
      </div>
      {createRun.isPending && (
        <Centered spinner label="Describing objects and sampling records — this takes a moment…" />
      )}
      <div className="tbl-card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th>Object</th>
              <th>API name</th>
              <th>Maps to</th>
              <th className="right">Records</th>
            </tr>
          </thead>
          <tbody>
            {discover.data.map((o) => (
              <tr key={o.name} data-clickable="true" onClick={() => toggle(o.name)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={picked.has(o.name)}
                    onChange={() => toggle(o.name)}
                  />
                </td>
                <td>
                  <b style={{ fontWeight: 600 }}>{o.labelPlural}</b>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{o.name}</td>
                <td>
                  {o.standardTarget ? (
                    <span className="chip">→ {o.standardTarget}</span>
                  ) : (
                    <span className="chip" style={{ color: 'var(--ink-muted)' }}>
                      new object
                    </span>
                  )}
                </td>
                <td className="right">
                  <span className="num">{o.count?.toLocaleString() ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 3+4+5 · review / progress / summary, keyed off run status ──────────────── */
function RunScreen({ runId, onStartOver }: { runId: string; onStartOver: () => void }) {
  const run = trpc.salesforce.getRun.useQuery(
    { runId },
    { refetchInterval: (q) => (q.state.data?.run.status === 'running' ? 1500 : false) },
  );
  const utils = trpc.useUtils();
  const execute = trpc.salesforce.execute.useMutation({
    onSuccess: () => utils.salesforce.getRun.invalidate({ runId }),
  });
  const setField = trpc.salesforce.setFieldStatus.useMutation({
    onSuccess: () => utils.salesforce.getRun.invalidate({ runId }),
  });

  if (run.isLoading || !run.data) return <Centered spinner />;
  const { run: r, objects } = run.data;
  const stats = r.stats ?? {};

  if (r.status === 'running') {
    return (
      <div className="rcard" style={{ maxWidth: 640 }}>
        <div className="rcard__body" style={{ display: 'grid', gap: 14, padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Spinner style={{ color: 'var(--brand)' }} />
            <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>
              Importing{stats.currentObject ? ` — ${stats.currentObject}` : '…'}
            </h2>
          </div>
          <StatsRow stats={stats} />
        </div>
      </div>
    );
  }

  if (r.status === 'completed' || r.status === 'failed') {
    return (
      <div className="rcard" style={{ maxWidth: 640 }}>
        <div className="rcard__body" style={{ display: 'grid', gap: 14, padding: 28 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>
            {r.status === 'completed' ? 'Migration complete' : 'Migration failed'}
          </h2>
          {r.status === 'failed' && stats.error && (
            <p style={{ margin: 0, color: 'var(--danger)' }}>{stats.error}</p>
          )}
          <StatsRow stats={stats} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {r.status === 'completed' &&
              objects
                .filter((o) => o.action !== 'skip')
                .map((o) => {
                  const meta = o.meta as { targetKey?: string; labelPlural?: string };
                  return (
                    <Link key={o.id} href={`/${meta.targetKey ?? o.sfObject}`}>
                      <Button variant="secondary" iconRight="arrow-right">
                        View {meta.labelPlural ?? o.sfLabel ?? o.sfObject}
                      </Button>
                    </Link>
                  );
                })}
            {r.status === 'failed' && (
              <Button
                variant="primary"
                loading={execute.isPending}
                onClick={() => execute.mutate({ runId })}
              >
                Retry import
              </Button>
            )}
            <Button variant="ghost" onClick={onStartOver}>
              Start a new run
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // status: mapping / ready → review
  const totals = objects.reduce(
    (acc, o) => {
      for (const f of o.fields) {
        if (f.status === 'mapped') acc.mapped++;
        else if (f.status === 'review') acc.review++;
        else acc.skip++;
      }
      return acc;
    },
    { mapped: 0, review: 0, skip: 0 },
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="toolbar">
        <span style={{ color: 'var(--ink-muted)' }}>
          {objects.length} objects · {totals.mapped} fields mapped · {totals.review} need review ·{' '}
          {totals.skip} skipped
        </span>
        <span className="toolbar__spacer" />
        <Button variant="ghost" onClick={onStartOver}>
          Re-pick objects
        </Button>
        <Button
          variant="primary"
          icon="arrows-clockwise"
          loading={execute.isPending}
          onClick={() => execute.mutate({ runId })}
        >
          Run import
        </Button>
      </div>
      {objects.map((o) => (
        <ObjectMappingCard
          key={o.id}
          object={o}
          onToggleField={(id, current) =>
            setField.mutate({ id, status: current === 'skip' ? 'mapped' : 'skip' })
          }
        />
      ))}
    </div>
  );
}

type RunObject = {
  id: string;
  sfObject: string;
  sfLabel: string | null;
  action: string;
  recordCount: number;
  meta: Record<string, unknown>;
  fields: Array<{
    id: string;
    sfField: string;
    sfType: string | null;
    status: string;
    confidence: number;
    meta: Record<string, unknown>;
  }>;
};

function ObjectMappingCard({
  object: o,
  onToggleField,
}: {
  object: RunObject;
  onToggleField: (id: string, current: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = o.meta as { targetKey?: string };
  const counts = useMemo(
    () => ({
      mapped: o.fields.filter((f) => f.status === 'mapped').length,
      review: o.fields.filter((f) => f.status === 'review').length,
      skip: o.fields.filter((f) => f.status === 'skip').length,
    }),
    [o.fields],
  );

  return (
    <div className="rcard">
      <button
        type="button"
        className="rcard__head"
        style={{
          width: '100%',
          cursor: 'pointer',
          border: 'none',
          textAlign: 'left',
          font: 'inherit',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <ObjChip label={o.sfLabel ?? o.sfObject} size={22} />
        <span className="rcard__title">
          {o.sfObject} → {meta.targetKey ?? '?'}
        </span>
        <span className="chip">{o.recordCount.toLocaleString()} records</span>
        <span className="count">
          {counts.mapped} mapped · {counts.review} review · {counts.skip} skip
        </span>
        <Icon name={open ? 'caret-up' : 'caret-down'} size={14} />
      </button>
      {open && (
        <div className="tbl-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Salesforce field</th>
                <th>Type</th>
                <th>Northbeam field</th>
                <th className="right">Populated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {o.fields.map((f) => {
                const m = f.meta as {
                  key?: string;
                  type?: string;
                  reason?: string;
                  populatedPct?: number | null;
                };
                return (
                  <tr key={f.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{f.sfField}</td>
                    <td>
                      <span className="chip">{f.sfType}</span>
                    </td>
                    <td>
                      {f.status === 'skip' ? (
                        <span style={{ color: 'var(--ink-subtle)' }}>—</span>
                      ) : (
                        <span>
                          {m.key} <span style={{ color: 'var(--ink-muted)' }}>({m.type})</span>
                        </span>
                      )}
                      {m.reason && (
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{m.reason}</div>
                      )}
                    </td>
                    <td className="right">
                      <span className="num">
                        {m.populatedPct == null ? '—' : `${m.populatedPct}%`}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="chip"
                        style={{
                          cursor: 'pointer',
                          border: 'none',
                          color:
                            f.status === 'mapped'
                              ? 'var(--success)'
                              : f.status === 'review'
                                ? 'var(--warning)'
                                : 'var(--ink-muted)',
                          background:
                            f.status === 'mapped'
                              ? 'var(--success-bg)'
                              : f.status === 'review'
                                ? 'var(--warning-bg)'
                                : 'var(--surface-active)',
                        }}
                        title="Toggle include/skip"
                        onClick={() => onToggleField(f.id, f.status)}
                      >
                        {f.status}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatsRow({ stats }: { stats: Record<string, unknown> }) {
  const items: Array<[string, unknown]> = [
    ['Objects', stats.objects],
    ['Fields', stats.fields],
    ['Records read', stats.records],
    ['Imported', stats.imported],
    ['References linked', stats.refsResolved],
  ];
  return (
    <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
      {items.map(([label, v]) => (
        <div key={label}>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--ink-subtle)',
              fontWeight: 600,
            }}
          >
            {label}
          </div>
          <div className="num" style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
            {typeof v === 'number' ? v.toLocaleString() : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function Centered({ spinner, label }: { spinner?: boolean; label?: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 64, gap: 10 }}>
      {spinner && <Spinner style={{ color: 'var(--brand)' }} />}
      {label && <span style={{ color: 'var(--ink-muted)' }}>{label}</span>}
    </div>
  );
}
