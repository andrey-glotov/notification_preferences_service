import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ObservabilityContextService } from '../observability/observability-context.service';
import { ApplicationError } from './application-error';
import { ERROR_CODES } from './error-codes';
import { sanitizeErrorDetails } from './error-details-sanitizer';
import { ErrorResponseBody } from './error-response.types';
import { ErrorService } from './error.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly errorService: ErrorService,
    private readonly observabilityContextService: ObservabilityContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const applicationError = this.toApplicationError(exception);
    const body: ErrorResponseBody = {
      error: {
        code: applicationError.code,
        message: applicationError.message,
        details: sanitizeErrorDetails(applicationError.details),
      },
      requestId: this.observabilityContextService.getRequestId(),
    };

    this.recordErrorEvent(applicationError);
    response.status(applicationError.httpStatus).json(body);
  }

  private toApplicationError(exception: unknown): ApplicationError {
    if (exception instanceof ApplicationError) {
      return exception;
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return this.errorService.internal({
      message: 'Internal server error.',
      component: 'api',
      operation: 'handle_request',
      severity: 'error',
      retryable: false,
      cause: exception,
    });
  }

  private fromHttpException(exception: HttpException): ApplicationError {
    const status = exception.getStatus();

    if (status === HttpStatus.BAD_REQUEST && this.looksLikeNestValidationException(exception)) {
      return this.errorService.validation();
    }

    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return this.errorService.badRequest();
      case HttpStatus.UNAUTHORIZED:
        return this.errorService.unauthorized();
      case HttpStatus.NOT_FOUND:
        return this.errorService.notFound();
      case HttpStatus.CONFLICT:
        return this.errorService.conflict();
      case HttpStatus.SERVICE_UNAVAILABLE:
        return this.errorService.serviceUnavailable();
      default:
        return this.errorService.internal({ cause: exception });
    }
  }

  private looksLikeNestValidationException(exception: HttpException): boolean {
    const response = exception.getResponse();

    return (
      typeof response === 'object' &&
      response !== null &&
      Array.isArray((response as { message?: unknown }).message)
    );
  }

  private recordErrorEvent(error: ApplicationError): void {
    try {
      void {
        requestId: this.observabilityContextService.getRequestId(),
        serviceId: this.observabilityContextService.getServiceId(),
        correlationId: this.observabilityContextService.getCorrelationId(),
        errorCode: error.code,
        component: error.component,
        operation: error.operation,
        severity: error.severity,
        retryable: error.retryable,
        details: sanitizeErrorDetails(error.details),
      };
    } catch {
      // Future observability sinks must never affect HTTP responses.
    }
  }
}
