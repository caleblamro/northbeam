export type NorthbeamErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'internal';

export class NorthbeamError extends Error {
  readonly code: NorthbeamErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: NorthbeamErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NorthbeamError';
    this.code = code;
    this.details = details;
  }
}
