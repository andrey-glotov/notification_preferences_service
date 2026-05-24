export type ObservabilitySeverity = 'info' | 'warning' | 'error' | 'critical';

export type ObservabilityPayload = Record<string, unknown>;

export type ObservabilityRecord = {
  eventType: string;
  requestId: string | null;
  serviceId: string;
  correlationId: string | null;
  component: string;
  operation: string;
  severity: ObservabilitySeverity;
  timestamp: string;
  payload: ObservabilityPayload;
};

export type RecordEventInput = {
  eventType: string;
  component: string;
  operation: string;
  severity?: ObservabilitySeverity;
  payload?: ObservabilityPayload;
};

export type RecordCounterInput = {
  metricName: string;
  value?: number;
  component: string;
  operation: string;
  labels?: Record<string, string | number | boolean | null>;
};

export type RecordTimerInput = {
  metricName: string;
  durationMs: number;
  component: string;
  operation: string;
  labels?: Record<string, string | number | boolean | null>;
};
