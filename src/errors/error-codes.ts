export const ERROR_CODES = {
  validation: 'validation_error',
  badRequest: 'bad_request',
  unauthorized: 'unauthorized',
  notFound: 'not_found',
  conflict: 'conflict',
  internal: 'internal_server_error',
  serviceUnavailable: 'service_unavailable',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
