import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyStripeWebhookSignature(
  payload: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(',').map(part => part.split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signatures = parts
    .filter(([key, value]) => key === 'v1' && value && /^[\da-f]{64}$/i.test(value))
    .map(([, value]) => Buffer.from(value, 'hex'));
  if (!signatures.length) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  return signatures.some(signature => signature.length === expected.length && timingSafeEqual(signature, expected));
}
