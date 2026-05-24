import { test } from 'node:test';
import { ok, equal, rejects, throws, doesNotThrow } from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { ErrorService } from '../src/errors/error.service';
import { GlobalExceptionFilter } from '../src/errors/global-exception.filter';
import { ObservabilityContextService } from '../src/observability/observability-context.service';
import { ObservabilityService } from '../src/observability/observability.service';
import { ObservabilitySink } from '../src/observability/observability.sink';
import { ObservabilityRecord } from '../src/observability/observability.types';
import { StdoutObservabilitySink } from '../src/observability/stdout-observability.sink';
import { PreferencesService } from '../src/preferences/preferences.service';
import { PreferencesRepository } from '../src/preferences/preferences.repository';
import { EvaluationService } from '../src/evaluation/evaluation.service';
import { EvaluationRepository } from '../src/evaluation/evaluation.repository';
import { BasicAuthGuard } from '../src/auth/basic-auth.guard';
import { BasicAuthService } from '../src/auth/basic-auth.service';

class TestConfigService {
  get<T>(key: string): T | undefined {
    if (key === 'app.serviceId') {
      return 'test-service' as T;
    }

    return undefined;
  }
}

class RecordingSink implements ObservabilitySink {
  records: ObservabilityRecord[] = [];
  fail = false;

  write(record: ObservabilityRecord): void {
    if (this.fail) {
      throw new Error('sink failed');
    }

    this.records.push(record);
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

function createContextService(): ObservabilityContextService {
  return new ObservabilityContextService(new TestConfigService() as unknown as ConfigService);
}

function createObservability(sink = new RecordingSink()): {
  contextService: ObservabilityContextService;
  observabilityService: ObservabilityService;
  sink: RecordingSink;
} {
  const contextService = createContextService();

  return {
    contextService,
    observabilityService: new ObservabilityService(contextService, sink),
    sink,
  };
}

function createExecutionContext(authorization?: string): ExecutionContext {
  const response = new TestResponse();

  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization === undefined ? {} : { authorization },
      }),
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

test('observability records include context fields and outside-context serviceId', () => {
  const { contextService, observabilityService, sink } = createObservability();

  contextService.runWithContext(
    { requestId: 'request-123', serviceId: 'test-service', correlationId: 'correlation-123' },
    () => {
      observabilityService.recordEvent({
        eventType: 'test_event',
        component: 'tests',
        operation: 'record_test',
        payload: { ok: true },
      });
    },
  );
  observabilityService.recordEvent({
    eventType: 'outside_context',
    component: 'tests',
    operation: 'record_test',
  });

  equal(sink.records[0].requestId, 'request-123');
  equal(sink.records[0].serviceId, 'test-service');
  equal(sink.records[0].correlationId, 'correlation-123');
  equal(sink.records[1].requestId, null);
  equal(sink.records[1].serviceId, 'test-service');
});

test('stdout sink writes structured JSON records', () => {
  const sink = new StdoutObservabilitySink();
  const messages: string[] = [];
  (sink as unknown as { logger: { log: (message: string) => void } }).logger = {
    log: (message: string) => messages.push(message),
  };

  sink.write({
    eventType: 'test_event',
    requestId: 'request-123',
    serviceId: 'test-service',
    correlationId: null,
    component: 'tests',
    operation: 'write_test',
    severity: 'info',
    timestamp: new Date().toISOString(),
    payload: { ok: true },
  });

  equal(JSON.parse(messages[0]).eventType, 'test_event');
});

test('sink failure does not throw into business flow', () => {
  const { observabilityService, sink } = createObservability();
  sink.fail = true;

  doesNotThrow(() =>
    observabilityService.recordEvent({
      eventType: 'test_event',
      component: 'tests',
      operation: 'record_test',
      payload: { authorization: 'Basic secret', connectionString: 'postgres://secret' },
    }),
  );
});

test('service sanitizes payloads and metric labels', () => {
  const { observabilityService, sink } = createObservability();

  observabilityService.recordEvent({
    eventType: 'safe_event',
    component: 'tests',
    operation: 'sanitize',
    payload: {
      userId: 'user-1',
      authorization: 'Basic secret',
      decodedCredentials: 'user:password',
      rawSqlError: 'password authentication failed',
    },
  });
  observabilityService.incrementCounter({
    metricName: 'safe_counter',
    component: 'tests',
    operation: 'sanitize',
    labels: {
      operation: 'sanitize',
      requestId: 'request-123',
      errorMessage: 'raw failure',
    },
  });

  const serialized = JSON.stringify(sink.records);
  equal(serialized.includes('Basic secret'), false);
  equal(serialized.includes('user:password'), false);
  equal(serialized.includes('password authentication'), false);
});

test('preferences service records preference and quiet hours events after successful update only', async () => {
  const { observabilityService, sink } = createObservability();
  const repository = {
    findUser: async () => ({ id: 'local-user-id', ecosystemCode: 'vk', userId: 'user-1' }),
    findNotificationTypeId: async () => 'marketing-id',
    findChannelId: async () => 'email-id',
    updatePreferencesAndQuietHours: async () => undefined,
  };
  const service = new PreferencesService(
    repository as unknown as PreferencesRepository,
    new ErrorService(),
    observabilityService,
  );

  await service.updateUserPreferences({
    ecosystemCode: 'vk',
    userId: 'user-1',
    preferences: [{ notificationType: 'marketing', channel: 'email', allowed: false }],
    quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'Asia/Yekaterinburg' },
  });

  ok(sink.records.some((record) => record.eventType === 'preference_changed'));
  ok(sink.records.some((record) => record.eventType === 'quiet_hours_changed'));
  ok(sink.records.some((record) => record.payload.metricName === 'preference_changes_total'));

  sink.records = [];
  const failingService = new PreferencesService(
    {
      ...repository,
      updatePreferencesAndQuietHours: async () => {
        throw new Error('rollback');
      },
    } as unknown as PreferencesRepository,
    new ErrorService(),
    observabilityService,
  );

  await rejects(() =>
    failingService.updateUserPreferences({
      ecosystemCode: 'vk',
      userId: 'user-1',
      preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true }],
    }),
  );
  equal(sink.records.some((record) => record.eventType === 'preference_changed'), false);
});

test('evaluation records notification decision event, counters, and duration timer only after success', async () => {
  const { observabilityService, sink } = createObservability();
  const service = new EvaluationService(
    {
      findUser: async () => ({ id: 'local-user-id', ecosystemCode: 'vk', userId: 'user-1' }),
      findNotificationType: async () => ({ id: 'marketing-id', code: 'marketing', respectsQuietHours: false }),
      findChannel: async () => ({ id: 'email-id', code: 'email' }),
      findMatchingDenyPolicy: async () => null,
      getQuietHours: async () => null,
      getUserPreferenceAllowed: async () => null,
      getDefaultPreferenceAllowed: async () => true,
    } as unknown as EvaluationRepository,
    new ErrorService(),
    observabilityService,
  );

  await service.evaluate({
    ecosystemCode: 'vk',
    userId: 'user-1',
    notificationType: 'marketing',
    channel: 'email',
    region: 'EU',
    datetime: new Date(Date.now() + 60_000).toISOString(),
  });

  ok(sink.records.some((record) => record.eventType === 'notification_decision'));
  ok(sink.records.some((record) => record.payload.metricName === 'notification_decision_total'));
  ok(sink.records.some((record) => record.payload.metricName === 'notification_decision_duration_ms'));

  sink.records = [];
  const failingService = new EvaluationService(
    {
      findUser: async () => null,
    } as unknown as EvaluationRepository,
    new ErrorService(),
    observabilityService,
  );

  await rejects(() =>
    failingService.evaluate({
      ecosystemCode: 'vk',
      userId: 'missing',
      notificationType: 'marketing',
      channel: 'email',
      region: 'EU',
      datetime: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  equal(sink.records.some((record) => record.eventType === 'notification_decision'), false);
});

test('global exception filter records service_error', () => {
  const { contextService, observabilityService, sink } = createObservability();
  const response = new TestResponse();
  const filter = new GlobalExceptionFilter(new ErrorService(), contextService, observabilityService);

  filter.catch(new Error('raw secret failure'), {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as never);

  const event = sink.records.find((record) => record.eventType === 'service_error');
  ok(event);
  equal(event.payload.errorCode, 'internal_server_error');
  equal(JSON.stringify(event).includes('raw secret failure'), false);
});

test('basic auth failure records sanitized auth service error and counter', () => {
  const { observabilityService, sink } = createObservability();
  const configService = {
    get: (key: string) => {
      if (key === 'auth.basicAuthUsername') {
        return 'local';
      }
      if (key === 'auth.basicAuthPassword') {
        return 'local';
      }
      return undefined;
    },
  } as unknown as ConfigService;
  const guard = new BasicAuthGuard(
    new BasicAuthService(configService),
    new ErrorService(),
    createContextService(),
    observabilityService,
  );

  throws(() => guard.canActivate(createExecutionContext('Basic bG9jYWw6d3Jvbmc=')));

  const serialized = JSON.stringify(sink.records);
  ok(sink.records.some((record) => record.eventType === 'service_error'));
  ok(sink.records.some((record) => record.payload.metricName === 'auth_failures_total'));
  equal(serialized.includes('bG9jYWw6d3Jvbmc='), false);
  equal(serialized.includes('local:wrong'), false);
});
