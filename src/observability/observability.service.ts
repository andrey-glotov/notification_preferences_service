import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sanitizeErrorDetails } from '../errors/error-details-sanitizer';
import { ObservabilityContextService } from './observability-context.service';
import { OBSERVABILITY_SINK, ObservabilitySink } from './observability.sink';
import {
  ObservabilityPayload,
  ObservabilityRecord,
  RecordCounterInput,
  RecordEventInput,
  RecordTimerInput,
} from './observability.types';

@Injectable()
export class ObservabilityService {
  private readonly fallbackLogger = new Logger('ObservabilityFallback');

  constructor(
    private readonly contextService: ObservabilityContextService,
    @Optional() @Inject(OBSERVABILITY_SINK) private readonly sink?: ObservabilitySink,
  ) {}

  recordEvent(input: RecordEventInput): void {
    this.write({
      eventType: input.eventType,
      component: input.component,
      operation: input.operation,
      severity: input.severity ?? 'info',
      payload: this.sanitizePayload(input.payload ?? {}),
    });
  }

  recordCounter(input: RecordCounterInput): void {
    this.recordEvent({
      eventType: 'metric',
      component: input.component,
      operation: input.operation,
      severity: 'info',
      payload: {
        metricType: 'counter',
        metricName: input.metricName,
        value: input.value ?? 1,
        labels: this.sanitizeLabels(input.labels ?? {}),
      },
    });
  }

  recordTimer(input: RecordTimerInput): void {
    this.recordEvent({
      eventType: 'metric',
      component: input.component,
      operation: input.operation,
      severity: 'info',
      payload: {
        metricType: 'timer',
        metricName: input.metricName,
        durationMs: input.durationMs,
        labels: this.sanitizeLabels(input.labels ?? {}),
      },
    });
  }

  incrementCounter(input: RecordCounterInput): void {
    this.recordCounter(input);
  }

  recordDuration(input: RecordTimerInput): void {
    this.recordTimer(input);
  }

  recordPreferenceChanged(input: {
    ecosystemCode: string;
    userId: string;
    notificationType: string;
    channel: string;
    allowed: boolean;
    source: 'user_preference';
  }): void {
    this.recordEvent({
      eventType: 'preference_changed',
      component: 'preferences',
      operation: 'update_user_preferences',
      payload: input,
    });
    this.incrementCounter({
      metricName: 'preference_changes_total',
      component: 'preferences',
      operation: 'update_user_preferences',
      labels: { channel: input.channel },
    });
  }

  recordQuietHoursChanged(input: {
    ecosystemCode: string;
    userId: string;
    startTime: string;
    endTime: string;
    timezone: string;
  }): void {
    this.recordEvent({
      eventType: 'quiet_hours_changed',
      component: 'preferences',
      operation: 'update_user_preferences',
      payload: input,
    });
    this.incrementCounter({
      metricName: 'quiet_hours_changes_total',
      component: 'preferences',
      operation: 'update_user_preferences',
      labels: { operation: 'update_user_preferences' },
    });
  }

  recordNotificationDecision(input: {
    ecosystemCode: string;
    userId: string;
    notificationType: string;
    channel: string;
    region: string;
    datetime: string;
    decision: string;
    reason: string;
    source: string;
    durationMs: number;
  }): void {
    this.recordEvent({
      eventType: 'notification_decision',
      component: 'evaluation',
      operation: 'evaluate_notification',
      payload: input,
    });
    this.incrementCounter({
      metricName: 'notification_decision_total',
      component: 'evaluation',
      operation: 'evaluate_notification',
      labels: {
        decision: input.decision,
        source: input.source,
        channel: input.channel,
      },
    });
    this.incrementCounter({
      metricName:
        input.decision === 'allow'
          ? 'notification_decision_allowed_total'
          : 'notification_decision_denied_total',
      component: 'evaluation',
      operation: 'evaluate_notification',
      labels: {
        source: input.source,
        channel: input.channel,
      },
    });
    this.recordDuration({
      metricName: 'notification_decision_duration_ms',
      durationMs: input.durationMs,
      component: 'evaluation',
      operation: 'evaluate_notification',
      labels: { operation: 'evaluate_notification' },
    });
  }

  recordServiceError(input: {
    errorCode: string;
    errorMessage: string;
    component: string;
    operation: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
    retryable?: boolean;
    metadata?: Record<string, unknown> | null;
  }): void {
    this.recordEvent({
      eventType: 'service_error',
      component: input.component,
      operation: input.operation,
      severity: input.severity ?? 'error',
      payload: {
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        component: input.component,
        operation: input.operation,
        retryable: input.retryable ?? false,
        metadata: this.sanitizePayload(input.metadata ?? {}),
      },
    });
    this.incrementCounter({
      metricName: 'service_errors_total',
      component: input.component,
      operation: input.operation,
      labels: {
        component: input.component,
        operation: input.operation,
        errorCode: input.errorCode,
      },
    });
  }

  recordAuthFailure(input: { errorCode?: string; severity?: 'warning' | 'critical' }): void {
    this.recordServiceError({
      errorCode: input.errorCode ?? 'unauthorized',
      errorMessage: input.errorCode === 'basic_auth_misconfigured' ? 'Basic Auth is misconfigured.' : 'Authentication is required.',
      component: 'auth',
      operation: 'basic_auth',
      severity: input.severity ?? 'warning',
      retryable: false,
      metadata: {},
    });
    this.incrementCounter({
      metricName: 'auth_failures_total',
      component: 'auth',
      operation: 'basic_auth',
      labels: { errorCode: input.errorCode ?? 'unauthorized' },
    });
  }

  private write(input: Omit<ObservabilityRecord, 'requestId' | 'serviceId' | 'correlationId' | 'timestamp'>): void {
    const record: ObservabilityRecord = {
      ...input,
      requestId: this.contextService.getRequestId(),
      serviceId: this.contextService.getServiceId(),
      correlationId: this.contextService.getCorrelationId(),
      timestamp: new Date().toISOString(),
    };

    try {
      void Promise.resolve(this.sink?.write(record)).catch((error) => this.logSinkError(error));
    } catch (error) {
      this.logSinkError(error);
    }
  }

  private logSinkError(error: unknown): void {
    try {
      this.fallbackLogger.error(
        JSON.stringify({
          eventType: 'service_error',
          component: 'observability',
          operation: 'write_event',
          severity: 'error',
          errorCode: 'observability_sink_error',
          errorMessage: 'Observability sink write failed.',
          details: this.sanitizePayload({ errorName: error instanceof Error ? error.name : typeof error }),
        }),
      );
    } catch {
      // Observability fallback logging must never affect application flow.
    }
  }

  private sanitizePayload(payload: ObservabilityPayload): ObservabilityPayload {
    return sanitizeErrorDetails(payload) ?? {};
  }

  private sanitizeLabels(labels: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
    const allowedLabelKeys = new Set([
      'decision',
      'source',
      'channel',
      'operation',
      'component',
      'statusCode',
      'route',
      'errorCode',
    ]);
    const sanitized = this.sanitizePayload(labels);
    const safeLabels: Record<string, string | number | boolean | null> = {};

    for (const [key, value] of Object.entries(sanitized)) {
      if (
        allowedLabelKeys.has(key) &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)
      ) {
        safeLabels[key] = value;
      }
    }

    return safeLabels;
  }
}
