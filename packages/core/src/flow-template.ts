// {{scope.path}} merge templates for flow node configs — the ONLY dynamic
// string mechanism in flows. Deliberately dot-walk only: no functions, no
// operators, no evaluation of any kind (that's the formula engine's job, and
// it never runs on user-composed action strings). Browser-safe pure functions
// shared by the canvas (merge-field insertion + validation of refs) and the
// engine's executors.
//
// Semantics (locked contract):
//   - a value that is EXACTLY one `{{expr}}` (whitespace allowed inside the
//     braces only) resolves to the referenced value with its type intact
//   - any other string containing refs interpolates to a string; resolved
//     nulls render as '' there
//   - a missing path, null scope, or walk into a non-object resolves to null
//   - a malformed expression or unknown scope head stays literal text —
//     collectTemplateRefs never reports it, interpolate never touches it

export const TEMPLATE_SCOPES = [
  'record',
  'oldRecord',
  'vars',
  'loopItem',
  'now',
  'user',
  'webhook',
] as const;

export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

/** One parsed `{{scope.a.b}}` reference. `path` is empty for a bare scope
 *  ref like `{{now}}`. `raw` is the trimmed expression text for messages. */
export type TemplateRef = { scope: TemplateScope; path: string[]; raw: string };

export type TemplateSegment = { kind: 'text'; text: string } | { kind: 'ref'; ref: TemplateRef };

/** Runtime values for each scope, supplied by the engine (this module never
 *  invents them — e.g. `now` is injected, keeping interpolation pure). */
export type TemplateScopes = Partial<Record<TemplateScope, unknown>>;

const TOKEN_RE = /\{\{([^{}]*)\}\}/g;
const EXPR_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;
const SCOPE_SET: ReadonlySet<string> = new Set(TEMPLATE_SCOPES);

function refFromExpr(expr: string): TemplateRef | null {
  if (!EXPR_RE.test(expr)) return null;
  const parts = expr.split('.');
  const head = parts[0];
  if (head === undefined || !SCOPE_SET.has(head)) return null;
  return { scope: head as TemplateScope, path: parts.slice(1), raw: expr };
}

/** Split a string into literal text and `{{ref}}` segments. Malformed or
 *  unknown-scope expressions come back as text segments (pass-through). */
export function parseTemplate(input: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let last = 0;
  let match = re.exec(input);
  while (match !== null) {
    if (match.index > last) segments.push({ kind: 'text', text: input.slice(last, match.index) });
    const ref = refFromExpr((match[1] ?? '').trim());
    if (ref) segments.push({ kind: 'ref', ref });
    else segments.push({ kind: 'text', text: match[0] });
    last = match.index + match[0].length;
    match = re.exec(input);
  }
  if (last < input.length) segments.push({ kind: 'text', text: input.slice(last) });
  return segments;
}

function resolveRef(ref: TemplateRef, scopes: TemplateScopes): unknown {
  let value: unknown = scopes[ref.scope];
  for (const segment of ref.path) {
    if (value === null || value === undefined || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return value === undefined ? null : value;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return '';
    }
  }
  return String(value);
}

function interpolateString(input: string, scopes: TemplateScopes): unknown {
  const segments = parseTemplate(input);
  const first = segments[0];
  if (segments.length === 1 && first?.kind === 'ref') return resolveRef(first.ref, scopes);
  if (!segments.some((s) => s.kind === 'ref')) return input;
  return segments
    .map((s) => (s.kind === 'text' ? s.text : stringifyValue(resolveRef(s.ref, scopes))))
    .join('');
}

/** Resolve templates in a value. Strings interpolate (whole-value single refs
 *  keep their type); arrays and plain objects recurse (node configs hold
 *  nested field maps / header records); everything else passes through. */
export function interpolate(value: unknown, scopes: TemplateScopes): unknown {
  if (typeof value === 'string') return interpolateString(value, scopes);
  if (Array.isArray(value)) return value.map((item) => interpolate(item, scopes));
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolate(item, scopes),
      ]),
    );
  }
  return value;
}

/** Every valid ref in a value (recursing like interpolate), in encounter
 *  order, duplicates included — validation maps each back to its field. */
export function collectTemplateRefs(value: unknown): TemplateRef[] {
  const refs: TemplateRef[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const segment of parseTemplate(v)) {
        if (segment.kind === 'ref') refs.push(segment.ref);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(value);
  return refs;
}
