export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'NOT_FOUND'
  | 'CUSTOMER_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'TRANSFER_NOT_FOUND'
  | 'LOCK_NOT_FOUND'
  | 'LOCK_ALREADY_RELEASED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ACCOUNT_LOCKED'
  | 'INSUFFICIENT_FUNDS'
  | 'SAME_ACCOUNT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, 401, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, 404, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, 409, message, details);
  }
}

/** Business-rule rejection (insufficient funds, locked account, ...). */
export class UnprocessableError extends AppError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, 422, message, details);
  }
}
