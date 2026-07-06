// AuthSplitShell — the A1 split-panel shell shared by the (auth) and
// (onboarding) route groups. Left 45%: a brand panel on --brand (near-black
// in light mode, flips near-white in dark) with the beam monogram, the
// tagline, and a slow animated accent beam. Right 55%: a centered form
// column — pages render their form directly, no card box (the split itself
// is the frame). Below lg the panel collapses and a small wordmark header
// keeps brand continuity.

import { Wordmark } from '@/components/northbeam/primitives';
import { BRAND } from '@northbeam/config';

/** Muted ink on the brand panel — contrast color at reduced strength so it
 *  resolves correctly on both the light (near-black) and dark (near-white)
 *  panel fills. */
const panelMuted = (pct: number) => ({
  color: `color-mix(in srgb, var(--brand-contrast) ${pct}%, transparent)`,
});

export function AuthSplitShell({
  children,
  width = 400,
}: {
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <aside
        className="hidden w-[45%] flex-col justify-between bg-[var(--brand)] p-10 text-[var(--brand-contrast)] lg:flex"
        aria-hidden
      >
        <div className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 16 16"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label={BRAND.name}
          >
            <path d="M3 13 V3 L13 13 V3" />
          </svg>
          <span className="font-semibold text-lg tracking-[-0.02em]">{BRAND.wordmark}</span>
        </div>

        <div className="max-w-[400px]">
          <h2 className="font-semibold text-3xl leading-[1.15] tracking-[-0.025em]">
            {BRAND.tagline}.
          </h2>
          <p className="mt-4 text-[0.9375rem] leading-relaxed" style={panelMuted(70)}>
            Connect Salesforce once — objects, fields, records, and reports rebuild themselves here,
            on native Postgres.
          </p>
          <p className="mt-5 font-mono text-xs tabular-nums" style={panelMuted(55)}>
            480 records · 214 fields · one click
          </p>
          <div className="auth-beam mt-6" />
        </div>

        <p className="text-xs" style={panelMuted(50)}>
          Native per-org Postgres · Row-level security · Read-only Salesforce OAuth
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full" style={{ maxWidth: width }}>
          <div className="mb-8 lg:hidden">
            <Wordmark size={18} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
