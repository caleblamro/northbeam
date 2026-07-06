// SSRF guard matrix — pure: dns lookups and fetch are injected mocks, no
// network is touched. Covers the address blocklist, all-addresses rejection,
// redirect re-validation + cap, response size cap, and 5xx-only retries.

import { describe, expect, it, vi } from 'vitest';
import {
  type AddressLookup,
  WebhookGuardError,
  assertPublicUrl,
  guardedFetch,
  isForbiddenAddress,
  resolveValidated,
} from '../../src/automation/webhook-guard.js';

const PUBLIC_V4 = '93.184.216.34';

const lookupTable =
  (table: Record<string, Array<{ address: string; family: number }>>): AddressLookup =>
  async (hostname) => {
    const entry = table[hostname];
    if (!entry) throw new Error(`ENOTFOUND ${hostname}`);
    return entry;
  };

describe('isForbiddenAddress', () => {
  const forbiddenV4 = [
    '127.0.0.1', // loopback
    '127.255.255.254',
    '10.0.0.1', // RFC1918
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // link-local / cloud metadata
    '100.64.0.1', // CGN
    '100.127.255.255',
    '0.0.0.0',
    '224.0.0.1', // multicast
    '255.255.255.255', // broadcast
    '198.18.0.1', // benchmarking
    '192.0.2.10', // documentation
  ];
  it.each(forbiddenV4)('rejects %s', (ip) => {
    expect(isForbiddenAddress(ip, 4)).toBe(true);
  });

  const allowedV4 = [PUBLIC_V4, '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1'];
  it.each(allowedV4)('allows %s', (ip) => {
    expect(isForbiddenAddress(ip, 4)).toBe(false);
  });

  const forbiddenV6 = [
    '::1',
    '::',
    'fc00::1', // ULA
    'fd12:3456::1',
    'fe80::1', // link-local
    'ff02::1', // multicast
    '::ffff:10.0.0.1', // v4-mapped private
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1', // NAT64
  ];
  it.each(forbiddenV6)('rejects %s', (ip) => {
    expect(isForbiddenAddress(ip, 6)).toBe(true);
  });

  it('allows public IPv6 and v4-mapped public', () => {
    expect(isForbiddenAddress('2600::1', 6)).toBe(false);
    expect(isForbiddenAddress(`::ffff:${PUBLIC_V4}`, 6)).toBe(false);
  });

  it('rejects unparseable input by default', () => {
    expect(isForbiddenAddress('not-an-ip')).toBe(true);
    expect(isForbiddenAddress('999.1.1.1', 4)).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  const lookup = lookupTable({
    'good.example': [{ address: PUBLIC_V4, family: 4 }],
    'evil.example': [{ address: '10.0.0.5', family: 4 }],
    'mixed.example': [
      { address: PUBLIC_V4, family: 4 },
      { address: '192.168.0.9', family: 4 }, // one private A record poisons all
    ],
  });

  it('accepts a public https host', async () => {
    await expect(
      assertPublicUrl(new URL('https://good.example/x'), lookup),
    ).resolves.toBeUndefined();
  });

  it('rejects non-https', async () => {
    await expect(assertPublicUrl(new URL('http://good.example/'), lookup)).rejects.toThrow(
      WebhookGuardError,
    );
  });

  it('rejects embedded credentials', async () => {
    await expect(assertPublicUrl(new URL('https://user:pw@good.example/'), lookup)).rejects.toThrow(
      /credentials/,
    );
  });

  it('rejects localhost names without a lookup', async () => {
    await expect(assertPublicUrl(new URL('https://localhost/'), lookup)).rejects.toThrow(
      WebhookGuardError,
    );
    await expect(assertPublicUrl(new URL('https://foo.localhost/'), lookup)).rejects.toThrow(
      WebhookGuardError,
    );
  });

  it('rejects IP-literal hosts in forbidden ranges', async () => {
    await expect(assertPublicUrl(new URL('https://127.0.0.1/'), lookup)).rejects.toThrow(
      /forbidden/,
    );
    await expect(assertPublicUrl(new URL('https://169.254.169.254/meta'), lookup)).rejects.toThrow(
      /forbidden/,
    );
    await expect(assertPublicUrl(new URL('https://[::1]/'), lookup)).rejects.toThrow(/forbidden/);
  });

  it('rejects hosts resolving to private addresses', async () => {
    await expect(assertPublicUrl(new URL('https://evil.example/'), lookup)).rejects.toThrow(
      /forbidden address 10\.0\.0\.5/,
    );
  });

  it('rejects when ANY resolved address is private', async () => {
    await expect(assertPublicUrl(new URL('https://mixed.example/'), lookup)).rejects.toThrow(
      /192\.168\.0\.9/,
    );
  });

  it('rejects unresolvable hosts', async () => {
    await expect(assertPublicUrl(new URL('https://nope.example/'), lookup)).rejects.toThrow(
      /did not resolve/,
    );
  });
});

describe('resolveValidated (address pinning — DNS-rebinding closure)', () => {
  it('returns the exact validated address set the connector must dial', async () => {
    const lookup = lookupTable({ 'good.example': [{ address: PUBLIC_V4, family: 4 }] });
    const pinned = await resolveValidated(new URL('https://good.example/x'), lookup);
    expect(pinned).toEqual([{ address: PUBLIC_V4, family: 4 }]);
  });

  it('resolves the host exactly once (no separate connect-time query to rebind)', async () => {
    const lookup = vi.fn(async () => [{ address: PUBLIC_V4, family: 4 }]);
    await resolveValidated(new URL('https://good.example/x'), lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('pins an IP literal to itself with no DNS at all', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('DNS must not be queried for an IP literal');
    });
    const pinned = await resolveValidated(new URL(`https://${PUBLIC_V4}/x`), lookup);
    expect(pinned).toEqual([{ address: PUBLIC_V4, family: 4 }]);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('guardedFetch', () => {
  const lookup = lookupTable({
    'api.example': [{ address: PUBLIC_V4, family: 4 }],
    'hop.example': [{ address: '93.184.216.35', family: 4 }],
    'internal.example': [{ address: '10.1.2.3', family: 4 }],
  });

  it('returns the response with status/body for a plain 200', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    const res = await guardedFetch('https://api.example/hook', {
      method: 'POST',
      body: '{"a":1}',
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body).toBe('{"ok":true}');
    expect(res.attempts).toBe(1);
    expect(res.redirects).toBe(0);
    // default content-type applied when a body is present
    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('follows redirects, re-validating each hop', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith('https://api.example')
        ? new Response(null, { status: 302, headers: { location: 'https://hop.example/next' } })
        : new Response('done', { status: 200 }),
    );
    const res = await guardedFetch('https://api.example/start', {
      method: 'GET',
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(res.redirects).toBe(1);
    expect(res.url).toBe('https://hop.example/next');
  });

  it('rejects a redirect into a private host', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://internal.example/x' } }),
    );
    await expect(
      guardedFetch('https://api.example/start', {
        method: 'GET',
        lookup,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/forbidden address 10\.1\.2\.3/);
  });

  it('rejects a redirect that downgrades to http', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://api.example/x' } }),
    );
    await expect(
      guardedFetch('https://api.example/start', {
        method: 'GET',
        lookup,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/https/);
  });

  it('caps the redirect chain', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://api.example/again' } }),
    );
    await expect(
      guardedFetch('https://api.example/start', {
        method: 'GET',
        maxRedirects: 3,
        lookup,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 followed hops
  });

  it('303 demotes the method to a bodiless GET', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.example/start') {
        return new Response(null, { status: 303, headers: { location: 'https://hop.example/x' } });
      }
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      return new Response('ok', { status: 200 });
    });
    const res = await guardedFetch('https://api.example/start', {
      method: 'POST',
      body: '{"a":1}',
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
  });

  it('truncates responses at the size cap', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(5000), { status: 200 }));
    const res = await guardedFetch('https://api.example/big', {
      method: 'GET',
      maxResponseBytes: 1000,
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.truncated).toBe(true);
    expect(res.body).toHaveLength(1000);
  });

  it('retries 5xx up to maxAttempts, then returns the last response', async () => {
    const responses = [500, 503, 502];
    const fetchImpl = vi.fn(
      async () =>
        new Response('err', { status: responses[fetchImpl.mock.calls.length - 1] ?? 502 }),
    );
    const res = await guardedFetch('https://api.example/flaky', {
      method: 'POST',
      body: '{}',
      maxAttempts: 3,
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(502);
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3);
  });

  it('recovers when a retry succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? new Response('err', { status: 500 }) : new Response('ok', { status: 200 });
    });
    const res = await guardedFetch('https://api.example/flaky', {
      method: 'GET',
      maxAttempts: 3,
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(res.attempts).toBe(3);
  });

  it('never retries 4xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 }));
    const res = await guardedFetch('https://api.example/bad', {
      method: 'GET',
      maxAttempts: 3,
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
  });

  it('strips hop-by-hop headers from caller input', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok', { status: 200 }),
    );
    await guardedFetch('https://api.example/x', {
      method: 'GET',
      headers: { Host: 'spoof', 'X-Custom': 'yes', 'Content-Length': '999' },
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const sent = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sent['X-Custom']).toBe('yes');
    expect(sent.Host).toBeUndefined();
    expect(sent['Content-Length']).toBeUndefined();
  });
});
