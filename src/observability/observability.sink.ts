import { ObservabilityRecord } from './observability.types';

export const OBSERVABILITY_SINK = Symbol('OBSERVABILITY_SINK');

export interface ObservabilitySink {
  write(record: ObservabilityRecord): Promise<void> | void;
}
