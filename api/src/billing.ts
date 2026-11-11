import { config } from './config.js';
import { pool } from './db.js';
import { verifyStripeWebhookSignature } from './stripeWebhook.js';

export type VipPlan = 'VIP_MONTHLY' | 'VIP_YEARLY';

function httpError(message: string, statusCode: number, cause?: unknown) {
  return Object.assign(new Error(message, { cause }), { statusCode });
}

function stripeConfig() {
  const missing = [
    ['STRIPE_SECRET_KEY', config.STRIPE_SECRET_KEY],
    ['STRIPE_WEBHOOK_SECRET', config.STRIPE_WEBHOOK_SECRET],
    ['PUBLIC_API_URL', config.PUBLIC_API_URL],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length) {
    throw httpError(`Stripe Checkout is not configured. Missing: ${missing.join(', ')}.`, 503);
  }

  const secretKey = config.STRIPE_SECRET_KEY!.trim();
  const expectedPrefix = config.STRIPE_MODE === 'test' ? 'sk_test_' : 'sk_live_';
  if (!secretKey.startsWith(expectedPrefix)) {
    throw httpError(`STRIPE_SECRET_KEY must use the ${config.STRIPE_MODE} key for the configured Stripe mode.`, 503);
  }
  if (config.STRIPE_MODE === 'live' && !config.PUBLIC_API_URL!.startsWith('https://')) {
    throw httpError('PUBLIC_API_URL must use HTTPS for live Stripe payments.', 503);
  }

  return {
    secretKey,
    apiUrl: 'https://api.stripe.com/v1',
    publicApiUrl: config.PUBLIC_API_URL!.replace(/\/$/, ''),
  };
}

function subscriptionPrice(plan: VipPlan) {
  return plan === 'VIP_MONTHLY' ? config.VIP_MONTHLY_PRICE_SEN : config.VIP_YEARLY_PRICE_SEN;
}

async function postCheckoutSession(fields: URLSearchParams, idempotencyKey: string) {
  const settings = stripeConfig();
  let response: Response;
  try {
    response = await fetch(`${settings.apiUrl}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: fields,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw httpError('Unable to reach Stripe to create the checkout session.', 502, error);
  }

  const responseText = await response.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText) as unknown;
  } catch (error) {
    throw httpError('Stripe returned an invalid checkout response.', 502, error);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    throw httpError('Stripe returned an invalid checkout response.', 502);
  }
  const body = parsedBody as { id?: unknown; url?: unknown; error?: { message?: unknown } };
  if (!response.ok || !body.id || !body.url) {
    const message = body.error?.message;
    throw httpError(typeof message === 'string' ? message : 'Stripe could not create the checkout session.', 502);
  }
  if (typeof body.id !== 'string' || typeof body.url !== 'string') {
    throw httpError('Stripe returned an invalid checkout session.', 502);
  }
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(body.url);
  } catch (error) {
    throw httpError('Stripe returned an invalid checkout URL.', 502, error);
  }
  if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
    throw httpError('Stripe returned an unexpected checkout URL.', 502);
  }
  return { id: body.id, url: body.url };
}

export async function createVipCheckout(user: { id: string; name: string; email: string }, plan: VipPlan) {
  const settings = stripeConfig();
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
      "INSERT INTO payment_transactions (user_id, subscription_id, provider, amount, currency, status) VALUES ($1, $2, 'STRIPE', $3, 'MYR', 'PENDING') RETURNING id",
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
    const fields = new URLSearchParams();
    fields.set('mode', 'payment');
    fields.set('payment_method_types[0]', 'card');
    fields.set('payment_method_types[1]', 'fpx');
    fields.set('line_items[0][price_data][currency]', 'myr');
    fields.set('line_items[0][price_data][unit_amount]', String(amountSen));
    fields.set('line_items[0][price_data][product_data][name]', plan === 'VIP_MONTHLY' ? 'CINEVA VIP Monthly' : 'CINEVA VIP Yearly');
    fields.set('line_items[0][quantity]', '1');
    fields.set('customer_email', user.email);
    fields.set('client_reference_id', paymentId);
    fields.set('metadata[paymentTransactionId]', paymentId);
    fields.set('metadata[subscriptionId]', subscriptionId);
    fields.set('metadata[plan]', plan);
    fields.set('success_url', `${settings.publicApiUrl}/api/v1/payments/stripe/return?session_id={CHECKOUT_SESSION_ID}`);
    fields.set('cancel_url', `${settings.publicApiUrl}/api/v1/payments/stripe/cancel`);

    const session = await postCheckoutSession(fields, paymentId);
    await pool.query('UPDATE payment_transactions SET provider_reference = $1 WHERE id = $2', [session.id, paymentId]);
    return { paymentUrl: session.url, subscriptionId };
  } catch (error) {
    try {
      await pool.query("UPDATE payment_transactions SET status = 'FAILED', failure_reason = 'CHECKOUT_FAILED' WHERE id = $1 AND status = 'PENDING'", [paymentId]);
      await pool.query("UPDATE subscriptions SET status = 'EXPIRED', cancelled_at = now(), end_reason = 'CHECKOUT_FAILED' WHERE id = $1 AND status = 'PAST_DUE'", [subscriptionId]);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Stripe checkout failed and its pending payment could not be marked failed.');
    }
    throw error;
  }
}

type StripeCheckoutSession = {
  id?: unknown;
  client_reference_id?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
  metadata?: unknown;
};

type StripeEvent = {
  type?: unknown;
  livemode?: unknown;
  data?: { object?: unknown };
};

export async function processStripeWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw httpError('Stripe webhook is not configured. Missing: STRIPE_WEBHOOK_SECRET.', 503);
  }
  if (!Buffer.isBuffer(rawBody) || !verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    throw httpError('Invalid Stripe webhook signature.', 401);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
  } catch (error) {
    throw httpError('Stripe webhook payload is not valid JSON.', 400, error);
  }
  if (typeof event.type !== 'string' || typeof event.livemode !== 'boolean') {
    throw httpError('Stripe webhook payload is missing required event fields.', 400);
  }
  if (event.livemode !== (config.STRIPE_MODE === 'live')) {
    throw httpError('Stripe webhook mode does not match the configured payment mode.', 400);
  }

  const successfulPayment = event.type === 'checkout.session.async_payment_succeeded'
    || event.type === 'checkout.session.completed';
  const failedPayment = event.type === 'checkout.session.async_payment_failed'
    || event.type === 'checkout.session.expired';
  if (!successfulPayment && !failedPayment) return;

  const session = event.data?.object as StripeCheckoutSession | undefined;
  if (!session || typeof session.id !== 'string' || !session.id) {
    throw httpError('Stripe checkout event is missing its session ID.', 400);
  }
  const metadata = session.metadata;
  if (!metadata || typeof metadata !== 'object') {
    throw httpError('Stripe checkout event is missing payment metadata.', 400);
  }
  const paymentId = (metadata as Record<string, unknown>).paymentTransactionId;
  const subscriptionId = (metadata as Record<string, unknown>).subscriptionId;
  const plan = (metadata as Record<string, unknown>).plan;
  if (typeof paymentId !== 'string' || typeof subscriptionId !== 'string' || typeof plan !== 'string' || session.client_reference_id !== paymentId) {
    throw httpError('Stripe checkout event has invalid payment metadata.', 400);
  }

  const isPaid = event.type === 'checkout.session.async_payment_succeeded'
    || session.payment_status === 'paid';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      payment_id: string;
      subscription_id: string;
      amount: string;
      plan_code: VipPlan;
      status: string;
      provider_reference: string | null;
    }>(`
      SELECT p.id AS payment_id, p.subscription_id, p.amount::text, s.plan_code, p.status, p.provider_reference
      FROM payment_transactions p
      JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.id = $1 AND p.provider = 'STRIPE' AND s.id = $2
      FOR UPDATE OF p, s
    `, [paymentId, subscriptionId]);
    const row = result.rows[0];
    if (!row || row.plan_code !== plan) throw httpError('Stripe checkout session does not match a pending subscription payment.', 404);

    if (row.status === 'SUCCEEDED' || row.status === 'REFUNDED') {
      await client.query('COMMIT');
      return;
    }

    const currentReference = row.provider_reference;
    if (currentReference && currentReference !== session.id) {
      throw httpError('Stripe checkout session does not match the payment record.', 409);
    }
    if (!currentReference) {
      await client.query('UPDATE payment_transactions SET provider_reference = $1 WHERE id = $2', [session.id, paymentId]);
    }

    if (successfulPayment && isPaid) {
      const amountMatches = Number.isInteger(session.amount_total)
        && session.amount_total === Math.round(Number(row.amount) * 100);
      const currencyMatches = session.currency === 'myr';
      if (!amountMatches || !currencyMatches) {
        await client.query("UPDATE payment_transactions SET status = 'FAILED', failure_reason = 'AMOUNT_MISMATCH' WHERE id = $1 AND status <> 'SUCCEEDED'", [paymentId]);
        await client.query("UPDATE subscriptions SET status = 'EXPIRED', cancelled_at = now(), end_reason = 'AMOUNT_MISMATCH' WHERE id = $1 AND status = 'PAST_DUE'", [subscriptionId]);
        console.error('Stripe checkout amount or currency did not match its pending payment.');
      } else {
        await client.query("UPDATE payment_transactions SET status = 'SUCCEEDED' WHERE id = $1 AND status IN ('PENDING', 'FAILED')", [paymentId]);
        const interval = row.plan_code === 'VIP_YEARLY' ? '1 year' : '1 month';
        await client.query("UPDATE subscriptions SET status = 'EXPIRED' WHERE user_id = (SELECT user_id FROM subscriptions WHERE id = $1) AND id <> $1 AND status = 'ACTIVE'", [subscriptionId]);
        await client.query("UPDATE subscriptions SET status = 'ACTIVE', started_at = now(), renews_at = now() + $2::interval, cancelled_at = NULL WHERE id = $1", [subscriptionId, interval]);
      }
    } else if (failedPayment && row.status === 'PENDING') {
      const failureReason = event.type === 'checkout.session.async_payment_failed' ? 'PAYMENT_FAILED' : 'CHECKOUT_EXPIRED';
      const endReason = event.type === 'checkout.session.async_payment_failed' ? 'PAYMENT_FAILED' : 'CHECKOUT_EXPIRED';
      await client.query('UPDATE payment_transactions SET status = $1, failure_reason = $2 WHERE id = $3', ['FAILED', failureReason, paymentId]);
      await client.query("UPDATE subscriptions SET status = 'EXPIRED', cancelled_at = now(), end_reason = $1 WHERE id = $2 AND status = 'PAST_DUE'", [endReason, subscriptionId]);
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
