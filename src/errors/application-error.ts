export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ApplicationErrorOptions = {
  code: string;
  message: string;
  httpStatus: number;
  details?: Record<string, unknown> | null;
  component?: string;
  operation?: string;
  severity?: ErrorSeverity;
  retryable?: boolean;
  cause?: unknown;
};

export class ApplicationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | null;
  readonly component?: string;
  readonly operation?: string;
  readonly severity?: ErrorSeverity;
  readonly retryable?: boolean;
  readonly cause?: unknown;

  constructor(options: ApplicationErrorOptions) {
    super(options.message);
    this.name = 'ApplicationError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.details = options.details ?? null;
    this.component = options.component;
    this.operation = options.operation;
    this.severity = options.severity;
    this.retryable = options.retryable;
    this.cause = options.cause;
  }
}
