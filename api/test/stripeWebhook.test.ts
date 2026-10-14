import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyStripeWebhookSignature } from '../src/stripeWebhook.js';

const secret = 'whsec_test_secret';
const timestamp = 1_800_000_000;
const payload = Buffer.from('{"type":"checkout.session.completed"}');

function signatureFor(body = payload) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

test('accepts a valid Stripe webhook signature', () => {
  assert.equal(verifyStripeWebhookSignature(payload, signatureFor(), secret, timestamp), true);
});

test('rejects a signature for a different payload', () => {
  assert.equal(verifyStripeWebhookSignature(Buffer.from('tampered'), signatureFor(), secret, timestamp), false);
});

test('rejects signatures outside the timestamp tolerance', () => {
  assert.equal(verifyStripeWebhookSignature(payload, signatureFor(), secret, timestamp + 301), false);
});

test('rejects malformed signatures and missing secrets', () => {
  assert.equal(verifyStripeWebhookSignature(payload, 't=bad,v1=not-a-signature', secret, timestamp), false);
  assert.equal(verifyStripeWebhookSignature(payload, signatureFor(), '', timestamp), false);
});
