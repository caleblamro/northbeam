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

/** One failed check from the record write path:
 *    - `required`: a required field is empty
 *    - `rule`:     a validation_rule condition evaluated truthy
 *    - `type`:     the value failed the field's type schema
 *  Surfaced to tRPC clients as `shape.data.validationIssues` (see the
 *  errorFormatter in apps/api/src/trpc/trpc.ts). */
export type ValidationIssue = {
  kind: 'required' | 'rule' | 'type';
  fieldKey?: string;
  ruleId?: string;
  message: string;
};

export class ValidationFailedError extends NorthbeamError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], message = 'Validation failed') {
    super('invalid_input', message, { issues });
    this.name = 'ValidationFailedError';
    this.issues = issues;
  }
}
