# apps/web — Claude conventions

Next.js 16 dashboard. Auth-gated CRM screens live under `src/app/(app)/*`; auth flows under `(auth)`; org bootstrap under `(onboarding)`; the design-system gallery under `(system)`.

## Where to put a new thing

- **New route**: add a directory under `src/app/(app)/<slug>/` with `page.tsx`. Update `src/lib/nav.ts` — add an entry to `LAUNCHER_TILES` (drives the App Launcher waffle) and a `PAGE_META` entry (drives the page header).
- **New shared component**: in `src/components/northbeam/*` if it's brand-faithful CRM UI (header it `// Direct port of design_handoff_northbeam/<file>`); in `src/components/ui/*` if it's a low-level primitive (cva + Radix + `cn`). Reuse `Icon` from `northbeam/icons.tsx` — it maps Phosphor names to lucide-react.
- **New tRPC call**: import `trpc` from `@/lib/api`. Use `trpc.<router>.<procedure>.useQuery({})` or `.useMutation({})`. No need to define types — `AppRouter` is imported from `@northbeam/api/trpc`, fully end-to-end-typed.
- **New design token**: `src/app/globals.css` (`@theme`) or `tokens.css`. Don't add hex values to components — reference `var(--ink)`, `var(--brand)`, etc.

## Shell architecture (Salesforce Lightning style)

The app shell is a two-row top nav. No left sidebar.

```
┌─────────────────────────────────────────────────────────────┐
│ ⋮⋮⋮ N · OrgName │ Home Accounts Contacts Deals Activities + │  ← app-toptabs.tsx
│ [🔍 Search Northbeam…]                   ❓ 🔔 ☀  OrgSwitcher JM▾│  ← app-topbar.tsx
└─────────────────────────────────────────────────────────────┘
```

Key files:

- `components/northbeam/app-shell.tsx` — owns auth gate, ⌘K palette, page-head context.
- `components/northbeam/app-toptabs.tsx` — row 1: App Launcher + brand + pinnable horizontal tabs.
- `components/northbeam/app-launcher.tsx` — 9-dot waffle popover with searchable tile grid.
- `components/northbeam/app-topbar.tsx` — row 2: search + org switcher + actions + user.
- `lib/pinned-tabs.ts` — per-user pinned tab list (localStorage-backed). Home is always pinned first.

## Page contracts

Every `(app)/<page>` is a Client Component (`'use client'`) that:
1. Calls tRPC for its data.
2. Optionally renders `<PageActions>` with right-side header buttons (registers via context — don't re-declare a page header).
3. Optionally renders `<HidePageHead/>` to suppress the layout-owned header (record-detail does this).
4. Reads tone/color tokens via CSS vars, not hex.

## Mock data

`src/lib/mock-crm.ts` exports legacy `ACCOUNTS/CONTACTS/DEALS/ACTIVITIES` plus utilities (`fmtMoney`, `accountById`). Only `fmtMoney` should still be imported by new code. Wire real pages through tRPC.

## Test the change

- `pnpm --filter @northbeam/web typecheck` — should be clean before submitting.
- `pnpm --filter @northbeam/web dev` — runs Next on :3000. The API must be running on :8000 separately (or use `pnpm dev` at the root to spin both via Turbo).

## Component library: two layers (transitional)

The app is mid-migration to a single design system. Two layers coexist:

- **`src/components/ui/*`** — DiceUI primitives (shadcn-style). The target stack. New code should use these: Button, Input, InputGroup, Textarea, Select, Command, Dialog, Popover, HoverCard, Table, Stat, Separator, Card, Kanban, Timeline, MaskInput, PhoneInput, Rating, QRCode, RelativeTimeCard, etc. Import as `from '@/components/ui/<name>'`.

- **`src/components/northbeam/*-legacy.tsx`** — handoff-ported primitives kept for backwards compatibility while existing pages get migrated: `button-legacy.tsx` (Button, IconButton, MenuButton, SplitButton + `variant: primary|secondary|ghost|link|danger` + `icon`, `iconRight`, `loading`, `block` props), `input-legacy.tsx` (Field, TextInput, EmailInput, PhoneInput, CurrencyInput, MaskedInput), `command-legacy.tsx` (CommandPalette), `select-legacy.tsx` (NativeSelect, Select, Combobox).

**Rules:**
- **New features and refactors must use the DiceUI primitives from `ui/`**. Don't introduce new imports of `*-legacy` files.
- **Don't write raw `<div>` walls.** Use Card / CardHeader / CardContent / Stack / Stat / Separator / Table from `ui/` for layout. Avoid inline Tailwind walls; use the component slots instead.
- **No inline ad-hoc Button replacements** (`<button className="...">`). Use the DiceUI `<Button>`.
- When refactoring a legacy file to DiceUI, swap the import and update the props in the same PR; don't mix the two systems within one file.

The end state is one set of primitives + Northbeam-specific wrappers that compose them. The legacy files will be deleted once their usages have been migrated.

## Common pitfalls

- **Cross-origin cookies**: auth cookies live on the API origin (`:8000`), not on the web origin. RSCs cannot read them. Always bootstrap auth client-side via `trpc.me.bootstrap`.
- **Adding an icon**: register the Phosphor → lucide mapping in `components/northbeam/icons.tsx`. Verify the lucide name exists (`node -e "console.log(!!require('lucide-react').XYZ)"`).
- **`tabular-nums` for numbers**: the design uses `font-variant-numeric: tabular-nums` for every numeric column — keep it consistent.
