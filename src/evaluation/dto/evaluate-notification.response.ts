import { EvaluationResult } from '../evaluation.types';

export type EvaluateNotificationResponse = {
  decision: EvaluationResult['decision'];
  reason: EvaluationResult['reason'];
  source: EvaluationResult['source'];
};

export type EvaluateNotificationEnvelope = {
  data: EvaluateNotificationResponse;
  requestId: string | null;
};

export function toEvaluateNotificationResponse(result: EvaluationResult): EvaluateNotificationResponse {
  return {
    decision: result.decision,
    reason: result.reason,
    source: result.source,
  };
}
