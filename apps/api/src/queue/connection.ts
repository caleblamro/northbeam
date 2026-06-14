// Shared Redis connection for BullMQ. BullMQ expects an ioredis instance with
// maxRetriesPerRequest set to null (its docs are emphatic about this — without
// it, the connection silently stops accepting blocking commands).
//
// One process-wide connection is enough for both producers and consumers; the
// queue itself multiplexes commands. Workers running in a separate process
// (apps/api/src/workers) create their own connection.

import IORedis, { type Redis } from 'ioredis';
import { env } from '../lib/env.js';

let cached: Redis | undefined;

export function redis(): Redis {
  if (cached) return cached;
  cached = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  return cached;
}
