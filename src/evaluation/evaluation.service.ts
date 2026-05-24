import { Injectable, Optional } from '@nestjs/common';
import { ErrorService } from '../errors/error.service';
import { ObservabilityService } from '../observability/observability.service';
import { EvaluationRepository } from './evaluation.repository';
import {
  EvaluationChannel,
  EvaluationInput,
  EvaluationNotificationType,
  EvaluationQuietHours,
  EvaluationResult,
  EvaluationUser,
} from './evaluation.types';

@Injectable()
export class EvaluationService {
  constructor(
    private readonly evaluationRepository: EvaluationRepository,
    private readonly errorService: ErrorService,
    @Optional() private readonly observabilityService?: ObservabilityService,
  ) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const startedAt = process.hrtime.bigint();
    const result = await this.evaluateDecision(input);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    this.observabilityService?.recordNotificationDecision({
      ecosystemCode: input.ecosystemCode,
      userId: input.userId,
      notificationType: input.notificationType,
      channel: input.channel,
      region: input.region,
      datetime: input.datetime,
      decision: result.decision,
      reason: result.reason,
      source: result.source,
      durationMs,
    });

    return result;
  }

  private async evaluateDecision(input: EvaluationInput): Promise<EvaluationResult> {
    const [user, notificationType, channel] = await Promise.all([
      this.findUserOrThrow(input),
      this.findNotificationTypeOrThrow(input.notificationType),
      this.findChannelOrThrow(input.channel),
    ]);
    const denyPolicy = await this.evaluationRepository.findMatchingDenyPolicy(
      notificationType.id,
      channel.id,
      input.region,
    );

    if (denyPolicy !== null) {
      return {
        decision: 'deny',
        reason: 'blocked_by_global_policy',
        source: 'global_policy',
      };
    }

    if (notificationType.respectsQuietHours) {
      const quietHours = await this.evaluationRepository.getQuietHours(user.id);

      if (quietHours !== null && this.isInsideQuietHours(input.datetime, quietHours)) {
        return {
          decision: 'deny',
          reason: 'blocked_by_quiet_hours',
          source: 'quiet_hours',
        };
      }
    }

    const userPreference = await this.evaluationRepository.getUserPreferenceAllowed(
      user.id,
      notificationType.id,
      channel.id,
    );

    if (userPreference === true) {
      return {
        decision: 'allow',
        reason: 'allowed_by_user_preference',
        source: 'user_preference',
      };
    }

    if (userPreference === false) {
      return {
        decision: 'deny',
        reason: 'blocked_by_user_preference',
        source: 'user_preference',
      };
    }

    const defaultPreference = await this.evaluationRepository.getDefaultPreferenceAllowed(
      notificationType.id,
      channel.id,
    );

    if (defaultPreference === true) {
      return {
        decision: 'allow',
        reason: 'allowed_by_default_preference',
        source: 'default_preference',
      };
    }

    if (defaultPreference === false) {
      return {
        decision: 'deny',
        reason: 'blocked_by_default_preference',
        source: 'default_preference',
      };
    }

    return {
      decision: 'deny',
      reason: 'fallback_deny',
      source: 'fallback',
    };
  }

  private async findUserOrThrow(input: EvaluationInput): Promise<EvaluationUser> {
    const user = await this.evaluationRepository.findUser(input.ecosystemCode, input.userId);

    if (user === null) {
      throw this.errorService.notFound({
        message: 'User was not found.',
        details: { ecosystemCode: input.ecosystemCode, userId: input.userId },
        component: 'evaluation',
        operation: 'evaluate_notification',
      });
    }

    return user;
  }

  private async findNotificationTypeOrThrow(code: string): Promise<EvaluationNotificationType> {
    const notificationType = await this.evaluationRepository.findNotificationType(code);

    if (notificationType === null) {
      throw this.errorService.notFound({
        message: 'Notification type was not found.',
        details: { notificationType: code },
        component: 'evaluation',
        operation: 'evaluate_notification',
      });
    }

    return notificationType;
  }

  private async findChannelOrThrow(code: string): Promise<EvaluationChannel> {
    const channel = await this.evaluationRepository.findChannel(code);

    if (channel === null) {
      throw this.errorService.notFound({
        message: 'Channel was not found.',
        details: { channel: code },
        component: 'evaluation',
        operation: 'evaluate_notification',
      });
    }

    return channel;
  }

  private isInsideQuietHours(datetime: string, quietHours: EvaluationQuietHours): boolean {
    if (quietHours.startTime === quietHours.endTime) {
      throw this.errorService.internal({
        message: 'Internal server error.',
        details: null,
        component: 'evaluation',
        operation: 'evaluate_notification',
        severity: 'error',
      });
    }

    const localTime = this.toLocalHourMinute(datetime, quietHours.timezone);

    if (quietHours.startTime < quietHours.endTime) {
      return localTime >= quietHours.startTime && localTime < quietHours.endTime;
    }

    return localTime >= quietHours.startTime || localTime < quietHours.endTime;
  }

  private toLocalHourMinute(datetime: string, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(datetime));
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;

    if (hour === undefined || minute === undefined) {
      throw this.errorService.internal({
        message: 'Internal server error.',
        details: null,
        component: 'evaluation',
        operation: 'evaluate_notification',
        severity: 'error',
      });
    }

    return `${hour}:${minute}`;
  }
}
