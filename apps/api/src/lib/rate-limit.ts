// Fixed-window rate limiting on Redis — INCR + EXPIRE, one key per window.
// This is a COST guard (LLM spend, abuse damping), not a security boundary:
// on any Redis error it fails OPEN so generation never hard-couples to Redis
// health. Callers that need a hard guarantee should not use this.

import type { Redis } from 'ioredis';

export type RateLimitResult = {
  ok: boolean;
  /** Requests left in the current window (0 when over). */
  remaining: number;
  /** Seconds until the window resets (best effort; 0 when unknown). */
  resetSec: number;
};

export async function fixedWindow(
  r: Redis,
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    const count = await r.incr(key);
    // First hit in a window owns the expiry. If the key somehow has no TTL
    // (e.g. a crash between INCR and EXPIRE), re-arm it so the window can't
    // become permanent.
    if (count === 1) {
      await r.expire(key, windowSec);
    }
    if (count > limit) {
      const ttl = await r.ttl(key);
      if (ttl < 0) await r.expire(key, windowSec);
      return { ok: false, remaining: 0, resetSec: ttl > 0 ? ttl : windowSec };
    }
    return { ok: true, remaining: limit - count, resetSec: 0 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[rate-limit] redis unavailable — failing open', err);
    return { ok: true, remaining: limit, resetSec: 0 };
  }
}
