import { ValidationPipe } from '@nestjs/common';
import { ErrorService } from './error.service';

type ValidationErrorLike = {
  property?: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorLike[];
};

export type ValidationFieldError = {
  path: string;
  messages: string[];
};

export function createValidationPipe(errorService: ErrorService): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: createValidationExceptionFactory(errorService),
  });
}

export function createValidationExceptionFactory(
  errorService: ErrorService,
): (validationErrors: ValidationErrorLike[]) => Error {
  return (validationErrors: ValidationErrorLike[]) =>
    errorService.validation({
      message: 'Request validation failed.',
      details: { fields: buildValidationFieldErrors(validationErrors) },
    });
}

export function buildValidationFieldErrors(validationErrors: ValidationErrorLike[]): ValidationFieldError[] {
  return validationErrors.flatMap((error) => flattenValidationError(error));
}

function flattenValidationError(error: ValidationErrorLike, parentPath?: string): ValidationFieldError[] {
  const property = sanitizePathSegment(error.property ?? '');
  const path = [parentPath, property].filter(Boolean).join('.');
  const messages = Object.values(error.constraints ?? {}).filter(Boolean);
  const current = messages.length > 0 && path ? [{ path, messages }] : [];
  const children = error.children ?? [];

  return [...current, ...children.flatMap((child) => flattenValidationError(child, path))];
}

function sanitizePathSegment(pathSegment: string): string {
  return pathSegment.replace(/[^A-Za-z0-9_.-]/g, '');
}
