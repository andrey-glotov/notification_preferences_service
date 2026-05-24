import { test } from 'node:test';
import { equal, deepEqual } from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObservabilityContextService } from '../src/observability/observability-context.service';
import { ApplicationError } from '../src/errors/application-error';
import { ERROR_CODES } from '../src/errors/error-codes';
import { sanitizeErrorDetails } from '../src/errors/error-details-sanitizer';
import { ErrorService } from '../src/errors/error.service';
import { GlobalExceptionFilter } from '../src/errors/global-exception.filter';
import { buildValidationFieldErrors } from '../src/errors/validation-exception.factory';

class TestConfigService {
  get<T>(): T | undefined {
    return undefined;
  }
}

class TestResponse {
  statusCode: number | null = null;
  body: unknown = null;

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
  requestId: string | null;
};

function createContextService(): ObservabilityContextService {
  return new ObservabilityContextService(new TestConfigService() as unknown as ConfigService);
}

function createFilter(contextService = createContextService()): GlobalExceptionFilter {
  return new GlobalExceptionFilter(new ErrorService(), contextService);
}

function createHost(response: TestResponse) {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  };
}

function catchException(exception: unknown, contextService?: ObservabilityContextService): {
  response: TestResponse;
  body: ErrorResponseBody;
} {
  const response = new TestResponse();
  const filter = createFilter(contextService);

  filter.catch(exception, createHost(response) as never);

  return { response, body: response.body as ErrorResponseBody };
}

test('ApplicationError returns OpenAPI error envelope with requestId from observability context', () => {
  const contextService = createContextService();
  const error = new ErrorService().notFound({
    message: 'User was not found.',
    details: { ecosystemCode: 'vk', userId: 'user-1' },
  });

  contextService.runWithContext(
    {
      requestId: 'request-123',
      serviceId: 'test-service',
      correlationId: null,
    },
    () => {
      const { response, body } = catchException(error, contextService);

      equal(response.statusCode, 404);
      deepEqual(body, {
        error: {
          code: ERROR_CODES.notFound,
          message: 'User was not found.',
          details: { ecosystemCode: 'vk', userId: 'user-1' },
        },
        requestId: 'request-123',
      });
    },
  );
});

test('global exception filter returns null requestId when observability context is absent', () => {
  const { body } = catchException(new ErrorService().badRequest());

  equal(body.requestId, null);
});

test('ErrorService maps required methods to required status codes and error codes', () => {
  const service = new ErrorService();
  const cases: Array<[ApplicationError, number, string]> = [
    [service.validation(), 400, ERROR_CODES.validation],
    [service.badRequest(), 400, ERROR_CODES.badRequest],
    [service.unauthorized(), 401, ERROR_CODES.unauthorized],
    [service.notFound(), 404, ERROR_CODES.notFound],
    [service.conflict(), 409, ERROR_CODES.conflict],
    [service.internal(), 500, ERROR_CODES.internal],
    [service.serviceUnavailable(), 503, ERROR_CODES.serviceUnavailable],
  ];

  for (const [error, statusCode, code] of cases) {
    equal(error.httpStatus, statusCode);
    equal(error.code, code);
  }
});

test('unexpected exception returns safe internal error without raw message or stack', () => {
  const { response, body } = catchException(new Error('database password leaked in raw failure'));

  equal(response.statusCode, 500);
  equal(body.error.code, ERROR_CODES.internal);
  equal(body.error.message, 'Internal server error.');
  equal(body.error.details, null);
  equal(JSON.stringify(body).includes('database password'), false);
  equal(JSON.stringify(body).includes('stack'), false);
});

test('Nest validation-like BadRequestException maps to validation_error', () => {
  const { response, body } = catchException(new BadRequestException(['channel must be a string']));

  equal(response.statusCode, 400);
  equal(body.error.code, ERROR_CODES.validation);
  equal(body.error.message, 'Request validation failed.');
});

test('validation details contain stable safe field paths', () => {
  const fields = buildValidationFieldErrors([
    {
      property: 'preferences',
      children: [
        {
          property: '0',
          children: [
            {
              property: 'channel',
              constraints: {
                isString: 'channel must be a string',
                isIn: 'channel must be one of: email, sms, push, messenger',
              },
            },
          ],
        },
      ],
    },
  ]);

  deepEqual(fields, [
    {
      path: 'preferences.0.channel',
      messages: ['channel must be a string', 'channel must be one of: email, sms, push, messenger'],
    },
  ]);
});

test('sanitized details remove credentials, headers, connection strings, raw SQL errors and raw bodies', () => {
  const sanitized = sanitizeErrorDetails({
    ecosystemCode: 'vk',
    userId: 'user-1',
    headers: { authorization: 'Basic dXNlcjpwYXNz' },
    password: 'secret',
    connectionString: 'postgres://user:password@localhost/db',
    rawSqlError: 'password authentication failed',
    rawBody: { password: 'secret' },
    nested: {
      channel: 'email',
      authorization: 'Bearer token',
    },
  });

  deepEqual(sanitized, {
    ecosystemCode: 'vk',
    userId: 'user-1',
    nested: {
      channel: 'email',
    },
  });
});

test('global exception filter does not generate a new requestId', () => {
  const { body } = catchException(new ErrorService().internal());

  equal(body.requestId, null);
});
