import assert from 'node:assert/strict';
import test from 'node:test';
import { ArgumentMetadata } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { BasicAuthGuard } from '../src/auth/basic-auth.guard';
import { ERROR_CODES } from '../src/errors/error-codes';
import { ErrorService } from '../src/errors/error.service';
import { createValidationPipe } from '../src/errors/validation-exception.factory';
import { EvaluationController } from '../src/evaluation/evaluation.controller';
import { EvaluationRepository } from '../src/evaluation/evaluation.repository';
import { EvaluationService } from '../src/evaluation/evaluation.service';
import {
  EvaluationChannel,
  EvaluationInput,
  EvaluationNotificationType,
  EvaluationQuietHours,
  EvaluationUser,
  MatchingGlobalPolicy,
} from '../src/evaluation/evaluation.types';
import {
  EvaluateNotificationDto,
  EvaluationParamsDto,
} from '../src/evaluation/dto/evaluate-notification.dto';
import { ObservabilityContextService } from '../src/observability/observability-context.service';

type Policy = MatchingGlobalPolicy & {
  notificationTypeId: string | null;
  channelId: string | null;
  region: string | null;
  effect: 'allow' | 'deny';
  createdAt: string;
};

class TestConfigService {
  get<T>(key: string): T | undefined {
    if (key === 'app.serviceId') {
      return 'test-service' as T;
    }

    return undefined;
  }
}

class InMemoryEvaluationRepository {
  readonly users = new Map<string, EvaluationUser>();
  readonly notificationTypes = new Map<string, EvaluationNotificationType>();
  readonly channels = new Map<string, EvaluationChannel>();
  readonly policies: Policy[] = [];
  readonly quietHours = new Map<string, EvaluationQuietHours>();
  readonly userPreferences = new Map<string, boolean>();
  readonly defaultPreferences = new Map<string, boolean>();
  selectedPolicyId: string | null = null;
  readCount = 0;

  addUser(user: EvaluationUser): void {
    this.users.set(`${user.ecosystemCode}:${user.userId}`, user);
  }

  addNotificationType(code: string, respectsQuietHours = true): void {
    this.notificationTypes.set(code, { id: `${code}-id`, code, respectsQuietHours });
  }

  addChannel(code: string): void {
    this.channels.set(code, { id: `${code}-id`, code });
  }

  addPolicy(policy: Partial<Policy>): void {
    this.policies.push({
      id: policy.id ?? `policy-${this.policies.length + 1}`,
      notificationTypeId: Object.prototype.hasOwnProperty.call(policy, 'notificationTypeId')
        ? policy.notificationTypeId as string | null
        : 'marketing-id',
      channelId: Object.prototype.hasOwnProperty.call(policy, 'channelId')
        ? policy.channelId as string | null
        : 'email-id',
      region: Object.prototype.hasOwnProperty.call(policy, 'region') ? policy.region as string | null : 'EU',
      effect: policy.effect ?? 'deny',
      priority: policy.priority ?? 0,
      createdAt: policy.createdAt ?? '2026-01-01T00:00:00.000Z',
    });
  }

  setQuietHours(userId: string, quietHours: EvaluationQuietHours): void {
    this.quietHours.set(userId, quietHours);
  }

  setUserPreference(userId: string, notificationTypeId: string, channelId: string, allowed: boolean): void {
    this.userPreferences.set(`${userId}:${notificationTypeId}:${channelId}`, allowed);
  }

  setDefaultPreference(notificationTypeId: string, channelId: string, allowed: boolean): void {
    this.defaultPreferences.set(`${notificationTypeId}:${channelId}`, allowed);
  }

  snapshot(): string {
    return JSON.stringify({
      users: [...this.users.entries()],
      notificationTypes: [...this.notificationTypes.entries()],
      channels: [...this.channels.entries()],
      policies: this.policies,
      quietHours: [...this.quietHours.entries()],
      userPreferences: [...this.userPreferences.entries()],
      defaultPreferences: [...this.defaultPreferences.entries()],
    });
  }

  async findUser(ecosystemCode: string, userId: string): Promise<EvaluationUser | null> {
    this.readCount += 1;
    return this.users.get(`${ecosystemCode}:${userId}`) ?? null;
  }

  async findNotificationType(code: string): Promise<EvaluationNotificationType | null> {
    this.readCount += 1;
    return this.notificationTypes.get(code) ?? null;
  }

  async findChannel(code: string): Promise<EvaluationChannel | null> {
    this.readCount += 1;
    return this.channels.get(code) ?? null;
  }

  async findMatchingDenyPolicy(
    notificationTypeId: string,
    channelId: string,
    region: string,
  ): Promise<MatchingGlobalPolicy | null> {
    this.readCount += 1;
    const matching = this.policies
      .filter(
        (policy) =>
          policy.effect === 'deny' &&
          (policy.notificationTypeId === notificationTypeId || policy.notificationTypeId === null) &&
          (policy.channelId === channelId || policy.channelId === null) &&
          (policy.region === region || policy.region === null),
      )
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }

        if (left.createdAt !== right.createdAt) {
          return left.createdAt.localeCompare(right.createdAt);
        }

        return left.id.localeCompare(right.id);
      })[0];

    this.selectedPolicyId = matching?.id ?? null;
    return matching ?? null;
  }

  async getQuietHours(userId: string): Promise<EvaluationQuietHours | null> {
    this.readCount += 1;
    return this.quietHours.get(userId) ?? null;
  }

  async getUserPreferenceAllowed(
    userId: string,
    notificationTypeId: string,
    channelId: string,
  ): Promise<boolean | null> {
    this.readCount += 1;
    return this.userPreferences.get(`${userId}:${notificationTypeId}:${channelId}`) ?? null;
  }

  async getDefaultPreferenceAllowed(notificationTypeId: string, channelId: string): Promise<boolean | null> {
    this.readCount += 1;
    return this.defaultPreferences.get(`${notificationTypeId}:${channelId}`) ?? null;
  }
}

function createRepository(): InMemoryEvaluationRepository {
  const repository = new InMemoryEvaluationRepository();
  repository.addUser({ id: 'local-user-id', ecosystemCode: 'vk', userId: 'user-1' });
  repository.addNotificationType('marketing', true);
  repository.addNotificationType('transactional', false);
  repository.addChannel('email');
  repository.addChannel('sms');
  return repository;
}

function createService(repository = createRepository()): EvaluationService {
  return new EvaluationService(repository as unknown as EvaluationRepository, new ErrorService());
}

function futureIsoAtUtcHour(hour: number, minute = 0): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function baseInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    ecosystemCode: 'vk',
    userId: 'user-1',
    notificationType: 'marketing',
    channel: 'email',
    region: 'EU',
    datetime: futureIsoAtUtcHour(10),
    ...overrides,
  };
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

test('global deny policy blocks sending before user/default preferences', async () => {
  const repository = createRepository();
  repository.addPolicy({ priority: 10 });
  repository.setUserPreference('local-user-id', 'marketing-id', 'email-id', true);
  repository.setDefaultPreference('marketing-id', 'email-id', true);

  const result = await createService(repository).evaluate(baseInput());

  assert.deepEqual(result, {
    decision: 'deny',
    reason: 'blocked_by_global_policy',
    source: 'global_policy',
  });
});

test('global policy matching uses priority, deterministic ordering, wildcards, and ignores allow policies', async () => {
  const repository = createRepository();
  repository.addPolicy({ id: 'allow-policy', effect: 'allow', priority: 100 });
  repository.addPolicy({ id: 'later', notificationTypeId: null, channelId: null, region: null, priority: 5, createdAt: '2026-01-02T00:00:00.000Z' });
  repository.addPolicy({ id: 'earlier', notificationTypeId: null, channelId: null, region: null, priority: 5, createdAt: '2026-01-01T00:00:00.000Z' });
  repository.addPolicy({ id: 'highest', notificationTypeId: null, channelId: null, region: null, priority: 7 });

  await createService(repository).evaluate(baseInput({ notificationType: 'transactional', channel: 'sms', region: 'APAC' }));

  assert.equal(repository.selectedPolicyId, 'highest');

  repository.policies.splice(0, repository.policies.length);
  repository.addPolicy({ id: 'b', notificationTypeId: null, channelId: null, region: null, priority: 5, createdAt: '2026-01-01T00:00:00.000Z' });
  repository.addPolicy({ id: 'a', notificationTypeId: null, channelId: null, region: null, priority: 5, createdAt: '2026-01-01T00:00:00.000Z' });

  await createService(repository).evaluate(baseInput());

  assert.equal(repository.selectedPolicyId, 'a');
});

test('quiet hours block only notification types that respect them and support crossing midnight', async () => {
  const repository = createRepository();
  const service = createService(repository);
  repository.setQuietHours('local-user-id', { startTime: '22:00', endTime: '08:00', timezone: 'Asia/Yekaterinburg' });
  repository.setDefaultPreference('marketing-id', 'email-id', true);
  repository.setDefaultPreference('transactional-id', 'email-id', true);

  assert.deepEqual(await service.evaluate(baseInput({ datetime: futureIsoAtUtcHour(20) })), {
    decision: 'deny',
    reason: 'blocked_by_quiet_hours',
    source: 'quiet_hours',
  });
  assert.deepEqual(
    await service.evaluate(baseInput({ notificationType: 'transactional', datetime: futureIsoAtUtcHour(20) })),
    {
      decision: 'allow',
      reason: 'allowed_by_default_preference',
      source: 'default_preference',
    },
  );
});

test('quiet hours support same-day intervals and timezone conversion', async () => {
  const repository = createRepository();
  repository.setQuietHours('local-user-id', { startTime: '13:00', endTime: '15:00', timezone: 'Asia/Yekaterinburg' });
  repository.setDefaultPreference('marketing-id', 'email-id', true);

  assert.deepEqual(await createService(repository).evaluate(baseInput({ datetime: futureIsoAtUtcHour(9) })), {
    decision: 'deny',
    reason: 'blocked_by_quiet_hours',
    source: 'quiet_hours',
  });
});

test('user preference decisions override default preferences', async () => {
  const repository = createRepository();
  const service = createService(repository);
  repository.setDefaultPreference('marketing-id', 'email-id', false);
  repository.setUserPreference('local-user-id', 'marketing-id', 'email-id', true);

  assert.deepEqual(await service.evaluate(baseInput()), {
    decision: 'allow',
    reason: 'allowed_by_user_preference',
    source: 'user_preference',
  });

  repository.setUserPreference('local-user-id', 'marketing-id', 'email-id', false);

  assert.deepEqual(await service.evaluate(baseInput()), {
    decision: 'deny',
    reason: 'blocked_by_user_preference',
    source: 'user_preference',
  });
});

test('default preference and fallback decisions apply when user preference is absent', async () => {
  const repository = createRepository();
  const service = createService(repository);

  repository.setDefaultPreference('marketing-id', 'email-id', true);
  assert.deepEqual(await service.evaluate(baseInput()), {
    decision: 'allow',
    reason: 'allowed_by_default_preference',
    source: 'default_preference',
  });

  repository.setDefaultPreference('marketing-id', 'email-id', false);
  assert.deepEqual(await service.evaluate(baseInput()), {
    decision: 'deny',
    reason: 'blocked_by_default_preference',
    source: 'default_preference',
  });

  repository.defaultPreferences.clear();
  assert.deepEqual(await service.evaluate(baseInput()), {
    decision: 'deny',
    reason: 'fallback_deny',
    source: 'fallback',
  });
});

test('unknown user, notification type, and channel return 404 errors, not deny decisions', async () => {
  const service = createService();

  for (const [input, message] of [
    [baseInput({ userId: 'missing' }), 'User was not found.'],
    [baseInput({ notificationType: 'missing' }), 'Notification type was not found.'],
    [baseInput({ channel: 'missing' }), 'Channel was not found.'],
  ] as const) {
    await assert.rejects(
      () => service.evaluate(input),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, ERROR_CODES.notFound);
        assert.equal((error as { message?: string }).message, message);
        return true;
      },
    );
  }
});

test('invalid evaluation DTO fields return validation_error', async () => {
  await expectValidationError(
    { ecosystemCode: '' },
    { type: 'param', metatype: EvaluationParamsDto },
    'ecosystemCode',
  );
  await expectValidationError(
    { ...baseInput(), datetime: 'not-a-date' },
    { type: 'body', metatype: EvaluateNotificationDto },
    'datetime',
  );
  await expectValidationError(
    { ...baseInput(), datetime: futureIsoAtUtcHour(10).replace('Z', '') },
    { type: 'body', metatype: EvaluateNotificationDto },
    'datetime',
  );
  await expectValidationError(
    { ...baseInput(), datetime: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z') },
    { type: 'body', metatype: EvaluateNotificationDto },
    'datetime',
  );
  await expectValidationError(
    { ...baseInput(), extra: true },
    { type: 'body', metatype: EvaluateNotificationDto },
    'extra',
  );
  await expectValidationError(
    { userId: 'user-1' },
    { type: 'body', metatype: EvaluateNotificationDto },
    'notificationType',
  );
});

test('evaluation controller returns envelope with requestId and uses BasicAuthGuard', async () => {
  const repository = createRepository();
  repository.setDefaultPreference('marketing-id', 'email-id', true);
  const contextService = new ObservabilityContextService(new TestConfigService() as unknown as ConfigService);
  const controller = new EvaluationController(createService(repository), contextService);

  await contextService.runWithContext(
    { requestId: 'request-123', serviceId: 'test-service', correlationId: null },
    async () => {
      const response = await controller.evaluate({ ecosystemCode: 'vk' }, baseInput());

      assert.deepEqual(response, {
        data: {
          decision: 'allow',
          reason: 'allowed_by_default_preference',
          source: 'default_preference',
        },
        requestId: 'request-123',
      });
    },
  );

  const guards = Reflect.getMetadata(GUARDS_METADATA, EvaluationController) as unknown[];
  assert.deepEqual(guards, [BasicAuthGuard]);
});

test('evaluation is read-only and does not mutate repository state', async () => {
  const repository = createRepository();
  repository.setDefaultPreference('marketing-id', 'email-id', true);
  const before = repository.snapshot();

  await createService(repository).evaluate(baseInput());

  assert.equal(repository.snapshot(), before);
  assert.ok(repository.readCount > 0);
});

test('same start and end quiet hours from storage return safe internal error', async () => {
  const repository = createRepository();
  repository.setQuietHours('local-user-id', { startTime: '22:00', endTime: '22:00', timezone: 'Asia/Yekaterinburg' });

  await assert.rejects(
    () => createService(repository).evaluate(baseInput()),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.internal);
      assert.equal((error as { details?: unknown }).details, null);
      return true;
    },
  );
});
