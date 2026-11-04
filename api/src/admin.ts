import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { signAdminPlaybackUrl } from './mediaStorage.js';
import { lookupViewerRegion } from './locationRegions.js';
import { contentCategories, contentGenreSchema } from './contentOptions.js';

interface AdminRequest extends Request { adminUserId?: string }
const contentStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const;
const payoutStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;
const campaignStatuses = ['PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'] as const;
const supportStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const contentRatings = ['U', 'P12', 'P13', '16', '18'] as const;
const subscriptionPlans = ['FREE', 'VIP_MONTHLY', 'VIP_YEARLY'] as const;

export function getAdminUserId(request: Request) { return (request as AdminRequest).adminUserId; }
export function requireAdmin(request: AdminRequest, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) { response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' }); return; }
  try { const payload = jwt.verify(token, config.JWT_SECRET) as { sub: string; role: string }; if (payload.role !== 'ADMIN') { response.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' }); return; } request.adminUserId = payload.sub; next(); } catch { response.status(401).json({ error: 'INVALID_TOKEN' }); }
}
async function audit(userId: string | undefined, action: string, entityType: string, entityId: string, metadata: unknown = null) { await pool.query('INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)', [userId ?? null, action, entityType, entityId, metadata]); }

export async function adminOverview() {
  const [dramas, users, watch, campaigns, payouts] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'IN_REVIEW')::int AS pending, COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS published FROM content`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE role = 'CREATOR')::int AS creators, COUNT(*) FILTER (WHERE role = 'ADVERTISER')::int AS advertisers FROM users`),
    pool.query(`SELECT COUNT(DISTINCT session_uid)::int AS sessions, COALESCE(SUM(watch_seconds), 0)::int AS "watchSeconds", COUNT(DISTINCT user_id)::int AS "activeUsers" FROM watch_logs WHERE created_at >= now() - interval '30 days'`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active FROM ad_campaigns`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending, COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0)::float AS "pendingAmount" FROM payout_requests`),
  ]);
  return { dramas: dramas.rows[0], users: users.rows[0], watch: watch.rows[0], campaigns: campaigns.rows[0], payouts: payouts.rows[0] };
}

export async function adminAnalytics() {
  const sharedCoordinates = await pool.query<{ latitude: number; longitude: number }>(`
    SELECT DISTINCT ROUND(latitude::numeric, 2)::float8 AS latitude,
      ROUND(longitude::numeric, 2)::float8 AS longitude
    FROM watch_logs
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND last_seen_at >= now() - interval '30 days'
  `);
  for (const row of sharedCoordinates.rows) {
    void lookupViewerRegion(row.latitude, row.longitude);
  }

  const [summary, daily, programmes, devices, geography, advertising, churn] = await Promise.all([
    pool.query(`
      WITH active AS (
        SELECT COUNT(DISTINCT user_id) FILTER (WHERE activity_date >= current_date)::int AS dau,
          COUNT(DISTINCT user_id) FILTER (WHERE activity_date >= current_date - interval '29 days')::int AS mau,
          COUNT(DISTINCT user_id)::int AS unique_viewers,
          COALESCE(SUM(watch_seconds), 0)::bigint AS watch_seconds
        FROM viewer_activity
        WHERE activity_date >= current_date - interval '29 days'
      ), sessions AS (
        SELECT user_id, session_uid, SUM(watch_seconds)::numeric AS seconds
        FROM viewer_activity WHERE activity_date >= current_date - interval '29 days'
        GROUP BY user_id, session_uid
      ), playback AS (
        SELECT COUNT(DISTINCT session_uid)::int AS playback_sessions,
          COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completions,
          COUNT(*) FILTER (WHERE duration_seconds > 0)::int AS measurable_sessions,
          COALESCE(AVG(last_position_seconds::numeric / NULLIF(duration_seconds, 0) * 100)
            FILTER (WHERE completed_at IS NULL AND duration_seconds > 0), 0)::numeric(6,2) AS average_dropoff_percent
        FROM watch_logs WHERE last_seen_at >= now() - interval '30 days'
      ), subscribers AS (
        SELECT COUNT(DISTINCT user_id)::int AS new_premium
        FROM subscriptions WHERE plan_code IN ('VIP_MONTHLY', 'VIP_YEARLY')
          AND started_at >= now() - interval '30 days'
      ), cohort_conversions AS (
        SELECT COUNT(DISTINCT s.user_id)::int AS total
        FROM subscriptions s JOIN users u ON u.id = s.user_id
        WHERE s.plan_code IN ('VIP_MONTHLY', 'VIP_YEARLY')
          AND s.started_at >= now() - interval '30 days'
          AND u.created_at >= now() - interval '30 days'
      ), new_accounts AS (
        SELECT COUNT(*)::int AS total
        FROM users WHERE created_at >= now() - interval '30 days'
      ), paid AS (
        SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS revenue,
          COUNT(DISTINCT user_id)::int AS paying_users
        FROM payment_transactions
        WHERE status = 'SUCCEEDED' AND currency = 'MYR' AND created_at >= now() - interval '30 days'
      ), ad_revenue AS (
        SELECT COALESCE(SUM(GREATEST(0.01, ROUND(c.cpm_rate / 10) / 100)), 0)::numeric(12,2) AS revenue
        FROM ad_impressions i JOIN ad_campaigns c ON c.id = i.campaign_id
        WHERE i.qualified_at IS NOT NULL AND i.qualified_at >= now() - interval '30 days'
      ), churn AS (
        SELECT COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'CANCELLED' AND s.cancelled_at >= now() - interval '30 days')::int AS cancelled,
          COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'ACTIVE' AND s.renews_at <= now()
            AND s.renews_at >= now() - interval '30 days')::int AS term_ended,
          COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'FAILED'
            AND p.created_at >= now() - interval '30 days')::int AS failed_payments
        FROM subscriptions s
        LEFT JOIN payment_transactions p ON p.subscription_id = s.id
      )
      SELECT active.dau, active.mau, active.unique_viewers AS "uniqueViewers",
        active.watch_seconds AS "watchSeconds", playback.playback_sessions AS "playbackSessions",
        CASE WHEN playback.playback_sessions = 0 THEN 0
          ELSE COALESCE(ROUND((SELECT AVG(seconds) FROM sessions)), 0)::int END AS "averageSessionSeconds",
        playback.completions,
        CASE WHEN playback.measurable_sessions = 0 THEN 0
          ELSE ROUND(playback.completions::numeric / playback.measurable_sessions * 100, 2) END AS "completionRate",
        playback.average_dropoff_percent AS "averageDropoffPercent",
        subscribers.new_premium AS "newPremiumSubscribers",
        new_accounts.total AS "newAccounts",
        CASE WHEN new_accounts.total = 0 THEN 0
            ELSE ROUND(cohort_conversions.total::numeric / new_accounts.total * 100, 2) END AS "freeToPremiumConversionRate",
        paid.revenue::text AS "subscriptionRevenue",
        ar.revenue::text AS "advertisingRevenue",
        (paid.revenue + ar.revenue)::text AS "totalRevenue",
        paid.paying_users AS "payingUsers",
        CASE WHEN paid.paying_users = 0 THEN 0 ELSE ROUND(paid.revenue / paid.paying_users, 2) END AS "arpu",
        CASE WHEN active.unique_viewers = 0 THEN 0
          ELSE ROUND((paid.revenue + ar.revenue) / active.unique_viewers, 2) END AS "revenuePerViewer",
        churn.cancelled, churn.term_ended AS "termEnded", churn.failed_payments AS "failedPayments",
        CASE WHEN (SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE' AND (renews_at IS NULL OR renews_at > now())) + churn.cancelled + churn.term_ended = 0 THEN 0
          ELSE ROUND((churn.cancelled + churn.term_ended)::numeric /
            ((SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE' AND (renews_at IS NULL OR renews_at > now())) + churn.cancelled + churn.term_ended) * 100, 2)
        END AS "churnRate"
      FROM active, playback, subscribers, cohort_conversions, new_accounts, paid, ad_revenue ar, churn
    `),
    pool.query(`
      SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        COUNT(DISTINCT activity.user_id)::int AS viewers,
        COALESCE(SUM(activity.watch_seconds), 0)::bigint AS "watchSeconds",
        COUNT(DISTINCT activity.session_uid)::int AS sessions
      FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') AS days(day)
      LEFT JOIN viewer_activity activity ON activity.activity_date = days.day
      GROUP BY days.day ORDER BY days.day
    `),
    pool.query(`
      SELECT c.id, c.title, COUNT(DISTINCT w.session_uid)::int AS sessions,
        COUNT(DISTINCT w.user_id)::int AS viewers, COALESCE(SUM(w.watch_seconds), 0)::bigint AS "watchSeconds",
        COUNT(*) FILTER (WHERE w.completed_at IS NOT NULL)::int AS completions,
        CASE WHEN COUNT(*) FILTER (WHERE w.duration_seconds > 0) = 0 THEN 0
          ELSE ROUND(COUNT(*) FILTER (WHERE w.completed_at IS NOT NULL)::numeric /
            COUNT(*) FILTER (WHERE w.duration_seconds > 0) * 100, 2) END AS "completionRate",
        COALESCE(ROUND(AVG(w.last_position_seconds::numeric / NULLIF(w.duration_seconds, 0) * 100)
          FILTER (WHERE w.completed_at IS NULL AND w.duration_seconds > 0), 2), 0) AS "dropoffPercent"
      FROM watch_logs w JOIN episodes e ON e.id = w.episode_id
      JOIN content c ON c.id = e.content_id
      WHERE w.last_seen_at >= now() - interval '30 days'
      GROUP BY c.id, c.title ORDER BY SUM(w.watch_seconds) DESC LIMIT 10
    `),
    pool.query(`
      SELECT COALESCE(device_type, 'unknown') AS device,
        COUNT(DISTINCT user_id)::int AS viewers,
        COUNT(DISTINCT session_uid)::int AS sessions,
        COALESCE(SUM(watch_seconds), 0)::bigint AS "watchSeconds"
      FROM viewer_activity WHERE activity_date >= current_date - interval '29 days'
      GROUP BY device_type ORDER BY viewers DESC
    `),
    pool.query(`
      SELECT COALESCE(
          NULLIF(CONCAT_WS(', ', regions.region_name, regions.country_name), ''),
          regions.country_name, watch.country_code,
          CASE WHEN watch.latitude IS NULL THEN NULL ELSE 'Resolving area' END
        ) AS country,
        ROUND(AVG(watch.latitude)::numeric, 2)::float8 AS latitude,
        ROUND(AVG(watch.longitude)::numeric, 2)::float8 AS longitude,
        COUNT(DISTINCT user_id)::int AS viewers,
        COUNT(DISTINCT session_uid)::int AS sessions
      FROM watch_logs watch
      LEFT JOIN viewer_location_regions regions
        ON regions.latitude = ROUND(watch.latitude::numeric, 2)
       AND regions.longitude = ROUND(watch.longitude::numeric, 2)
      WHERE watch.last_seen_at >= now() - interval '30 days'
        AND (watch.latitude IS NOT NULL OR watch.country_code IS NOT NULL)
      GROUP BY 1,
        CASE WHEN regions.region_name IS NULL THEN ROUND(watch.latitude::numeric, 2) END,
        CASE WHEN regions.region_name IS NULL THEN ROUND(watch.longitude::numeric, 2) END
      ORDER BY viewers DESC
    `),
    pool.query(`
      SELECT c.id, c.campaign_name AS "campaignName",
        COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL)::int AS impressions,
        COUNT(i.completed_at) FILTER (WHERE i.qualified_at IS NOT NULL)::int AS completions,
        COUNT(DISTINCT clicks.impression_id) FILTER (WHERE i.qualified_at IS NOT NULL)::int AS clicks,
        CASE WHEN COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL) = 0 THEN 0
          ELSE ROUND(COUNT(DISTINCT clicks.impression_id) FILTER (WHERE i.qualified_at IS NOT NULL)::numeric / COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL) * 100, 2) END AS "clickThroughRate",
        CASE WHEN COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL) = 0 THEN 0
          ELSE ROUND(COUNT(i.completed_at) FILTER (WHERE i.qualified_at IS NOT NULL)::numeric / COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL) * 100, 2) END AS "completionRate",
        COALESCE(SUM(GREATEST(0.01, ROUND(c.cpm_rate / 10) / 100)) FILTER (WHERE i.qualified_at IS NOT NULL), 0)::numeric(12,2)::text AS revenue
      FROM ad_campaigns c
      LEFT JOIN ad_impressions i ON i.campaign_id = c.id AND i.created_at >= now() - interval '30 days'
      LEFT JOIN ad_clicks clicks ON clicks.impression_id = i.id
      GROUP BY c.id, c.campaign_name ORDER BY COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL) DESC LIMIT 20
    `),
    pool.query(`
      SELECT u.id AS "userId", u.name, u.email, s.plan_code AS "planCode",
        CASE
          WHEN s.status = 'CANCELLED' THEN COALESCE(s.end_reason, 'CANCELLED')
          WHEN s.status = 'ACTIVE' AND s.renews_at <= now() THEN 'TERM_ENDED'
          ELSE COALESCE(p.failure_reason, 'PAYMENT_FAILED')
        END AS reason,
        GREATEST(COALESCE(s.cancelled_at, s.renews_at, p.created_at), p.created_at) AS "occurredAt"
      FROM subscriptions s JOIN users u ON u.id = s.user_id
      LEFT JOIN LATERAL (
        SELECT failure_reason, created_at FROM payment_transactions
        WHERE subscription_id = s.id AND status = 'FAILED'
        ORDER BY created_at DESC LIMIT 1
      ) p ON TRUE
      WHERE (s.status = 'CANCELLED' AND s.cancelled_at >= now() - interval '30 days')
        OR (s.status = 'ACTIVE' AND s.renews_at <= now() AND s.renews_at >= now() - interval '30 days')
        OR p.created_at >= now() - interval '30 days'
      ORDER BY "occurredAt" DESC LIMIT 100
    `),
  ]);
  return {
    summary: summary.rows[0],
    daily: daily.rows,
    programmes: programmes.rows,
    devices: devices.rows,
    geography: geography.rows,
    advertising: advertising.rows,
    churn: churn.rows,
  };
}

export async function adminContent(status?: string) {
  const values: string[] = [];
  let where = '';
  if (status === 'ARCHIVED') where = 'WHERE c.is_archived = TRUE';
  else if (status && status !== 'ALL') { where = 'WHERE c.status = $1 AND c.is_archived = FALSE'; values.push(status); }
  const { rows } = await pool.query(`SELECT c.id, c.title, c.content_type AS "contentType", c.description, c.rating, c.genre, c.category, c.status, c.is_archived AS "isArchived", c.is_featured AS "isFeatured", c.is_exclusive_vip AS "isExclusiveVip", c.created_at AS "createdAt", u.name AS "creatorName", u.email AS "creatorEmail", COUNT(e.id)::int AS "episodeCount" FROM content c LEFT JOIN episodes e ON e.content_id = c.id LEFT JOIN users u ON u.id = c.created_by ${where} GROUP BY c.id, u.id ORDER BY c.created_at DESC`, values);
  return rows;
}

export async function adminContentDetail(id: string) {
  const { rows } = await pool.query(`
    SELECT c.id, c.title, c.content_type AS "contentType", c.description,
      c.poster_url AS "posterReference", c.poster_horizontal_url AS "posterHorizontalReference",
      c.rating, c.genre, c.category,
      c.status, c.is_featured AS "isFeatured", c.is_exclusive_vip AS "isExclusiveVip",
      c.is_archived AS "isArchived",
      c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      u.id AS "creatorId", u.name AS "creatorName", u.email AS "creatorEmail",
      COALESCE(json_agg(json_build_object(
        'id', e.id, 'episodeNumber', e.episode_number, 'title', e.title,
        'durationSeconds', e.duration_seconds, 'mediaReference', e.hls_manifest_url,
        'isFreePreview', e.is_free_preview
      ) ORDER BY e.episode_number) FILTER (WHERE e.id IS NOT NULL), '[]') AS episodes
    FROM content c
    LEFT JOIN users u ON u.id = c.created_by
    LEFT JOIN episodes e ON e.content_id = c.id
    WHERE c.id = $1
    GROUP BY c.id, u.id
  `, [id]);
  const content = rows[0];
  if (!content) throw Object.assign(new Error('Content not found.'), { statusCode: 404 });
  return {
    ...content,
    posterUrl: content.posterReference ? signAdminPlaybackUrl(content.posterReference) : null,
    posterHorizontalUrl: content.posterHorizontalReference ? signAdminPlaybackUrl(content.posterHorizontalReference) : null,
    episodes: content.episodes.map((episode: { mediaReference: string; [key: string]: unknown }) => ({
      ...episode,
      mediaUrl: signAdminPlaybackUrl(episode.mediaReference),
      mediaReference: undefined,
    })),
  };
}

export async function createContent(input: unknown, userId?: string) {
  const isAllowedMediaReference = (value: string) => value.startsWith('s3://') || value.startsWith('https://') || (config.MEDIA_STORAGE_DRIVER === 'local' && value.startsWith('http://'));
  const data = z.object({ title: z.string().min(2), contentType: z.enum(['MOVIE', 'SERIES']), description: z.string().min(10), posterUrl: z.string().refine(isAllowedMediaReference), posterHorizontalUrl: z.string().refine(isAllowedMediaReference).optional(), rating: z.enum(contentRatings), genre: contentGenreSchema, category: z.enum(contentCategories), isExclusiveVip: z.boolean().default(false), episodeTitle: z.string().min(1), durationSeconds: z.number().int().positive(), hlsManifestUrl: z.string().refine(isAllowedMediaReference), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).parse(input);
  const client = await pool.connect();
  try { await client.query('BEGIN'); const origin = data.latitude !== undefined && data.longitude !== undefined ? `SRID=4326;POINT(${data.longitude} ${data.latitude})` : null; const content = await client.query<{ id: string }>('INSERT INTO content (title, content_type, description, poster_url, poster_horizontal_url, rating, genre, category, is_exclusive_vip, status, origin, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'APPROVED\',ST_GeogFromText($10),$11) RETURNING id', [data.title, data.contentType, data.description, data.posterUrl, data.posterHorizontalUrl ?? null, data.rating, data.genre, data.category, data.isExclusiveVip, origin, userId ?? null]); await client.query('INSERT INTO episodes (content_id, episode_number, title, duration_seconds, hls_manifest_url, is_free_preview) VALUES ($1, 1, $2, $3, $4, true)', [content.rows[0].id, data.episodeTitle, data.durationSeconds, data.hlsManifestUrl]); await client.query('COMMIT'); await audit(userId, 'CONTENT_CREATED', 'CONTENT', content.rows[0].id, { contentType: data.contentType }); return { id: content.rows[0].id }; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function updateContentStatus(id: string, status: string, userId?: string) { const parsed = z.enum(contentStatuses).parse(status); const result = await pool.query('UPDATE content SET status = $1, updated_at = now() WHERE id = $2', [parsed, id]); if (!result.rowCount) throw Object.assign(new Error('Content not found'), { statusCode: 404 }); await audit(userId, `CONTENT_${parsed}`, 'CONTENT', id, { status: parsed }); return { id, status: parsed }; }
export async function adminUsers(filters: { search?: string; role?: string; plan?: string; status?: string } = {}) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    clauses.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  if (filters.role && filters.role !== 'ALL') {
    values.push(z.enum(['VIEWER', 'CREATOR', 'ADVERTISER', 'ADMIN']).parse(filters.role));
    clauses.push(`u.role = $${values.length}`);
  }
  if (filters.status && filters.status !== 'ALL') {
    values.push(z.enum(['ACTIVE', 'SUSPENDED']).parse(filters.status));
    clauses.push(`u.status = $${values.length}`);
  }
  if (filters.plan && filters.plan !== 'ALL') {
    values.push(z.enum(subscriptionPlans).parse(filters.plan));
    clauses.push(`COALESCE(current_subscription.plan_code, CASE WHEN u.is_vip THEN 'VIP_MONTHLY' ELSE 'FREE' END) = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.status, u.created_at AS "createdAt",
      (u.is_vip OR current_subscription.status = 'ACTIVE') AS "isVip",
      COALESCE(current_subscription.plan_code, CASE WHEN u.is_vip THEN 'VIP_MONTHLY' ELSE 'FREE' END) AS "planCode",
      current_subscription.renews_at AS "renewsAt"
    FROM users u
    LEFT JOIN LATERAL (
      SELECT s.plan_code, s.status, s.renews_at
      FROM subscriptions s
      WHERE s.user_id = u.id AND s.status = 'ACTIVE' AND (s.renews_at IS NULL OR s.renews_at > now())
      ORDER BY s.started_at DESC LIMIT 1
    ) current_subscription ON TRUE
    ${where}
    ORDER BY u.created_at DESC
    LIMIT 200
  `, values);
  return rows;
}

export async function adminSetUserPlan(id: string, plan: string, confirmation: string, adminUserId?: string) {
  const parsedPlan = z.enum(subscriptionPlans).parse(plan);
  if (parsedPlan === 'FREE' && confirmation !== 'REVOKEPLAN') {
    throw Object.assign(new Error('Type REVOKEPLAN to confirm VIP entitlement revocation.'), { statusCode: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query<{ id: string }>('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!user.rowCount) throw Object.assign(new Error('User not found.'), { statusCode: 404 });
    await client.query("UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now(), end_reason = 'ADMIN_REVOKED' WHERE user_id = $1 AND status = 'ACTIVE'", [id]);
    await client.query('UPDATE users SET is_vip = FALSE, updated_at = now() WHERE id = $1', [id]);
    if (parsedPlan !== 'FREE') {
      const interval = parsedPlan === 'VIP_YEARLY' ? '1 year' : '1 month';
      await client.query("INSERT INTO subscriptions (user_id, plan_code, status, started_at, renews_at) VALUES ($1,$2,'ACTIVE',now(),now() + $3::interval)", [id, parsedPlan, interval]);
    }
    await audit(adminUserId, parsedPlan === 'FREE' ? 'USER_PLAN_REVOKED' : 'USER_PLAN_CHANGED', 'USER', id, { plan: parsedPlan });
    await client.query('COMMIT');
    return { id, planCode: parsedPlan, isVip: parsedPlan !== 'FREE' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function adminCampaigns() {
  const { rows } = await pool.query<{
    id: string;
    campaignName: string;
    creativeVideoUrl: string;
    clickThroughUrl: string | null;
    cpmRate: string;
    totalBudget: string;
    remainingBudget: string;
    targetTier: string;
    status: string;
    createdAt: Date;
  }>('SELECT id, campaign_name AS "campaignName", creative_video_url AS "creativeVideoUrl", click_through_url AS "clickThroughUrl", cpm_rate AS "cpmRate", total_budget AS "totalBudget", remaining_budget AS "remainingBudget", target_tier AS "targetTier", status, created_at AS "createdAt" FROM ad_campaigns ORDER BY created_at DESC LIMIT 200');
  return rows.map(campaign => ({
    ...campaign,
    creativeVideoUrl: signAdminPlaybackUrl(campaign.creativeVideoUrl),
  }));
}
export async function updateCampaignStatus(id: string, status: string, userId?: string) {
  const parsed = z.enum(campaignStatuses).parse(status);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: typeof campaignStatuses[number] }>(
      'SELECT status FROM ad_campaigns WHERE id = $1 FOR UPDATE',
      [id],
    );
    const currentStatus = rows[0]?.status;
    if (!currentStatus) throw Object.assign(new Error('Campaign not found'), { statusCode: 404 });
    const allowedTransitions: Record<typeof campaignStatuses[number], readonly string[]> = {
      PENDING_REVIEW: ['ACTIVE', 'REJECTED'],
      ACTIVE: ['PAUSED', 'COMPLETED'],
      PAUSED: ['ACTIVE'],
      REJECTED: [],
      COMPLETED: [],
    };
    if (!allowedTransitions[currentStatus].includes(parsed)) {
      throw Object.assign(new Error(`Campaign cannot move from ${currentStatus} to ${parsed}.`), { statusCode: 409 });
    }
    await client.query('UPDATE ad_campaigns SET status = $1 WHERE id = $2', [parsed, id]);
    await audit(userId, `CAMPAIGN_${parsed}`, 'CAMPAIGN', id, { previousStatus: currentStatus, status: parsed });
    await client.query('COMMIT');
    return { id, status: parsed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function adminTelemetry() { return (await pool.query(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(DISTINCT session_uid)::int AS sessions, COALESCE(SUM(watch_seconds), 0)::int AS "watchSeconds", COUNT(DISTINCT user_id)::int AS viewers FROM watch_logs WHERE created_at >= now() - interval '14 days' GROUP BY created_at::date ORDER BY day`)).rows; }
export async function adminPayouts() { return (await pool.query('SELECT p.id, p.amount, p.status, p.requested_at AS "requestedAt", p.processed_at AS "processedAt", u.name AS "creatorName", u.email AS "creatorEmail" FROM payout_requests p JOIN users u ON u.id = p.creator_id ORDER BY p.requested_at DESC LIMIT 200')).rows; }
export async function updatePayoutStatus(id: string, status: string, userId?: string) { const parsed = z.enum(payoutStatuses).parse(status); const result = await pool.query('UPDATE payout_requests SET status = $1, processed_at = CASE WHEN $1 IN (\'APPROVED\',\'REJECTED\',\'PAID\') THEN now() ELSE NULL END, processed_by = $2 WHERE id = $3', [parsed, userId ?? null, id]); if (!result.rowCount) throw Object.assign(new Error('Payout not found'), { statusCode: 404 }); await audit(userId, `PAYOUT_${parsed}`, 'PAYOUT', id, { status: parsed }); return { id, status: parsed }; }
export async function adminSupportTickets() { return (await pool.query('SELECT t.id, t.subject, t.description, t.priority, t.status, t.created_at AS "createdAt", u.name AS "userName", u.email AS "userEmail" FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ORDER BY CASE WHEN t.status IN (\'OPEN\',\'IN_PROGRESS\') THEN 0 ELSE 1 END, t.created_at DESC LIMIT 200')).rows; }
export async function updateSupportTicketStatus(id: string, status: string, userId?: string) { const parsed = z.enum(supportStatuses).parse(status); const result = await pool.query('UPDATE support_tickets SET status = $1, resolved_at = CASE WHEN $1 IN (\'RESOLVED\',\'CLOSED\') THEN now() ELSE NULL END WHERE id = $2', [parsed, id]); if (!result.rowCount) throw Object.assign(new Error('Support ticket not found'), { statusCode: 404 }); await audit(userId, `SUPPORT_TICKET_${parsed}`, 'SUPPORT_TICKET', id, { status: parsed }); return { id, status: parsed }; }
