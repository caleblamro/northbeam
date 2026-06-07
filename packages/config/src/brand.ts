// Single source of truth for Northbeam's brand surface.
//
// Consumed by:
//   - apps/web/src/app/layout.tsx                 (page metadata)
//   - apps/web/src/components/northbeam/primitives.tsx (Logo + Wordmark)
//   - apps/web/next.config.ts                     (host redirects)
//
// Colors are intentionally NOT here — design tokens live in
// apps/web/src/app/globals.css. The sidebar/TOC brand chips render their
// gradient square inline (matching design_handoff_northbeam .sb__logo).

export const BRAND = {
  name: 'Northbeam',
  wordmark: 'northbeam',
  tagline: 'The CRM that migrates itself',
  description:
    'A Stripe-clean Salesforce alternative with one-click migration — map and import all your historical data in a single click.',

  // Canonical URL.
  url: 'https://northbeam.app',

  // Host aliases that should 308-redirect to `url`. Wired by next.config.ts.
  redirectFrom: ['www.northbeam.app'] as readonly string[],

  fonts: {
    sans: 'Inter',
    mono: 'JetBrains Mono',
  },

  // Minimal "beam" monogram mark. Rendered by the Logo primitive. The
  // dashboard's brand chips use a gradient square with "N" instead (inline).
  logo: {
    viewBox: '0 0 16 16',
    paths: [
      {
        d: 'M3 13 V3 L13 13 V3',
        strokeWidth: 1.8,
        fill: 'none' as const,
        strokeLinecap: 'round' as const,
      },
    ],
    circles: [] as { cx: number; cy: number; r: number }[],
  },
} as const;

export type Brand = typeof BRAND;
