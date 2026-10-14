import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';

export type EngagementCodeType = 'REFERRAL' | 'CAMPAIGN' | 'INFLUENCER' | 'PROMOTION';
export type NotificationChannel = 'IN_APP' | 'PUSH' | 'EMAIL' | 'SMS' | 'WHATSAPP';

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function createCode(prefix: string) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const suffix = Array.from(randomBytes(6), (value) => alphabet[value & 31]).join('');
  return `${prefix}-${suffix}`;
}

export async function ensureReferralCode(userId: string) {
  const existing = await pool.query<{ code: string }>(
    "SELECT code FROM engagement_codes WHERE owner_id = $1 AND code_type = 'REFERRAL' AND char_length(code) <= 9",
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0].code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await pool.query<{ code: string }>(`
        INSERT INTO engagement_codes (code, code_type, owner_id)
        VALUES ($1, 'REFERRAL', $2)
        ON CONFLICT (owner_id)
          WHERE code_type = 'REFERRAL' AND owner_id IS NOT NULL AND char_length(code) <= 9
        DO UPDATE SET owner_id = EXCLUDED.owner_id
        RETURNING code
      `, [createCode('GS'), userId]);
      return result.rows[0].code;
    } catch (error) {
      if ((error as { code?: string; constraint?: string }).code !== '23505'
        || (error as { constraint?: string }).constraint !== 'engagement_codes_code_key') throw error;
    }
  }
  throw new Error('Unable to create a unique referral code after several attempts.');
}

export async function trackSignupCode(client: PoolClient, userId: string, suppliedCode?: string) {
  const normalizedCode = suppliedCode?.trim().toUpperCase();
  if (!normalizedCode) return;

  const { rows } = await client.query<{
    id: string;
    code: string;
    code_type: EngagementCodeType;
    owner_id: string | null;
    max_redemptions: number | null;
  }>(`
    SELECT id, code, code_type, owner_id, max_redemptions
    FROM engagement_codes
    WHERE code = $1 AND is_active
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL OR ends_at > now())
    FOR UPDATE
  `, [normalizedCode]);
  const code = rows[0];
  if (!code) throw httpError('The referral or campaign code is invalid or expired.', 400);
  if (code.owner_id === userId) throw httpError('You cannot use your own code.', 400);

  const { rows: countRows } = await client.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM referrals WHERE code_id = $1',
    [code.id],
  );
  if (code.max_redemptions !== null && countRows[0].count >= code.max_redemptions) {
    throw httpError('This referral or campaign code has reached its redemption limit.', 409);
  }

  await client.query(`
    INSERT INTO referrals (referrer_id, referred_id, referral_code, code_id, attribution_type, status)
    VALUES ($1, $2, $3, $4, $5, 'SIGNED_UP')
  `, [code.owner_id, userId, code.code, code.id, code.code_type]);
}

export async function getReferralOverview(userId: string) {
  const code = await ensureReferralCode(userId);
  const [referrals, rewards] = await Promise.all([
    pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM referrals WHERE referrer_id = $1 AND attribution_type = 'REFERRAL'
      GROUP BY status
    `, [userId]),
    pool.query(`
      SELECT id, reward_type AS "rewardType", amount::text AS amount, currency, status, created_at AS "createdAt", granted_at AS "grantedAt"
      FROM engagement_rewards WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50
    `, [userId]),
  ]);
  return { code, referrals: referrals.rows, rewards: rewards.rows };
}

export async function listNotifications(userId: string, limit: number) {
  const { rows } = await pool.query(`
    SELECT id, title, body, data, status, read_at AS "readAt", created_at AS "createdAt"
    FROM user_notifications
    WHERE user_id = $1 AND channel = 'IN_APP'
    ORDER BY created_at DESC
    LIMIT $2
  `, [userId, limit]);
  return rows;
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const { rowCount } = await pool.query(`
    UPDATE user_notifications SET status = 'READ', read_at = COALESCE(read_at, now())
    WHERE id = $1 AND user_id = $2 AND channel = 'IN_APP'
  `, [notificationId, userId]);
  if (!rowCount) throw httpError('Notification not found.', 404);
}

const notificationChannels: NotificationChannel[] = ['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP'];

export async function getNotificationPreferences(userId: string) {
  const { rows } = await pool.query<{ channel: NotificationChannel; enabled: boolean }>(
    'SELECT channel, enabled FROM user_notification_preferences WHERE user_id = $1',
    [userId],
  );
  const saved = new Map(rows.map((row) => [row.channel, row.enabled]));
  return Object.fromEntries(notificationChannels.map((channel) => [
    channel.toLowerCase(),
    saved.get(channel) ?? channel === 'IN_APP',
  ]));
}

export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<Record<NotificationChannel, boolean>>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [channel, enabled] of Object.entries(preferences) as [NotificationChannel, boolean][]) {
      await client.query(`
        INSERT INTO user_notification_preferences (user_id, channel, enabled, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
      `, [userId, channel, enabled]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getNotificationPreferences(userId);
}

export async function listNotificationCampaigns() {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.channel, c.audience, c.title, c.body, c.status,
      c.scheduled_at AS "scheduledAt", c.sent_at AS "sentAt", c.created_at AS "createdAt",
      COUNT(n.id)::int AS recipients
    FROM notification_campaigns c
    LEFT JOIN user_notifications n ON n.campaign_id = c.id
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100
  `);
  return rows;
}

export async function createNotificationCampaign(input: {
  name: string;
  channel: NotificationChannel;
  audience: 'ALL' | 'FREE' | 'VIP';
  title: string;
  body: string;
  scheduledAt?: string;
}, adminUserId: string) {
  const { rows } = await pool.query(`
    INSERT INTO notification_campaigns (name, channel, audience, title, body, scheduled_at, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, name, channel, audience, title, body, status, scheduled_at AS "scheduledAt", created_at AS "createdAt"
  `, [input.name, input.channel, input.audience, input.title, input.body, input.scheduledAt ?? null, adminUserId]);
  return rows[0];
}

export async function sendNotificationCampaign(campaignId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      channel: NotificationChannel;
      audience: 'ALL' | 'FREE' | 'VIP';
      title: string;
      body: string;
      status: string;
      scheduled_at: Date | null;
    }>('SELECT id, channel, audience, title, body, status, scheduled_at FROM notification_campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    const campaign = rows[0];
    if (!campaign) throw httpError('Notification campaign not found.', 404);
    if (campaign.status !== 'DRAFT') throw httpError('Only draft notification campaigns can be sent.', 409);
    if (campaign.channel !== 'IN_APP') throw httpError(`${campaign.channel} delivery is not configured yet.`, 503);
    if (campaign.scheduled_at && campaign.scheduled_at > new Date()) {
      throw httpError('This campaign is scheduled for a later time and cannot be sent yet.', 409);
    }

    const result = await client.query(`
      INSERT INTO user_notifications (user_id, campaign_id, channel, title, body, status, sent_at)
      SELECT u.id, $1, 'IN_APP', left(replace($2, '{{name}}', u.name), 160),
        replace($3, '{{name}}', u.name), 'DELIVERED', now()
      FROM users u
      WHERE u.status = 'ACTIVE'
        AND ($4 = 'ALL'
          OR ($4 = 'VIP' AND (u.is_vip OR EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'ACTIVE'
              AND (s.renews_at IS NULL OR s.renews_at > now())
          )))
          OR ($4 = 'FREE' AND NOT (u.is_vip OR EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'ACTIVE'
              AND (s.renews_at IS NULL OR s.renews_at > now())
          ))))
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_preferences p
          WHERE p.user_id = u.id AND p.channel = 'IN_APP' AND NOT p.enabled
        )
      ON CONFLICT (campaign_id, user_id) DO NOTHING
    `, [campaign.id, campaign.title, campaign.body, campaign.audience]);
    await client.query("UPDATE notification_campaigns SET status = 'SENT', sent_at = now() WHERE id = $1", [campaign.id]);
    await client.query('COMMIT');
    return { id: campaign.id, recipients: result.rowCount ?? 0, status: 'SENT' as const };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listEngagementCodes() {
  const { rows } = await pool.query(`
    SELECT c.id, c.code, c.code_type AS "codeType", c.owner_id AS "ownerId",
      u.name AS "ownerName", c.reward_config AS "rewardConfig", c.max_redemptions AS "maxRedemptions",
      c.starts_at AS "startsAt", c.ends_at AS "endsAt", c.is_active AS "isActive",
      COUNT(r.id)::int AS redemptions, c.created_at AS "createdAt"
    FROM engagement_codes c
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN referrals r ON r.code_id = c.id
    GROUP BY c.id, u.name ORDER BY c.created_at DESC LIMIT 200
  `);
  return rows;
}

export async function createEngagementCode(input: {
  code?: string;
  codeType: Exclude<EngagementCodeType, 'REFERRAL'>;
  ownerId?: string;
  rewardConfig: Record<string, unknown>;
  maxRedemptions?: number;
  startsAt?: string;
  endsAt?: string;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = input.code?.trim().toUpperCase() ?? createCode(input.codeType.slice(0, 3));
    try {
      const { rows } = await pool.query(`
        INSERT INTO engagement_codes (code, code_type, owner_id, reward_config, max_redemptions, starts_at, ends_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, code, code_type AS "codeType", owner_id AS "ownerId",
          reward_config AS "rewardConfig", max_redemptions AS "maxRedemptions",
          starts_at AS "startsAt", ends_at AS "endsAt", is_active AS "isActive"
      `, [code, input.codeType, input.ownerId ?? null, input.rewardConfig, input.maxRedemptions ?? null, input.startsAt ?? null, input.endsAt ?? null]);
      return rows[0];
    } catch (error) {
      if (!input.code && (error as { code?: string; constraint?: string }).code === '23505'
        && (error as { constraint?: string }).constraint === 'engagement_codes_code_key') continue;
      throw error;
    }
  }
  throw new Error('Unable to create a unique engagement code after several attempts.');
}

export async function setEngagementCodeActive(codeId: string, isActive: boolean) {
  const { rowCount } = await pool.query(
    'UPDATE engagement_codes SET is_active = $1 WHERE id = $2',
    [isActive, codeId],
  );
  if (!rowCount) throw httpError('Engagement code not found.', 404);
  return { id: codeId, isActive };
}

export async function cancelNotificationCampaign(campaignId: string) {
  const { rowCount } = await pool.query(
    "UPDATE notification_campaigns SET status = 'CANCELLED' WHERE id = $1 AND status = 'DRAFT'",
    [campaignId],
  );
  if (!rowCount) throw httpError('Draft notification campaign not found.', 404);
  return { id: campaignId, status: 'CANCELLED' as const };
}
