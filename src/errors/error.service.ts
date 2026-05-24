import { HttpStatus, Injectable } from '@nestjs/common';
import { ApplicationError, ErrorSeverity } from './application-error';
import { ERROR_CODES } from './error-codes';

export type ErrorInput = {
  message?: string;
  details?: Record<string, unknown> | null;
  component?: string;
  operation?: string;
  severity?: ErrorSeverity;
  retryable?: boolean;
  cause?: unknown;
};

@Injectable()
export class ErrorService {
  validation(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.validation, HttpStatus.BAD_REQUEST, 'Request validation failed.', input);
  }

  badRequest(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.badRequest, HttpStatus.BAD_REQUEST, 'Bad request.', input);
  }

  unauthorized(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.unauthorized, HttpStatus.UNAUTHORIZED, 'Authentication is required.', input);
  }

  notFound(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.notFound, HttpStatus.NOT_FOUND, 'Resource was not found.', input);
  }

  conflict(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.conflict, HttpStatus.CONFLICT, 'Conflict.', input);
  }

  internal(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.internal, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error.', input);
  }

  serviceUnavailable(input: ErrorInput = {}): ApplicationError {
    return this.create(ERROR_CODES.serviceUnavailable, HttpStatus.SERVICE_UNAVAILABLE, 'Service unavailable.', input);
  }

  private create(code: string, httpStatus: number, defaultMessage: string, input: ErrorInput): ApplicationError {
    return new ApplicationError({
      code,
      httpStatus,
      message: input.message ?? defaultMessage,
      details: input.details ?? null,
      component: input.component,
      operation: input.operation,
      severity: input.severity,
      retryable: input.retryable,
      cause: input.cause,
    });
  }
}
