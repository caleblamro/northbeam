// Relative-date filter tokens. A FilterValue string starting with '@' names
// an instant relative to "now" — '@today', '@startOfMonth', '@-30d' — so a
// saved "last 30 days" view stays correct forever instead of freezing the day
// it was saved. Pure module (no drizzle) shared verbatim by the SQL builder
// (dynamic/filters-sql.ts) and the web matcher (apps/web/src/lib/filters.ts):
// both sides MUST resolve through this one implementation or filter parity
// breaks.
//
// All resolution is UTC — matching the aggregate engine's UTC date_trunc
// (org-local time is out of scope there too). Offsets anchor at the START of
// the current UTC day so a token resolves identically all day long: '@-30d'
// means "midnight UTC, 30 days ago", not a sliding instant.
//
// Grammar:
//   '@today'                              start of the current UTC day
//   '@startOfWeek'                        Monday 00:00 UTC of this week
//   '@startOfMonth' | '@startOfQuarter' | '@startOfYear'
//   '@'  ('+'|'-')  <digits>  ('d'|'w'|'m'|'q'|'y')     offset from today
// Anything else starting with '@' is an unknown token → resolves to null and
// the filter predicate is dropped (same treatment as any unparseable value).

export function isRelativeDateToken(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('@');
}

const OFFSET_RE = /^@([+-])(\d{1,4})([dwmqy])$/;

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Resolve a token to an instant, or null when it isn't in the grammar.
 *  `now` is injectable for tests; defaults to the wall clock. */
export function resolveRelativeDate(token: string, now: Date = new Date()): Date | null {
  if (!isRelativeDateToken(token)) return null;
  const today = startOfUtcDay(now);

  switch (token) {
    case '@today':
      return today;
    case '@startOfWeek': {
      // ISO week — Monday. getUTCDay(): Sun=0 … Sat=6.
      const dow = today.getUTCDay();
      const back = dow === 0 ? 6 : dow - 1;
      return new Date(today.getTime() - back * 86_400_000);
    }
    case '@startOfMonth':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case '@startOfQuarter': {
      const q = Math.floor(now.getUTCMonth() / 3) * 3;
      return new Date(Date.UTC(now.getUTCFullYear(), q, 1));
    }
    case '@startOfYear':
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }

  const m = OFFSET_RE.exec(token);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const n = sign * Number(m[2]);
  switch (m[3]) {
    case 'd':
      return new Date(today.getTime() + n * 86_400_000);
    case 'w':
      return new Date(today.getTime() + n * 7 * 86_400_000);
    case 'm':
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, Math.min(now.getUTCDate(), 28)),
      );
    case 'q':
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n * 3, Math.min(now.getUTCDate(), 28)),
      );
    case 'y':
      return new Date(Date.UTC(now.getUTCFullYear() + n, now.getUTCMonth(), now.getUTCDate()));
    default:
      return null;
  }
}

/** Curated presets for filter UIs (and the AI prompt) — token → human label,
 *  in display order. The grammar accepts more than this list; these are the
 *  ones worth a one-click chip. */
export const RELATIVE_DATE_PRESETS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '@today', label: 'Today' },
  { token: '@-7d', label: 'Last 7 days' },
  { token: '@-30d', label: 'Last 30 days' },
  { token: '@-90d', label: 'Last 90 days' },
  { token: '@startOfWeek', label: 'This week' },
  { token: '@startOfMonth', label: 'This month' },
  { token: '@startOfQuarter', label: 'This quarter' },
  { token: '@startOfYear', label: 'This year' },
];

/** Human label for a token — preset label when curated, the raw token
 *  otherwise (still meaningful: '@-14d'). Non-tokens return null. */
export function relativeDateLabel(value: unknown): string | null {
  if (!isRelativeDateToken(value)) return null;
  return RELATIVE_DATE_PRESETS.find((p) => p.token === value)?.label ?? value;
}
