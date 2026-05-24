import { randomBytes } from 'crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
let lastGeneratedEpochNs = 0n;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function generateRequestId(): string {
  const epochNs = BigInt(Date.now()) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n);
  const monotonicEpochNs = epochNs > lastGeneratedEpochNs ? epochNs : lastGeneratedEpochNs + 1n;

  lastGeneratedEpochNs = monotonicEpochNs;

  return `req_${monotonicEpochNs}_${randomBytes(3).toString('hex')}`;
}

