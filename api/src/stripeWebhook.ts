import { createHmac, timingSafeEqual } from 'node:crypto';

const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function verifyStripeWebhookSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!Buffer.isBuffer(payload) || !signatureHeader || !secret.trim()) return false;

  const parts = signatureHeader.split(',').map((part) => part.trim().split('='));
  const timestampPart = parts.find(([key]) => key === 't')?.[1];
  const timestamp = timestampPart && /^\d+$/.test(timestampPart) ? Number(timestampPart) : NaN;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  return parts
    .filter(([key]) => key === 'v1')
    .some(([, value]) => {
      if (!value || !/^[a-f\d]{64}$/i.test(value)) return false;
      const candidate = Buffer.from(value, 'hex');
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });
}
