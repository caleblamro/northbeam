# Conventions

- TS everywhere, types at every boundary (Zod for external input, Drizzle internally).
- No raw SQL — always Drizzle.
- Design tokens live in `apps/web/src/app/globals.css` (`@theme`).
- Two-tier components: `components/ui/*` (shadcn: cva + cn + Radix) and
  `components/northbeam/*` (brand-faithful ports of `design_handoff_northbeam/`).
- Biome for lint + format. Single quotes, semicolons, trailing commas, 100 cols.
