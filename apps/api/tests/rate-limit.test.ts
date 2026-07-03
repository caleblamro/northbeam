// fixedWindow against an in-memory Redis stub — counting, expiry arming,
// over-limit result, and the fail-open contract on Redis errors.

import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { fixedWindow } from '../src/lib/rate-limit.js';

function stubRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    calls: { expire: 0 },
    incr(key: string) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    expire(key: string, sec: number) {
      this.calls.expire += 1;
      ttls.set(key, sec);
      return Promise.resolve(1);
    },
    ttl(key: string) {
      return Promise.resolve(ttls.get(key) ?? -1);
    },
  };
}

const asRedis = (stub: ReturnType<typeof stubRedis>) => stub as unknown as Redis;

describe('fixedWindow', () => {
  it('allows up to the limit and arms expiry on the first hit', async () => {
    const stub = stubRedis();
    const first = await fixedWindow(asRedis(stub), 'k', 3, 60);
    expect(first).toEqual({ ok: true, remaining: 2, resetSec: 0 });
    expect(stub.calls.expire).toBe(1);
    await fixedWindow(asRedis(stub), 'k', 3, 60);
    const third = await fixedWindow(asRedis(stub), 'k', 3, 60);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('blocks over the limit with the window ttl as resetSec', async () => {
    const stub = stubRedis();
    for (let i = 0; i < 3; i++) await fixedWindow(asRedis(stub), 'k', 3, 60);
    const over = await fixedWindow(asRedis(stub), 'k', 3, 60);
    expect(over.ok).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.resetSec).toBe(60);
  });

  it('fails open when redis errors', async () => {
    const broken = {
      incr: () => Promise.reject(new Error('down')),
    } as unknown as Redis;
    const result = await fixedWindow(broken, 'k', 3, 60);
    expect(result.ok).toBe(true);
  });
});
