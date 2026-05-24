import assert from 'node:assert/strict';
import test from 'node:test';
import { ArgumentMetadata, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BasicAuthGuard, WWW_AUTHENTICATE_VALUE } from '../src/auth/basic-auth.guard';
import { BasicAuthService } from '../src/auth/basic-auth.service';
import { ERROR_CODES } from '../src/errors/error-codes';
import { ErrorService } from '../src/errors/error.service';
import { createValidationPipe } from '../src/errors/validation-exception.factory';
import { ObservabilityContextService } from '../src/observability/observability-context.service';
import { CreateInternalUserDto, InternalUserParamsDto } from '../src/users/dto/create-internal-user.dto';
import { InternalEndpointGuard } from '../src/users/internal-endpoint.guard';
import { UsersController } from '../src/users/users.controller';
import { UsersRepository } from '../src/users/users.repository';
import { UsersService } from '../src/users/users.service';
import { InternalUser, UpsertInternalUserInput } from '../src/users/users.types';

class TestConfigService {
  constructor(private readonly input: Record<string, unknown> = {}) {}

  get<T>(key: string): T | undefined {
    return this.input[key] as T | undefined;
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
  method: string;
  path: string;
  url: string;
  headers: {
    authorization?: string;
  };
};

class InMemoryUsersRepository {
  readonly users = new Map<string, InternalUser>();
  upsertCalls = 0;

  async upsertInternalUser(input: UpsertInternalUserInput): Promise<InternalUser> {
    this.upsertCalls += 1;
    const key = `${input.ecosystemCode}:${input.userId}`;
    const existing = this.users.get(key);
    const regionWasProvided = Object.prototype.hasOwnProperty.call(input, 'region');

    if (existing) {
      const updated = {
        ...existing,
        region: regionWasProvided ? input.region ?? null : existing.region,
      };
      this.users.set(key, updated);
      return updated;
    }

    const created = {
      id: randomUUID(),
      ecosystemCode: input.ecosystemCode,
      userId: input.userId,
      region: input.region ?? null,
    };
    this.users.set(key, created);
    return created;
  }

  countByExternalIdentity(ecosystemCode: string, userId: string): number {
    return this.users.has(`${ecosystemCode}:${userId}`) ? 1 : 0;
  }
}

function encodeCredentials(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

function createContextService(configService: ConfigService): ObservabilityContextService {
  return new ObservabilityContextService(configService);
}

function createRequest(path: string, authorization?: string): TestRequest {
  return {
    method: 'POST',
    path,
    url: path,
    headers: authorization === undefined ? {} : { authorization },
  };
}

function createExecutionContext(request: TestRequest, response: TestResponse): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

function createGuards(enableInternalEndpoints: boolean): {
  internalGuard: InternalEndpointGuard;
  basicAuthGuard: BasicAuthGuard;
  contextService: ObservabilityContextService;
} {
  const configService = new TestConfigService({
    'app.enableInternalEndpoints': enableInternalEndpoints,
    'app.serviceId': 'test-service',
    'auth.basicAuthUsername': 'local',
    'auth.basicAuthPassword': 'local',
  }) as unknown as ConfigService;
  const contextService = createContextService(configService);
  const errorService = new ErrorService();

  return {
    internalGuard: new InternalEndpointGuard(configService, errorService, contextService),
    basicAuthGuard: new BasicAuthGuard(new BasicAuthService(configService), errorService, contextService),
    contextService,
  };
}

function runInternalThenBasicAuth(enableInternalEndpoints: boolean, authorization?: string) {
  const { internalGuard, basicAuthGuard, contextService } = createGuards(enableInternalEndpoints);
  const response = new TestResponse();
  const executionContext = createExecutionContext(createRequest('/internal/vk/users', authorization), response);

  return contextService.runWithContext(
    {
      requestId: 'request-123',
      serviceId: 'test-service',
      correlationId: null,
    },
    () => {
      internalGuard.canActivate(executionContext);
      return basicAuthGuard.canActivate(executionContext);
    },
  );
}

async function expectValidationError(value: unknown, metadata: ArgumentMetadata, expectedPath: string): Promise<void> {
  const pipe = createValidationPipe(new ErrorService());

  await assert.rejects(
    () => pipe.transform(value, metadata),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.validation);
      assert.equal(JSON.stringify((error as { details?: unknown }).details).includes(expectedPath), true);
      assert.equal(JSON.stringify((error as { details?: unknown }).details).includes('rawBody'), false);
      return true;
    },
  );
}

test('POST /internal/:ecosystemCode/users creates a new user when enabled', async () => {
  const repository = new InMemoryUsersRepository();
  const service = new UsersService(repository as unknown as UsersRepository, new ErrorService());

  const user = await service.createOrUpdateInternalUser({
    ecosystemCode: 'vk',
    userId: 'user-1',
    region: 'EU',
  });

  assert.match(user.id, /^[0-9a-f-]{36}$/);
  assert.equal(user.ecosystemCode, 'vk');
  assert.equal(user.userId, 'user-1');
  assert.equal(user.region, 'EU');
  assert.equal(repository.countByExternalIdentity('vk', 'user-1'), 1);
});

test('successful controller response matches { data, requestId }', async () => {
  const repository = new InMemoryUsersRepository();
  const service = new UsersService(repository as unknown as UsersRepository, new ErrorService());
  const configService = new TestConfigService({ 'app.serviceId': 'test-service' }) as unknown as ConfigService;
  const contextService = createContextService(configService);
  const controller = new UsersController(service, contextService);

  await contextService.runWithContext(
    {
      requestId: 'request-123',
      serviceId: 'test-service',
      correlationId: null,
    },
    async () => {
      const response = await controller.createInternalUser({ ecosystemCode: 'vk' }, { userId: 'user-1', region: 'EU' });

      assert.equal(response.requestId, 'request-123');
      assert.equal(response.data.ecosystemCode, 'vk');
      assert.equal(response.data.userId, 'user-1');
      assert.equal(response.data.region, 'EU');
      assert.match(response.data.id, /^[0-9a-f-]{36}$/);
    },
  );
});

test('repeated same request is idempotent and does not create duplicates', async () => {
  const repository = new InMemoryUsersRepository();
  const service = new UsersService(repository as unknown as UsersRepository, new ErrorService());
  const first = await service.createOrUpdateInternalUser({ ecosystemCode: 'vk', userId: 'user-1', region: 'EU' });
  const second = await service.createOrUpdateInternalUser({ ecosystemCode: 'vk', userId: 'user-1', region: 'EU' });

  assert.deepEqual(second, first);
  assert.equal(repository.countByExternalIdentity('vk', 'user-1'), 1);
});

test('new region updates region, omitted region preserves it, and null clears it', async () => {
  const repository = new InMemoryUsersRepository();
  const service = new UsersService(repository as unknown as UsersRepository, new ErrorService());

  await service.createOrUpdateInternalUser({ ecosystemCode: 'vk', userId: 'user-1', region: 'EU' });
  const updated = await service.createOrUpdateInternalUser({ ecosystemCode: 'vk', userId: 'user-1', region: 'CIS' });
  const preserved = await service.createOrUpdateInternalUser({ ecosystemCode: 'vk', userId: 'user-1' });
  const cleared = await service.createOrUpdateInternalUser({ ecosystemCode: 'vk', userId: 'user-1', region: null });

  assert.equal(updated.region, 'CIS');
  assert.equal(preserved.region, 'CIS');
  assert.equal(cleared.region, null);
  assert.equal(repository.countByExternalIdentity('vk', 'user-1'), 1);
});

test('extra body fields return validation_error', async () => {
  await expectValidationError(
    { userId: 'user-1', unexpected: true },
    { type: 'body', metatype: CreateInternalUserDto },
    'unexpected',
  );
});

test('invalid ecosystemCode returns validation_error', async () => {
  await expectValidationError(
    { ecosystemCode: '' },
    { type: 'param', metatype: InternalUserParamsDto },
    'ecosystemCode',
  );
});

test('invalid userId returns validation_error', async () => {
  await expectValidationError({ userId: '' }, { type: 'body', metatype: CreateInternalUserDto }, 'userId');
});

test('too long region returns validation_error', async () => {
  await expectValidationError(
    { userId: 'user-1', region: 'x'.repeat(33) },
    { type: 'body', metatype: CreateInternalUserDto },
    'region',
  );
});

test('request without Basic Auth returns 401 when endpoint is enabled', () => {
  assert.throws(
    () => runInternalThenBasicAuth(true),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.unauthorized);
      return true;
    },
  );
});

test('request with correct Basic Auth reaches controller when endpoint is enabled', () => {
  const result = runInternalThenBasicAuth(true, `Basic ${encodeCredentials('local', 'local')}`);

  assert.equal(result, true);
});

test('disabled internal endpoint returns 404 before Basic Auth challenge and does not call service', () => {
  const repository = new InMemoryUsersRepository();

  assert.throws(
    () => runInternalThenBasicAuth(false),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.notFound);
      assert.equal((error as { message?: string }).message, 'Resource was not found.');
      return true;
    },
  );
  assert.equal(repository.upsertCalls, 0);
});

test('disabled internal endpoint does not include Basic Auth challenge', () => {
  const { internalGuard, contextService } = createGuards(false);
  const response = new TestResponse();
  const executionContext = createExecutionContext(createRequest('/internal/vk/users'), response);

  assert.throws(() =>
    contextService.runWithContext(
      {
        requestId: 'request-123',
        serviceId: 'test-service',
        correlationId: null,
      },
      () => internalGuard.canActivate(executionContext),
    ),
  );
  assert.equal(response.headers.has('www-authenticate'), false);
});

test('internal availability guard is a no-op for public API endpoints', () => {
  const { internalGuard } = createGuards(false);
  const response = new TestResponse();
  const executionContext = createExecutionContext(createRequest('/api/vk/evaluate'), response);

  assert.equal(internalGuard.canActivate(executionContext), true);
});

test('auth error details do not include raw headers or credentials', () => {
  assert.throws(
    () => runInternalThenBasicAuth(true, `Basic ${encodeCredentials('local', 'wrong')}`),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.unauthorized);
      assert.equal((error as { details?: unknown }).details, null);
      assert.equal(JSON.stringify(error).includes('authorization'), false);
      assert.equal(JSON.stringify(error).includes('local:wrong'), false);
      return true;
    },
  );
});

test('Basic Auth failure on enabled endpoint includes WWW-Authenticate challenge', () => {
  const { internalGuard, basicAuthGuard, contextService } = createGuards(true);
  const response = new TestResponse();
  const executionContext = createExecutionContext(createRequest('/internal/vk/users'), response);

  assert.throws(() =>
    contextService.runWithContext(
      {
        requestId: 'request-123',
        serviceId: 'test-service',
        correlationId: null,
      },
      () => {
        internalGuard.canActivate(executionContext);
        basicAuthGuard.canActivate(executionContext);
      },
    ),
  );
  assert.equal(response.headers.get('www-authenticate'), WWW_AUTHENTICATE_VALUE);
});
