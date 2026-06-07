import { NorthbeamError, logger } from '@northbeam/core';
import type { Context } from 'hono';

const CODE_TO_STATUS: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  internal: 500,
};

export function onError(err: Error, c: Context): Response {
  if (err instanceof NorthbeamError) {
    const status = CODE_TO_STATUS[err.code] ?? 500;
    return c.json({ error: err.code, message: err.message, details: err.details }, status as 400);
  }
  logger.error({ err }, 'unhandled API error');
  return c.json({ error: 'internal', message: 'internal server error' }, 500);
}
