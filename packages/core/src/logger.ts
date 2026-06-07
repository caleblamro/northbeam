import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'northbeam' },
  redact: ['*.password', '*.token', '*.secret', '*.apiKey', '*.authorization'],
});
