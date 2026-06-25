// Local pino logger for the db package. We can't import @northbeam/core's
// logger because that package depends on db (circular), so we ship a thin
// instance with the same redaction rules. Keep these in sync if either changes.

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'northbeam-db' },
  redact: ['*.password', '*.token', '*.secret', '*.apiKey', '*.authorization'],
});
