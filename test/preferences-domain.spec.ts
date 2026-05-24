import assert from 'node:assert/strict';
import test from 'node:test';
import { ArgumentMetadata } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { BasicAuthGuard } from '../src/auth/basic-auth.guard';
import { ERROR_CODES } from '../src/errors/error-codes';
import { ErrorService } from '../src/errors/error.service';
import { createValidationPipe } from '../src/errors/validation-exception.factory';
import { ObservabilityContextService } from '../src/observability/observability-context.service';
import {
  PreferenceItemDto,
  UpdateUserPreferencesDto,
  UserPreferencesParamsDto,
} from '../src/preferences/dto/update-user-preferences.dto';
import { PreferencesController } from '../src/preferences/preferences.controller';
import { PreferencesRepository } from '../src/preferences/preferences.repository';
import { PreferencesService } from '../src/preferences/preferences.service';
import {
  DefaultPreferenceWithUserOverride,
  LocalUser,
  QuietHoursValue,
  ResolvedPreferenceUpdate,
} from '../src/preferences/preferences.types';

class TestConfigService {
  get<T>(key: string): T | undefined {
    if (key === 'app.serviceId') {
      return 'test-service' as T;
    }

    return undefined;
  }
}

type UserPreferenceRow = {
  notificationTypeId: string;
  channelId: string;
  allowed: boolean;
};

class InMemoryPreferencesRepository {
  readonly users = new Map<string, LocalUser>();
  readonly notificationTypes = new Map<string, string>();
  readonly notificationTypeCodesById = new Map<string, string>();
  readonly channels = new Map<string, string>();
  readonly channelCodesById = new Map<string, string>();
  readonly defaultPreferences = new Map<string, UserPreferenceRow>();
  readonly userPreferences = new Map<string, Map<string, UserPreferenceRow>>();
  readonly quietHours = new Map<string, QuietHoursValue>();
  failNextAtomicUpdate = false;

  addUser(user: LocalUser): void {
    this.users.set(`${user.ecosystemCode}:${user.userId}`, user);
  }

  addNotificationType(code: string, id = `${code}-id`): void {
    this.notificationTypes.set(code, id);
    this.notificationTypeCodesById.set(id, code);
  }

  addChannel(code: string, id = `${code}-id`): void {
    this.channels.set(code, id);
    this.channelCodesById.set(id, code);
  }

  addDefaultPreference(notificationType: string, channel: string, allowed: boolean): void {
    const notificationTypeId = this.notificationTypes.get(notificationType);
    const channelId = this.channels.get(channel);

    assert.ok(notificationTypeId);
    assert.ok(channelId);
    this.defaultPreferences.set(`${notificationTypeId}:${channelId}`, {
      notificationTypeId,
      channelId,
      allowed,
    });
  }

  async findUser(ecosystemCode: string, userId: string): Promise<LocalUser | null> {
    return this.users.get(`${ecosystemCode}:${userId}`) ?? null;
  }

  async getDefaultPreferencesWithUserOverrides(userId: string): Promise<DefaultPreferenceWithUserOverride[]> {
    const overrides = this.userPreferences.get(userId) ?? new Map<string, UserPreferenceRow>();

    return [...this.defaultPreferences.values()].map((defaultPreference) => {
      const key = `${defaultPreference.notificationTypeId}:${defaultPreference.channelId}`;
      const override = overrides.get(key);

      return {
        notificationType: this.notificationTypeCodesById.get(defaultPreference.notificationTypeId) as string,
        channel: this.channelCodesById.get(defaultPreference.channelId) as string,
        defaultAllowed: defaultPreference.allowed,
        userAllowed: override?.allowed ?? null,
      };
    });
  }

  async getQuietHours(userId: string): Promise<QuietHoursValue | null> {
    return this.quietHours.get(userId) ?? null;
  }

  async findNotificationTypeId(code: string): Promise<string | null> {
    return this.notificationTypes.get(code) ?? null;
  }

  async findChannelId(code: string): Promise<string | null> {
    return this.channels.get(code) ?? null;
  }

  async updatePreferencesAndQuietHours(
    userId: string,
    preferences: ResolvedPreferenceUpdate[] | undefined,
    quietHours: QuietHoursValue | undefined,
  ): Promise<void> {
    const previousPreferences = new Map(this.userPreferences.get(userId) ?? []);
    const previousQuietHours = this.quietHours.get(userId);

    try {
      const userRows = new Map(this.userPreferences.get(userId) ?? []);

      for (const preference of preferences ?? []) {
        userRows.set(`${preference.notificationTypeId}:${preference.channelId}`, preference);
      }

      this.userPreferences.set(userId, userRows);

      if (this.failNextAtomicUpdate) {
        this.failNextAtomicUpdate = false;
        throw new Error('simulated atomic update failure');
      }

      if (quietHours !== undefined) {
        this.quietHours.set(userId, quietHours);
      }
    } catch (error) {
      this.userPreferences.set(userId, previousPreferences);

      if (previousQuietHours === undefined) {
        this.quietHours.delete(userId);
      } else {
        this.quietHours.set(userId, previousQuietHours);
      }

      throw error;
    }
  }

  countUserPreferences(userId: string): number {
    return this.userPreferences.get(userId)?.size ?? 0;
  }
}

function createRepository(): InMemoryPreferencesRepository {
  const repository = new InMemoryPreferencesRepository();
  repository.addUser({ id: 'local-user-id', ecosystemCode: 'vk', userId: 'user-1' });
  repository.addNotificationType('marketing');
  repository.addNotificationType('transactional');
  repository.addChannel('email');
  repository.addChannel('sms');
  repository.addDefaultPreference('marketing', 'email', false);
  repository.addDefaultPreference('transactional', 'email', true);
  return repository;
}

function createService(repository = createRepository()): PreferencesService {
  return new PreferencesService(repository as unknown as PreferencesRepository, new ErrorService());
}

function createController(service: PreferencesService): PreferencesController {
  const contextService = new ObservabilityContextService(new TestConfigService() as unknown as ConfigService);
  return new PreferencesController(service, contextService);
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

test('GET for an existing new user returns default preferences and quietHours null', async () => {
  const preferences = await createService().getUserPreferences({ ecosystemCode: 'vk', userId: 'user-1' });

  assert.equal(preferences.quietHours, null);
  assert.deepEqual(preferences.preferences, [
    {
      notificationType: 'marketing',
      channel: 'email',
      allowed: false,
      source: 'default_preference',
    },
    {
      notificationType: 'transactional',
      channel: 'email',
      allowed: true,
      source: 'default_preference',
    },
  ]);
});

test('GET returns user preference values overriding default preferences', async () => {
  const repository = createRepository();
  const service = createService(repository);

  await service.updateUserPreferences({
    ecosystemCode: 'vk',
    userId: 'user-1',
    preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true }],
  });
  const preferences = await service.getUserPreferences({ ecosystemCode: 'vk', userId: 'user-1' });

  assert.deepEqual(preferences.preferences[0], {
    notificationType: 'marketing',
    channel: 'email',
    allowed: true,
    source: 'user_preference',
  });
  assert.deepEqual(preferences.preferences[1], {
    notificationType: 'transactional',
    channel: 'email',
    allowed: true,
    source: 'default_preference',
  });
});

test('unknown user returns 404 for GET and POST', async () => {
  const service = createService();

  await assert.rejects(
    () => service.getUserPreferences({ ecosystemCode: 'vk', userId: 'missing' }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.notFound);
      assert.equal((error as { message?: string }).message, 'User was not found.');
      return true;
    },
  );
  await assert.rejects(
    () =>
      service.updateUserPreferences({
        ecosystemCode: 'vk',
        userId: 'missing',
        preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true }],
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.notFound);
      return true;
    },
  );
});

test('POST creates and updates user preferences idempotently and GET reflects the result', async () => {
  const repository = createRepository();
  const service = createService(repository);

  await service.updateUserPreferences({
    ecosystemCode: 'vk',
    userId: 'user-1',
    preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true }],
  });
  await service.updateUserPreferences({
    ecosystemCode: 'vk',
    userId: 'user-1',
    preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true }],
  });
  await service.updateUserPreferences({
    ecosystemCode: 'vk',
    userId: 'user-1',
    preferences: [{ notificationType: 'marketing', channel: 'email', allowed: false }],
  });
  const preferences = await service.getUserPreferences({ ecosystemCode: 'vk', userId: 'user-1' });

  assert.equal(repository.countUserPreferences('local-user-id'), 1);
  assert.equal(preferences.preferences[0].allowed, false);
  assert.equal(preferences.preferences[0].source, 'user_preference');
});

test('unknown notification type and unknown channel return 404', async () => {
  const service = createService();

  await assert.rejects(
    () =>
      service.updateUserPreferences({
        ecosystemCode: 'vk',
        userId: 'user-1',
        preferences: [{ notificationType: 'unknown', channel: 'email', allowed: true }],
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.notFound);
      assert.equal((error as { message?: string }).message, 'Notification type was not found.');
      return true;
    },
  );
  await assert.rejects(
    () =>
      service.updateUserPreferences({
        ecosystemCode: 'vk',
        userId: 'user-1',
        preferences: [{ notificationType: 'marketing', channel: 'unknown', allowed: true }],
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, ERROR_CODES.notFound);
      assert.equal((error as { message?: string }).message, 'Channel was not found.');
      return true;
    },
  );
});

test('POST creates, updates, and idempotently stores quiet hours including midnight crossing', async () => {
  const repository = createRepository();
  const service = createService(repository);
  const quietHours = {
    startTime: '22:00',
    endTime: '08:00',
    timezone: 'Asia/Yekaterinburg',
  };

  await service.updateUserPreferences({ ecosystemCode: 'vk', userId: 'user-1', quietHours });
  await service.updateUserPreferences({ ecosystemCode: 'vk', userId: 'user-1', quietHours });
  await service.updateUserPreferences({
    ecosystemCode: 'vk',
    userId: 'user-1',
    quietHours: { startTime: '21:00', endTime: '07:00', timezone: 'Europe/Moscow' },
  });

  assert.deepEqual(repository.quietHours.get('local-user-id'), {
    startTime: '21:00',
    endTime: '07:00',
    timezone: 'Europe/Moscow',
  });
  assert.equal(repository.quietHours.size, 1);
});

test('quiet hours startTime equal endTime and non-IANA timezone return validation_error', async () => {
  await expectValidationError(
    { quietHours: { startTime: '22:00', endTime: '22:00', timezone: 'Asia/Yekaterinburg' } },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'endTime',
  );
  await expectValidationError(
    { quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'Not/AZone' } },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'timezone',
  );
});

test('body without preferences and quietHours returns validation_error from DTO validation', async () => {
  await expectValidationError(
    {},
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'preferences or quietHours',
  );
});

test('DTO validation rejects empty arrays, malformed fields, extra body fields, and extra nested fields', async () => {
  await expectValidationError(
    { preferences: [] },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'preferences',
  );
  await expectValidationError(
    { preferences: [{ notificationType: 'marketing', channel: 'email' }] },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'allowed',
  );
  await expectValidationError(
    { preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true, extra: true }] },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'extra',
  );
  await expectValidationError(
    { quietHours: { startTime: '99:00', endTime: '08:00', timezone: 'Asia/Yekaterinburg' }, extra: true },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'extra',
  );
  await expectValidationError(
    { preferences: null },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'preferences',
  );
  await expectValidationError(
    { quietHours: null },
    { type: 'body', metatype: UpdateUserPreferencesDto },
    'quietHours',
  );
});

test('DTO validation rejects invalid ecosystemCode and userId', async () => {
  await expectValidationError(
    { ecosystemCode: '', userId: 'user-1' },
    { type: 'param', metatype: UserPreferencesParamsDto },
    'ecosystemCode',
  );
  await expectValidationError(
    { ecosystemCode: 'vk', userId: '' },
    { type: 'param', metatype: UserPreferencesParamsDto },
    'userId',
  );
});

test('controller success envelopes include requestId from observability context', async () => {
  const repository = createRepository();
  const service = createService(repository);
  const contextService = new ObservabilityContextService(new TestConfigService() as unknown as ConfigService);
  const controller = new PreferencesController(service, contextService);

  await contextService.runWithContext(
    { requestId: 'request-123', serviceId: 'test-service', correlationId: null },
    async () => {
      const getResponse = await controller.getUserPreferences({ ecosystemCode: 'vk', userId: 'user-1' });
      const postResponse = await controller.updateUserPreferences(
        { ecosystemCode: 'vk', userId: 'user-1' },
        { quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'Asia/Yekaterinburg' } },
      );

      assert.equal(getResponse.requestId, 'request-123');
      assert.equal(postResponse.requestId, 'request-123');
      assert.deepEqual(postResponse.data, { ecosystemCode: 'vk', userId: 'user-1', updated: true });
    },
  );
});

test('preferences controller explicitly uses BasicAuthGuard', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, PreferencesController) as unknown[];

  assert.deepEqual(guards, [BasicAuthGuard]);
});

test('atomic update rolls back preferences if quiet hours part fails', async () => {
  const repository = createRepository();
  const service = createService(repository);
  repository.failNextAtomicUpdate = true;

  await assert.rejects(() =>
    service.updateUserPreferences({
      ecosystemCode: 'vk',
      userId: 'user-1',
      preferences: [{ notificationType: 'marketing', channel: 'email', allowed: true }],
      quietHours: { startTime: '22:00', endTime: '08:00', timezone: 'Asia/Yekaterinburg' },
    }),
  );

  assert.equal(repository.countUserPreferences('local-user-id'), 0);
  assert.equal(repository.quietHours.has('local-user-id'), false);
});
