export type DomainErrorCode =
  | 'validation_failed'
  | 'duplicate_report'
  | 'not_found'
  | 'forbidden'
  | 'agreement_required'
  | 'conflict'
  | 'last_admin_protected'
  | 'inactive_protocol_type'
  | 'audit_write_failed'
  | 'mock_auth_in_production';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export class DuplicateReportError extends DomainError {
  constructor(existingReportId: string, existingState: 'active' | 'recycled') {
    super(
      'duplicate_report',
      'An identical report already exists for this researcher, report date, and protocol description.',
      { existingReportId, existingState },
    );
    this.name = 'DuplicateReportError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You are not allowed to perform this action.') {
    super('forbidden', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Record not found.') {
    super('not_found', message);
    this.name = 'NotFoundError';
  }
}
