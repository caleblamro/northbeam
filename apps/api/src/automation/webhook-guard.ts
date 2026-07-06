// SSRF guard for webhook_out — every outbound flow HTTP call goes through
// guardedFetch. Bounded on every axis: https only, DNS-validated hosts
// (dns.lookup ALL addresses — one private A record among public ones is a
// rejection), manual redirects (each hop re-validated, ≤3), hard timeout,
// response size cap, and retries only on 5xx (network errors and 4xx are
// terminal — a flow must not hammer a misconfigured endpoint).
//
// DNS rebinding is CLOSED: resolveValidated() resolves the host ONCE, and the
// production connector (pinnedFetch, node:https) dials that exact validated
// address via a `lookup` that never re-queries DNS — so the address checked
// and the address connected are guaranteed identical. TLS SNI + cert
// validation still run against the original hostname (the socket is pinned to
// the IP; the certificate is verified against the name).
//
// `lookup` and `fetchImpl` are injectable so the test suite exercises the
// full path without touching the network (tests/automation/webhook-guard);
// when `fetchImpl` is omitted, the pinned node:https connector is used.

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export class WebhookGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookGuardError';
  }
}

export type ResolvedAddress = { address: string; family: number };
export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultLookup: AddressLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => ({
    address: r.address,
    family: r.family,
  }));

function ipv4Octets(address: string): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

function isForbiddenIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return true; // unparseable = reject
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGN
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 doc
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 doc
  if (a === 203 && b === 0) return true; // 203.0.113/24 doc
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isForbiddenIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  // v4-mapped/translated forms carry the real target in the tail.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isForbiddenIpv4(mapped[1]);
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('64:ff9b:')) return true; // NAT64
  if (normalized.startsWith('2001:db8:')) return true; // documentation
  const head = normalized.split(':', 1)[0] ?? '';
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(head)) return true; // link-local fe80::/10
  if (/^fec|^fed|^fee|^fef/.test(head)) return true; // site-local fec0::/10
  if (head.startsWith('ff')) return true; // multicast
  return false;
}

/** True when an IP must never be a webhook target. Unknown families and
 *  unparseable addresses are forbidden — reject-by-default. */
export function isForbiddenAddress(address: string, family?: number): boolean {
  const fam = family ?? isIP(address);
  if (fam === 4) return isForbiddenIpv4(address);
  if (fam === 6) return isForbiddenIpv6(address);
  return true;
}

/** Validate one URL hop and return the pinned address set to connect to:
 *  https, no credentials, no forbidden host. Hostnames resolve through
 *  `lookup` ONCE and EVERY returned address must be public; the returned set
 *  is what the connector dials, so there is no second resolution to rebind. */
export async function resolveValidated(
  url: URL,
  lookup: AddressLookup,
): Promise<ResolvedAddress[]> {
  if (url.protocol !== 'https:') {
    throw new WebhookGuardError(`webhook urls must use https (got '${url.protocol}//')`);
  }
  if (url.username || url.password) {
    throw new WebhookGuardError('webhook urls must not embed credentials');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new WebhookGuardError(`webhook host '${host}' is not allowed`);
  }
  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    if (isForbiddenAddress(host)) {
      throw new WebhookGuardError(`webhook host '${host}' resolves to a forbidden address`);
    }
    // No DNS: the literal IS the target — nothing to rebind.
    return [{ address: host, family: literalFamily }];
  }
  let resolved: ResolvedAddress[];
  try {
    resolved = await lookup(host);
  } catch {
    throw new WebhookGuardError(`webhook host '${host}' did not resolve`);
  }
  if (resolved.length === 0) {
    throw new WebhookGuardError(`webhook host '${host}' did not resolve`);
  }
  for (const { address, family } of resolved) {
    if (isForbiddenAddress(address, family)) {
      throw new WebhookGuardError(
        `webhook host '${host}' resolves to forbidden address ${address}`,
      );
    }
  }
  return resolved;
}

/** Void wrapper kept for callers that only need the check (and the guard
 *  test-suite). Prefer resolveValidated when you will connect afterwards. */
export async function assertPublicUrl(url: URL, lookup: AddressLookup): Promise<void> {
  await resolveValidated(url, lookup);
}

export type GuardedFetchOptions = {
  method: 'POST' | 'PUT' | 'PATCH' | 'GET' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  /** Total attempts on 5xx responses (default 3). Non-5xx never retries. */
  maxAttempts?: number;
  lookup?: AddressLookup;
  fetchImpl?: typeof fetch;
};

export type GuardedFetchResult = {
  status: number;
  ok: boolean;
  /** Response body, truncated at maxResponseBytes. */
  body: string;
  truncated: boolean;
  /** Final URL after redirects. */
  url: string;
  attempts: number;
  redirects: number;
};

// Hop-by-hop / connection-shaping headers callers must not smuggle in.
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Node `lookup`-compatible callback signature (all/single forms). */
type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number,
) => void;

/** Production connector: dial the pre-validated address over node:https with
 *  a `lookup` that returns ONLY that address — no fresh DNS query, so the
 *  socket lands on exactly the IP resolveValidated() checked. SNI + cert
 *  verification still use the URL hostname. `redirect: 'manual'` semantics:
 *  node:https never auto-follows, so 3xx surfaces to guardedFetch's loop. */
async function pinnedFetch(
  urlStr: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  pinned: ResolvedAddress[],
): Promise<Response> {
  const first = pinned[0];
  if (!first) throw new WebhookGuardError('no validated address to connect to');
  const pinnedLookup = (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: NodeLookupCallback,
  ): void => {
    if (options?.all) callback(null, pinned);
    else callback(null, first.address, first.family);
  };

  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      urlStr,
      {
        method: init.method,
        headers: init.headers,
        lookup: pinnedLookup as Parameters<typeof httpsRequest>[1]['lookup'],
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        // Readable → web stream so guardedFetch's readCapped can bound it.
        const body =
          res.statusCode === 204 || res.statusCode === 304
            ? null
            : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status: res.statusCode ?? 502, headers }));
      },
    );
    req.on('error', reject);
    if (init.body !== undefined && init.method !== 'GET') req.write(init.body);
    req.end();
  });
}

async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

/** One guarded outbound call: validate → fetch (redirect: manual) → follow
 *  ≤maxRedirects hops, re-validating each → read ≤maxResponseBytes.
 *  Throws WebhookGuardError for policy violations; returns the final
 *  response (including 4xx/5xx — status handling is the caller's policy). */
export async function guardedFetch(
  rawUrl: string,
  opts: GuardedFetchOptions,
): Promise<GuardedFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxResponseBytes ?? 1_048_576;
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const lookup = opts.lookup ?? defaultLookup;
  // No injected fetch → the pinned node:https connector (production path).
  // Tests inject a mock and skip pinning (they never touch the network).
  const injectedFetch = opts.fetchImpl;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) headers[key] = value;
  }
  if (
    opts.body !== undefined &&
    !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
  ) {
    headers['content-type'] = 'application/json';
  }

  let attempts = 0;
  for (;;) {
    attempts += 1;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new WebhookGuardError(`invalid webhook url '${rawUrl}'`);
    }
    let method = opts.method;
    let body = opts.body;
    let redirects = 0;

    let response: Response;
    for (;;) {
      const pinned = await resolveValidated(url, lookup);
      const signal = AbortSignal.timeout(timeoutMs);
      response = injectedFetch
        ? await injectedFetch(url.toString(), {
            method,
            headers,
            ...(body !== undefined && method !== 'GET' ? { body } : {}),
            redirect: 'manual',
            signal,
          })
        : await pinnedFetch(url.toString(), { method, headers, body, signal }, pinned);
      if (!REDIRECT_STATUSES.has(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new WebhookGuardError(`too many redirects (limit ${maxRedirects})`);
      }
      url = new URL(location, url);
      // Per fetch semantics: 303 (and legacy 301/302 for non-GET) demote to
      // a bodiless GET; 307/308 preserve method + body.
      if (response.status === 303 || response.status === 301 || response.status === 302) {
        method = 'GET';
        body = undefined;
      }
    }

    if (response.status >= 500 && attempts < maxAttempts) continue;

    const { text, truncated } = await readCapped(response, maxBytes);
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      body: text,
      truncated,
      url: url.toString(),
      attempts,
      redirects,
    };
  }
}
