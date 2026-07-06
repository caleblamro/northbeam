// The migration "handshake" (M3): a centered SF → Northbeam beam diagram,
// one plain-language promise, the OAuth CTA, and — instead of marketing
// bullets — the actual five-stage sync pipeline stated step by step, so the
// user knows exactly what will run before they authorize anything. Falls
// back to the dev CLI token flow when no Connected App is configured.

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { AlertCircle, ArrowRight } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const PIPELINE: Array<{ title: string; body: string; meta: React.ReactNode }> = [
  {
    title: 'Discover',
    body: 'Objects, fields, record types, picklists — read over the REST describe API.',
    meta: <code className="rounded-[3px] bg-muted px-1">GET /sobjects/describe</code>,
  },
  {
    title: 'Map',
    body: 'Every field matched to a native type with a confidence score; low scores get flagged.',
    meta: 'adjustable mid-run',
  },
  {
    title: 'Build',
    body: 'Real Postgres tables per object — typed columns and indexes, not JSON blobs.',
    meta: <code className="rounded-[3px] bg-muted px-1">deal · f_amount …</code>,
  },
  {
    title: 'Import',
    body: 'Records stream in pages, in dependency order, resumable if interrupted.',
    meta: '200-row pages',
  },
  {
    title: 'Link & compute',
    body: 'References resolve across objects; formulas and rollups recompute as records land.',
    meta: 'by Salesforce Id',
  },
];

export function ConnectScreen({
  oauthConfigured,
  status,
}: {
  oauthConfigured: boolean;
  status: string | null;
}) {
  return (
    <div className="reveal mx-auto flex max-w-2xl flex-col items-center pt-8 text-center">
      {/* SF → beam → N */}
      <div className="flex items-center justify-center gap-4">
        <span className="grid size-11 flex-none place-items-center rounded-xl border border-[var(--border-strong)] bg-card font-medium font-mono text-muted-foreground text-sm shadow-xs">
          SF
        </span>
        <span className="migrate-beam" />
        <span className="grid size-11 flex-none place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs">
          <svg
            viewBox="0 0 16 16"
            className="size-[17px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 13 V3 L13 13 V3" />
          </svg>
        </span>
      </div>

      <h1 className="mt-6 font-semibold text-3xl tracking-[-0.025em]">
        Bring your Salesforce across
      </h1>
      <p className="mt-3 max-w-md text-[0.9375rem] text-muted-foreground leading-relaxed">
        One authorization, one pass. Here's exactly what runs — nothing more.
      </p>

      {status === 'error' && (
        <Callout variant="danger" icon={AlertCircle} className="mt-5 text-left">
          The stored connection token expired or was revoked — reconnect to continue.
        </Callout>
      )}

      <div className="mt-6">
        {oauthConfigured ? (
          <a href={`${API_URL}/api/salesforce/oauth/start`} className="inline-block">
            <Button size="lg">
              Connect Salesforce
              <ArrowRight />
            </Button>
          </a>
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-left text-foreground text-sm">
            <span className="font-medium">Dev setup:</span> no Connected App configured. Seed a
            connection from your sf CLI session instead:
            <pre className="mt-2 font-mono text-muted-foreground text-xs">
              pnpm --filter @northbeam/api sf:dev-connect &lt;orgId&gt; testOrg
            </pre>
          </div>
        )}
      </div>
      <p className="mt-3 text-muted-foreground text-sm">
        Read-only OAuth · nothing is written back to Salesforce · ~3 minutes for most orgs
      </p>

      {/* The sync, step by step — one tile per stage. */}
      <div className="mt-8 grid w-full grid-cols-1 overflow-hidden rounded-xl border border-border bg-card text-left shadow-xs sm:grid-cols-5">
        {PIPELINE.map((step, i) => (
          <div
            key={step.title}
            className="border-border/60 border-t p-4 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0"
          >
            <span className="grid size-[22px] place-items-center rounded-full bg-[var(--accent-soft)] font-medium font-mono text-[11px] text-[var(--accent)]">
              {i + 1}
            </span>
            <div className="mt-3 font-semibold text-sm">{step.title}</div>
            <p className="mt-1 text-muted-foreground text-xs leading-snug">{step.body}</p>
            <div className="mt-2 font-mono text-[10.5px] text-muted-foreground">{step.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
