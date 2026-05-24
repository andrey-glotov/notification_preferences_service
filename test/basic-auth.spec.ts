import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { BasicAuthGuard, WWW_AUTHENTICATE_VALUE } from '../src/auth/basic-auth.guard';
import { BasicAuthService } from '../src/auth/basic-auth.service';
import { ApplicationError } from '../src/errors/application-error';
import { ERROR_CODES } from '../src/errors/error-codes';
import { ErrorService } from '../src/errors/error.service';
import { GlobalExceptionFilter } from '../src/errors/global-exception.filter';
import { ObservabilityContextService } from '../src/observability/observability-context.service';

class TestConfigService {
  constructor(
    private readonly username: string | undefined = 'expected-user',
    private readonly password: string | undefined = 'expected-pass',
  ) {}

  get<T>(key: string): T | undefined {
    const values: Record<string, unknown> = {
      'auth.basicAuthUsername': this.username,
      'auth.basicAuthPassword': this.password,
      'app.serviceId': 'test-service',
    };

    return values[key] as T | undefined;
  }
}

class TestResponse {
  statusCode: number | null = null;
  body: unknown = null;
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }
}

type TestRequest = {
  headers: {
    authorization?: string;
  };
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
  requestId: string | null;
};

function encodeCredentials(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

function createContextService(configService: ConfigService): ObservabilityContextService {
  return new ObservabilityContextService(configService);
}

function createGuard(username?: string, password?: string): {
  guard: BasicAuthGuard;
  contextService: ObservabilityContextService;
} {
  const configService = new TestConfigService(username, password) as unknown as ConfigService;
  const contextService = createContextService(configService);

  return {
    guard: new BasicAuthGuard(new BasicAuthService(configService), new ErrorService(), contextService),
    contextService,
  };
}

function createExecutionContext(authorization: string | undefined, response: TestResponse): ExecutionContext {
  const request: TestRequest = {
    headers: authorization === undefined ? {} : { authorization },
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

function catchWithFilter(
  error: ApplicationError,
  response: TestResponse,
  contextService: ObservabilityContextService,
): ErrorResponseBody {
  const filter = new GlobalExceptionFilter(new ErrorService(), contextService);

  filter.catch(error, {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as never);

  return response.body as ErrorResponseBody;
}

function runGuard(
  authorization: string | undefined,
  username = 'expected-user',
  password = 'expected-pass',
): {
  allowed: boolean;
  response: TestResponse;
  body?: ErrorResponseBody;
  error?: ApplicationError;
} {
  const { guard, contextService } = createGuard(username, password);
  const response = new TestResponse();

  return contextService.runWithContext(
    {
      requestId: 'request-123',
      serviceId: 'test-service',
      correlationId: 'correlation-123',
    },
    () => {
      try {
        return {
          allowed: guard.canActivate(createExecutionContext(authorization, response)),
          response,
        };
      } catch (error) {
        assert.ok(error instanceof ApplicationError);

        return {
          allowed: false,
          response,
          body: catchWithFilter(error, response, contextService),
          error,
        };
      }
    },
  );
}

const unauthorizedCases: Array<[string, string | undefined]> = [
  ['missing Authorization header', undefined],
  ['non-Basic scheme', `Bearer ${encodeCredentials('expected-user', 'expected-pass')}`],
  ['missing Basic token', 'Basic'],
  ['invalid Base64 token', 'Basic not-base64!'],
  ['Base64 without separator', `Basic ${Buffer.from('expected-user', 'utf8').toString('base64')}`],
  ['empty username', `Basic ${encodeCredentials('', 'expected-pass')}`],
  ['empty password', `Basic ${encodeCredentials('expected-user', '')}`],
  ['wrong username', `Basic ${encodeCredentials('wrong-user', 'expected-pass')}`],
  ['wrong password', `Basic ${encodeCredentials('expected-user', 'wrong-pass')}`],
];

for (const [name, authorization] of unauthorizedCases) {
  test(`${name} returns 401 with standard auth error envelope`, () => {
    const { response, body, error } = runGuard(authorization);

    assert.equal(response.statusCode, 401);
    assert.equal(response.headers.get('www-authenticate'), WWW_AUTHENTICATE_VALUE);
    assert.deepEqual(body, {
      error: {
        code: ERROR_CODES.unauthorized,
        message: 'Authentication is required.',
        details: null,
      },
      requestId: 'request-123',
    });
    assert.equal(error?.component, 'auth');
    assert.equal(error?.operation, 'basic_auth');
    assert.equal(error?.severity, 'warning');
  });
}

test('correct credentials pass to the next handler', () => {
  const authorization = `Basic ${encodeCredentials('expected-user', 'expected-pass')}`;
  const { allowed, response } = runGuard(authorization);

  assert.equal(allowed, true);
  assert.equal(response.headers.has('www-authenticate'), false);
});

test('password containing colon is parsed correctly', () => {
  const authorization = `Basic ${encodeCredentials('expected-user', 'sec:ret')}`;
  const { allowed } = runGuard(authorization, 'expected-user', 'sec:ret');

  assert.equal(allowed, true);
});

test('auth scheme comparison is case-insensitive', () => {
  const authorization = `bAsIc ${encodeCredentials('expected-user', 'expected-pass')}`;
  const { allowed } = runGuard(authorization);

  assert.equal(allowed, true);
});

test('auth errors do not expose Authorization header, token, decoded credentials, username, or password', () => {
  const authorization = `Basic ${encodeCredentials('expected-user', 'wrong-pass')}`;
  const { body } = runGuard(authorization);
  const serializedBody = JSON.stringify(body);

  assert.equal(serializedBody.includes(authorization), false);
  assert.equal(serializedBody.includes(encodeCredentials('expected-user', 'wrong-pass')), false);
  assert.equal(serializedBody.includes('expected-user:wrong-pass'), false);
  assert.equal(serializedBody.includes('expected-user'), false);
  assert.equal(serializedBody.includes('wrong-pass'), false);
});

test('missing configured credentials return safe internal_server_error without env names or values', () => {
  const authorization = `Basic ${encodeCredentials('expected-user', 'expected-pass')}`;
  const { response, body, error } = runGuard(authorization, '', undefined);
  const serializedBody = JSON.stringify(body);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(body, {
    error: {
      code: ERROR_CODES.internal,
      message: 'Internal server error.',
      details: null,
    },
    requestId: 'request-123',
  });
  assert.equal(response.headers.has('www-authenticate'), false);
  assert.equal(serializedBody.includes('BASIC_AUTH_USERNAME'), false);
  assert.equal(serializedBody.includes('BASIC_AUTH_PASSWORD'), false);
  assert.equal(serializedBody.includes('expected-user'), false);
  assert.equal(serializedBody.includes('expected-pass'), false);
  assert.equal(error?.component, 'auth');
  assert.equal(error?.operation, 'basic_auth');
  assert.equal(error?.severity, 'critical');
});
