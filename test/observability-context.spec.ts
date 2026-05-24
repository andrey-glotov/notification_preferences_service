import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ObservabilityContextService, DEFAULT_SERVICE_ID } from '../src/observability/observability-context.service';
import { ObservabilityMiddleware } from '../src/observability/observability.middleware';
import { generateRequestId, isValidRequestId } from '../src/observability/request-id';

class TestConfigService {
  constructor(private readonly serviceId?: string) {}

  get<T>(key: string): T | undefined {
    if (key === 'app.serviceId') {
      return this.serviceId as T | undefined;
    }

    return undefined;
  }
}

class TestResponse extends EventEmitter {
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

type TestRequest = {
  headers: Record<string, unknown>;
};

function createContextService(serviceId?: string): ObservabilityContextService {
  return new ObservabilityContextService(new TestConfigService(serviceId) as ConfigService);
}

function createMiddleware(serviceId?: string): {
  contextService: ObservabilityContextService;
  middleware: ObservabilityMiddleware;
} {
  const contextService = createContextService(serviceId);

  return {
    contextService,
    middleware: new ObservabilityMiddleware(contextService),
  };
}

test('generated request ids use the documented format and validate successfully', () => {
  const requestId = generateRequestId();

  assert.match(requestId, /^req_\d+_[a-f0-9]{6}$/);
  assert.equal(isValidRequestId(requestId), true);
});

test('request without X-Request-Id receives generated requestId in context and response header', () => {
  const { contextService, middleware } = createMiddleware('test-service');
  const req: TestRequest = { headers: {} };
  const res = new TestResponse();
  let observedRequestId: string | null = null;

  middleware.use(req as never, res as never, () => {
    observedRequestId = contextService.getRequestId();
  });

  assert.notEqual(observedRequestId, null);
  assert.ok(observedRequestId);
  assert.match(observedRequestId, /^req_\d+_[a-f0-9]{6}$/);
  assert.equal(res.headers.get('X-Request-Id'), observedRequestId);
});

test('valid X-Request-Id is reused', () => {
  const { contextService, middleware } = createMiddleware();
  const req: TestRequest = { headers: { 'x-request-id': 'external-id:123' } };
  const res = new TestResponse();

  middleware.use(req as never, res as never, () => {
    assert.equal(contextService.getRequestId(), 'external-id:123');
  });

  assert.equal(res.headers.get('X-Request-Id'), 'external-id:123');
});

test('invalid X-Request-Id is replaced without blocking the request', () => {
  const { contextService, middleware } = createMiddleware();
  const req: TestRequest = { headers: { 'x-request-id': 'bad id with spaces' } };
  const res = new TestResponse();
  let nextCalled = false;
  let observedRequestId: string | null = null;

  middleware.use(req as never, res as never, () => {
    nextCalled = true;
    observedRequestId = contextService.getRequestId();
    assert.notEqual(observedRequestId, 'bad id with spaces');
    assert.match(observedRequestId as string, /^req_\d+_[a-f0-9]{6}$/);
  });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('X-Request-Id'), observedRequestId);
});

test('serviceId is read from SERVICE_ID-backed app config inside context', () => {
  const { contextService, middleware } = createMiddleware('custom-service');
  const req: TestRequest = { headers: { 'x-request-id': 'request-123' } };
  const res = new TestResponse();

  middleware.use(req as never, res as never, () => {
    assert.equal(contextService.getServiceId(), 'custom-service');
    assert.deepEqual(contextService.getContext(), {
      requestId: 'request-123',
      serviceId: 'custom-service',
      correlationId: null,
    });
  });
});

test('missing SERVICE_ID uses default serviceId outside request context', () => {
  const contextService = createContextService();

  assert.equal(contextService.getRequestId(), null);
  assert.equal(contextService.getCorrelationId(), null);
  assert.equal(contextService.getContext(), null);
  assert.equal(contextService.getServiceId(), DEFAULT_SERVICE_ID);
});

test('valid X-Correlation-Id is stored in context but not returned as a response header', () => {
  const { contextService, middleware } = createMiddleware();
  const req: TestRequest = {
    headers: {
      'x-request-id': 'request-123',
      'x-correlation-id': 'correlation-123',
    },
  };
  const res = new TestResponse();

  middleware.use(req as never, res as never, () => {
    assert.equal(contextService.getCorrelationId(), 'correlation-123');
  });

  assert.equal(res.headers.has('X-Correlation-Id'), false);
});

test('invalid X-Correlation-Id is ignored', () => {
  const { contextService, middleware } = createMiddleware();
  const req: TestRequest = {
    headers: {
      'x-request-id': 'request-123',
      'x-correlation-id': 'bad correlation',
    },
  };
  const res = new TestResponse();

  middleware.use(req as never, res as never, () => {
    assert.equal(contextService.getCorrelationId(), null);
  });
});

test('X-Request-Id header is set before downstream handler throws', () => {
  const { middleware } = createMiddleware();
  const req: TestRequest = { headers: { 'x-request-id': 'request-123' } };
  const res = new TestResponse();

  assert.throws(
    () =>
      middleware.use(req as never, res as never, () => {
        throw new Error('downstream failure');
      }),
    /downstream failure/,
  );
  assert.equal(res.headers.get('X-Request-Id'), 'request-123');
});
