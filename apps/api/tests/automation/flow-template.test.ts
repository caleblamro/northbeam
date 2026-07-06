// Locked-contract coverage for flow-template.ts: typed whole-value
// passthrough vs mixed-text stringification, dot-walk-only resolution with
// missing → null, the seven scopes, malformed/unknown-scope pass-through, and
// collectTemplateRefs recursion (the validate pass maps refs back to fields).

import {
  TEMPLATE_SCOPES,
  type TemplateScopes,
  collectTemplateRefs,
  interpolate,
  parseTemplate,
} from '@northbeam/core';
import { describe, expect, it } from 'vitest';

const scopes: TemplateScopes = {
  record: { name: 'Acme', amount: 250, won: true, note: null, owner: { id: 'u1' } },
  oldRecord: { amount: 100 },
  vars: { deals: [{ id: 'd1' }], greeting: 'hi' },
  loopItem: { id: 'd1', stage: 'open' },
  now: '2026-07-05T12:00:00.000Z',
  user: { id: 'u9', email: 'ops@example.com' },
  webhook: { body: { event: 'ping' } },
};

describe('parseTemplate', () => {
  it('splits text and refs, keeping surrounding literals', () => {
    expect(parseTemplate('Deal {{record.name}} closed')).toEqual([
      { kind: 'text', text: 'Deal ' },
      { kind: 'ref', ref: { scope: 'record', path: ['name'], raw: 'record.name' } },
      { kind: 'text', text: ' closed' },
    ]);
  });

  it('allows whitespace inside the braces only', () => {
    expect(parseTemplate('{{ record.name }}')).toEqual([
      { kind: 'ref', ref: { scope: 'record', path: ['name'], raw: 'record.name' } },
    ]);
  });

  it('treats malformed expressions and unknown scopes as literal text', () => {
    expect(parseTemplate('{{record..name}}')).toEqual([{ kind: 'text', text: '{{record..name}}' }]);
    expect(parseTemplate('{{secrets.apiKey}}')).toEqual([
      { kind: 'text', text: '{{secrets.apiKey}}' },
    ]);
    expect(parseTemplate('{{record.a-b}}')).toEqual([{ kind: 'text', text: '{{record.a-b}}' }]);
  });

  it('parses a bare scope ref with an empty path', () => {
    expect(parseTemplate('{{now}}')).toEqual([
      { kind: 'ref', ref: { scope: 'now', path: [], raw: 'now' } },
    ]);
  });
});

describe('interpolate — typed whole-value passthrough', () => {
  it('keeps the referenced type when the value is exactly one {{expr}}', () => {
    expect(interpolate('{{record.amount}}', scopes)).toBe(250);
    expect(interpolate('{{record.won}}', scopes)).toBe(true);
    expect(interpolate('{{vars.deals}}', scopes)).toEqual([{ id: 'd1' }]);
    expect(interpolate('{{record.owner}}', scopes)).toEqual({ id: 'u1' });
  });

  it('resolves missing paths, null values, and walks into scalars to null', () => {
    expect(interpolate('{{record.missing}}', scopes)).toBeNull();
    expect(interpolate('{{record.note}}', scopes)).toBeNull();
    expect(interpolate('{{record.amount.cents}}', scopes)).toBeNull();
    expect(interpolate('{{loopItem.stage}}', { record: {} })).toBeNull();
  });
});

describe('interpolate — mixed text stringifies', () => {
  it('joins literals with stringified ref values', () => {
    expect(interpolate('Deal {{record.name}}: {{record.amount}}', scopes)).toBe('Deal Acme: 250');
    expect(interpolate('won={{record.won}}', scopes)).toBe('won=true');
  });

  it('renders resolved nulls as empty string in mixed text', () => {
    expect(interpolate('note: {{record.note}}!', scopes)).toBe('note: !');
    expect(interpolate('x{{record.missing}}y', scopes)).toBe('xy');
  });

  it('JSON-stringifies object refs in mixed text', () => {
    expect(interpolate('owner: {{record.owner}}', scopes)).toBe('owner: {"id":"u1"}');
  });

  it('leaves ref-free strings and malformed expressions untouched', () => {
    expect(interpolate('plain text', scopes)).toBe('plain text');
    expect(interpolate('literal {{not a ref}}', scopes)).toBe('literal {{not a ref}}');
  });
});

describe('interpolate — scopes and recursion', () => {
  it('resolves every declared scope', () => {
    for (const scope of TEMPLATE_SCOPES) {
      expect(interpolate(`{{${scope}}}`, scopes)).toEqual(scopes[scope]);
    }
    expect(interpolate('{{oldRecord.amount}}', scopes)).toBe(100);
    expect(interpolate('{{user.email}}', scopes)).toBe('ops@example.com');
    expect(interpolate('{{webhook.body.event}}', scopes)).toBe('ping');
    expect(interpolate('{{now}}', scopes)).toBe('2026-07-05T12:00:00.000Z');
  });

  it('recurses through arrays and objects, passing non-strings through', () => {
    expect(
      interpolate(
        {
          fields: { name: '{{record.name}}', amount: '{{record.amount}}' },
          to: ['{{user.email}}', 'a@b.c'],
          limit: 50,
          flag: true,
          nothing: null,
        },
        scopes,
      ),
    ).toEqual({
      fields: { name: 'Acme', amount: 250 },
      to: ['ops@example.com', 'a@b.c'],
      limit: 50,
      flag: true,
      nothing: null,
    });
  });
});

describe('collectTemplateRefs', () => {
  it('collects refs recursively in encounter order, duplicates included', () => {
    const refs = collectTemplateRefs({
      subject: 'Deal {{record.name}}',
      body: '{{record.name}} owned by {{user.email}}',
      headers: { 'X-Id': '{{vars.greeting}}' },
      to: ['{{loopItem.id}}'],
    });
    expect(refs.map((r) => r.raw)).toEqual([
      'record.name',
      'record.name',
      'user.email',
      'vars.greeting',
      'loopItem.id',
    ]);
  });

  it('never reports malformed or unknown-scope expressions', () => {
    expect(collectTemplateRefs('{{nope.x}} {{record..y}} {{record.ok}}')).toEqual([
      { scope: 'record', path: ['ok'], raw: 'record.ok' },
    ]);
    expect(collectTemplateRefs(42)).toEqual([]);
    expect(collectTemplateRefs(null)).toEqual([]);
  });
});
