const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|password|passwd|credential|secret|token|api[_-]?key|private[_-]?key|connection[_-]?string|headers?|raw[_-]?body|stack|sql|cause/i;

const SENSITIVE_VALUE_PATTERN =
  /postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|redis:\/\/|password\s*=|authorization:|basic\s+[a-z0-9+/=]+|bearer\s+[a-z0-9._~+/=-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|stack trace/i;

export function sanitizeErrorDetails(details?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!details) {
    return null;
  }

  const sanitized = sanitizeRecord(details);

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    const safeValue = sanitizeValue(value);

    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return SENSITIVE_VALUE_PATTERN.test(value) ? '[redacted]' : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((item) => item !== undefined);
  }

  if (value instanceof Error || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }

  if (typeof value === 'object') {
    const sanitized = sanitizeRecord(value as Record<string, unknown>);

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  return undefined;
}
