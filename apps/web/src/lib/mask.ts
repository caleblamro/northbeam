// Input formatting helpers — ported from design_handoff_northbeam/lib-inputs.jsx.
// Mask tokens: 9 = digit, A = letter, * = alnum; any other char is a literal.

export function applyMask(raw: string, mask: string): string {
  const v = (raw || '').toString();
  let out = '';
  let vi = 0;
  const isOk = (c: string, t: string) =>
    t === '9' ? /\d/.test(c) : t === 'A' ? /[a-z]/i.test(c) : /[a-z0-9]/i.test(c);
  for (let mi = 0; mi < mask.length && vi < v.length; mi++) {
    const m = mask[mi] as string;
    if (m === '9' || m === 'A' || m === '*') {
      while (vi < v.length && !isOk(v[vi] as string, m)) vi++;
      if (vi < v.length) {
        out += v[vi];
        vi++;
      }
    } else {
      out += m;
      if (v[vi] === m) vi++;
    }
  }
  return out;
}

/** US phone — formats digits as (999) 999-9999. */
export function formatPhone(v: string): string {
  return applyMask(v.replace(/\D/g, ''), '(999) 999-9999');
}

/** Thousands-grouped currency, trimming to 2 decimals. */
export function groupCurrency(v: string): string {
  const cleaned = v.replace(/[^\d.]/g, '');
  const [int, dec] = cleaned.split('.');
  const gi = (int || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec != null ? `${gi}.${dec.slice(0, 2)}` : gi;
}
