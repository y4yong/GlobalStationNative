import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db.js';

export type VipPlan = 'VIP_MONTHLY' | 'VIP_YEARLY';

function billingConfig() {
  const missing = [
    ['BILLPLZ_API_KEY', config.BILLPLZ_API_KEY],
    ['BILLPLZ_COLLECTION_ID', config.BILLPLZ_COLLECTION_ID],
    ['BILLPLZ_X_SIGNATURE_KEY', config.BILLPLZ_X_SIGNATURE_KEY],
    ['PUBLIC_API_URL', config.PUBLIC_API_URL],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length) {
    throw Object.assign(new Error(`Billplz is not configured. Missing: ${missing.join(', ')}.`), { statusCode: 503 });
  }
  const host = config.BILLPLZ_MODE === 'sandbox' ? 'https://www.billplz-sandbox.com' : 'https://www.billplz.com';
  return {
    apiKey: config.BILLPLZ_API_KEY!,
    collectionId: config.BILLPLZ_COLLECTION_ID!,
    signatureKey: config.BILLPLZ_X_SIGNATURE_KEY!,
    apiBaseUrl: `${host}/api/v3`,
    publicApiUrl: config.PUBLIC_API_URL!.replace(/\/$/, ''),
  };
}

function subscriptionPrice(plan: VipPlan) {
  return plan === 'VIP_MONTHLY' ? config.BILLPLZ_MONTHLY_PRICE_SEN : config.BILLPLZ_YEARLY_PRICE_SEN;
}

async function postBill(fields: Record<string, string>) {
  const settings = billingConfig();
  const basicAuth = Buffer.from(`${settings.apiKey}:`).toString('base64');
  const response = await fetch(`${settings.apiBaseUrl}/bills`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; url?: string; error?: { message?: string[] } };
  if (!response.ok || !body.id || !body.url) {
    throw Object.assign(new Error(body.error?.message?.join(', ') ?? 'Billplz could not create the payment bill.'), { statusCode: 502 });
  }
  return body;
}

export async function createVipCheckout(user: { id: string; name: string; email: string }, plan: VipPlan) {
  const settings = billingConfig();
  const amountSen = subscriptionPrice(plan);
  const client = await pool.connect();
  let subscriptionId = '';
  let paymentId = '';
  try {
    await client.query('BEGIN');
    const subscription = await client.query<{ id: string }>(
      "INSERT INTO subscriptions (user_id, plan_code, status) VALUES ($1, $2, 'PAST_DUE') RETURNING id",
      [user.id, plan],
    );
    subscriptionId = subscription.rows[0].id;
    const payment = await client.query<{ id: string }>(
      "INSERT INTO payment_transactions (user_id, subscription_id, provider, amount, currency, status) VALUES ($1, $2, 'BILLPLZ', $3, 'MYR', 'PENDING') RETURNING id",
      [user.id, subscriptionId, amountSen / 100],
    );
    paymentId = payment.rows[0].id;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    const bill = await postBill({
      collection_id: settings.collectionId,
      description: plan === 'VIP_MONTHLY' ? 'Global Station VIP Monthly' : 'Global Station VIP Yearly',
      email: user.email,
      name: user.name,
      amount: String(amountSen),
      callback_url: `${settings.publicApiUrl}/api/v1/payments/billplz/callback`,
      redirect_url: `${settings.publicApiUrl}/api/v1/payments/billplz/return`,
      reference_1_label: 'Subscription',
      reference_1: subscriptionId,
    });
    await pool.query('UPDATE payment_transactions SET provider_reference = $1 WHERE id = $2', [bill.id, paymentId]);
    return { paymentUrl: bill.url, subscriptionId };
  } catch (error) {
    await pool.query("UPDATE payment_transactions SET status = 'FAILED' WHERE id = $1", [paymentId]);
    await pool.query("UPDATE subscriptions SET status = 'EXPIRED', cancelled_at = now() WHERE id = $1", [subscriptionId]);
    throw error;
  }
}

function flattenSignatureFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .filter(([key]) => key.toLowerCase() !== 'x_signature')
    .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
    .map(([key, value]) => `${key}${value == null ? '' : String(value)}`)
    .join('|');
}

export function verifyBillplzSignature(fields: Record<string, unknown>) {
  const signature = fields.x_signature;
  if (typeof signature !== 'string' || !signature) return false;
  const expected = createHmac('sha256', billingConfig().signatureKey).update(flattenSignatureFields(fields)).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function processBillplzCallback(fields: Record<string, unknown>) {
  billingConfig();
  if (!verifyBillplzSignature(fields)) {
    throw Object.assign(new Error('Invalid Billplz callback signature.'), { statusCode: 401 });
  }
  const billId = typeof fields.id === 'string' ? fields.id : '';
  if (!billId) throw Object.assign(new Error('Billplz callback is missing its bill ID.'), { statusCode: 400 });

  const isPaid = fields.paid === true || fields.paid === 'true';
  const state = typeof fields.state === 'string' ? fields.state.toLowerCase() : '';
  const callbackAmount = Number(fields.amount);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await client.query<{
      payment_id: string;
      subscription_id: string;
      amount: string;
      plan_code: VipPlan;
      status: string;
    }>(`
      SELECT p.id AS payment_id, p.subscription_id, p.amount::text, s.plan_code, p.status
      FROM payment_transactions p
      JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.provider = 'BILLPLZ' AND p.provider_reference = $1
      FOR UPDATE OF p, s
    `, [billId]);
    const row = payment.rows[0];
    if (!row) throw Object.assign(new Error('Billplz bill was not found.'), { statusCode: 404 });

    if (row.status === 'PENDING' && (isPaid || state === 'deleted')) {
      const amountMatches = Number.isFinite(callbackAmount) && Math.round(Number(row.amount) * 100) === callbackAmount;
      const succeeded = isPaid && state === 'paid' && amountMatches;
      await client.query('UPDATE payment_transactions SET status = $1 WHERE id = $2', [succeeded ? 'SUCCEEDED' : 'FAILED', row.payment_id]);
      if (succeeded) {
        const interval = row.plan_code === 'VIP_YEARLY' ? '1 year' : '1 month';
        await client.query("UPDATE subscriptions SET status = 'EXPIRED' WHERE user_id = (SELECT user_id FROM subscriptions WHERE id = $1) AND id <> $1 AND status = 'ACTIVE'", [row.subscription_id]);
        await client.query("UPDATE subscriptions SET status = 'ACTIVE', started_at = now(), renews_at = now() + $2::interval WHERE id = $1", [row.subscription_id, interval]);
      } else {
        await client.query("UPDATE subscriptions SET status = 'EXPIRED', cancelled_at = now() WHERE id = $1", [row.subscription_id]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function currentSubscription(userId: string) {
  const { rows } = await pool.query(`
    SELECT plan_code AS "planCode", status, started_at AS "startedAt", renews_at AS "renewsAt"
    FROM subscriptions
    WHERE user_id = $1
    ORDER BY started_at DESC
    LIMIT 1
  `, [userId]);
  return rows[0] ?? null;
}

