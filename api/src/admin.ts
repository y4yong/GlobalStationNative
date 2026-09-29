import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';

interface AdminRequest extends Request { adminUserId?: string }
const contentStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const;
const payoutStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;
const campaignStatuses = ['ACTIVE', 'PAUSED', 'COMPLETED'] as const;
const supportStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const contentGenres = ['Action', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Horror', 'Romance', 'Science Fiction', 'Thriller'] as const;
const contentCategories = ['Documentary', 'Film', 'Malay Drama', 'Original Series', 'Korean Drama', 'Variety'] as const;
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
    pool.query(`SELECT COUNT(*)::int AS sessions, COALESCE(SUM(watch_seconds), 0)::int AS "watchSeconds", COUNT(DISTINCT user_id)::int AS "activeUsers" FROM watch_logs WHERE created_at >= now() - interval '30 days'`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active FROM ad_campaigns`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending, COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0)::float AS "pendingAmount" FROM payout_requests`),
  ]);
  return { dramas: dramas.rows[0], users: users.rows[0], watch: watch.rows[0], campaigns: campaigns.rows[0], payouts: payouts.rows[0] };
}

export async function adminContent(status?: string) {
  const values: string[] = []; const where = status && status !== 'ALL' ? `WHERE c.status = $1` : ''; if (where) values.push(status!);
  const { rows } = await pool.query(`SELECT c.id, c.title, c.content_type AS "contentType", c.description, c.poster_url AS "posterUrl", c.rating, c.genre, c.category, c.status, c.is_featured AS "isFeatured", c.is_exclusive_vip AS "isExclusiveVip", c.created_at AS "createdAt", COUNT(e.id)::int AS "episodeCount" FROM content c LEFT JOIN episodes e ON e.content_id = c.id ${where} GROUP BY c.id ORDER BY c.created_at DESC`, values);
  return rows;
}

export async function createContent(input: unknown, userId?: string) {
  const data = z.object({ title: z.string().min(2), contentType: z.enum(['MOVIE', 'SERIES']), description: z.string().min(10), posterUrl: z.string().refine((value) => value.startsWith('s3://') || value.startsWith('https://')), rating: z.enum(contentRatings), genre: z.enum(contentGenres), category: z.enum(contentCategories), isExclusiveVip: z.boolean().default(false), episodeTitle: z.string().min(1), durationSeconds: z.number().int().positive(), hlsManifestUrl: z.string().refine((value) => value.startsWith('s3://') || value.startsWith('https://')), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).parse(input);
  const client = await pool.connect();
  try { await client.query('BEGIN'); const origin = data.latitude !== undefined && data.longitude !== undefined ? `SRID=4326;POINT(${data.longitude} ${data.latitude})` : null; const content = await client.query<{ id: string }>('INSERT INTO content (title, content_type, description, poster_url, rating, genre, category, is_exclusive_vip, status, origin, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'APPROVED\',ST_GeogFromText($9),$10) RETURNING id', [data.title, data.contentType, data.description, data.posterUrl, data.rating, data.genre, data.category, data.isExclusiveVip, origin, userId ?? null]); await client.query('INSERT INTO episodes (content_id, episode_number, title, duration_seconds, hls_manifest_url, is_free_preview) VALUES ($1, 1, $2, $3, $4, true)', [content.rows[0].id, data.episodeTitle, data.durationSeconds, data.hlsManifestUrl]); await client.query('COMMIT'); await audit(userId, 'CONTENT_CREATED', 'CONTENT', content.rows[0].id, { contentType: data.contentType }); return { id: content.rows[0].id }; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
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
    await client.query("UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now() WHERE user_id = $1 AND status = 'ACTIVE'", [id]);
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
export async function adminCampaigns() { return (await pool.query('SELECT id, campaign_name AS "campaignName", creative_video_url AS "creativeVideoUrl", cpm_rate AS "cpmRate", total_budget AS "totalBudget", remaining_budget AS "remainingBudget", target_tier AS "targetTier", status, created_at AS "createdAt" FROM ad_campaigns ORDER BY created_at DESC LIMIT 200')).rows; }
export async function updateCampaignStatus(id: string, status: string, userId?: string) { const parsed = z.enum(campaignStatuses).parse(status); const result = await pool.query('UPDATE ad_campaigns SET status = $1 WHERE id = $2', [parsed, id]); if (!result.rowCount) throw Object.assign(new Error('Campaign not found'), { statusCode: 404 }); await audit(userId, `CAMPAIGN_${parsed}`, 'CAMPAIGN', id, { status: parsed }); return { id, status: parsed }; }
export async function adminTelemetry() { return (await pool.query(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS sessions, COALESCE(SUM(watch_seconds), 0)::int AS "watchSeconds", COUNT(DISTINCT user_id)::int AS viewers FROM watch_logs WHERE created_at >= now() - interval '14 days' GROUP BY created_at::date ORDER BY day`)).rows; }
export async function adminPayouts() { return (await pool.query('SELECT p.id, p.amount, p.status, p.requested_at AS "requestedAt", p.processed_at AS "processedAt", u.name AS "creatorName", u.email AS "creatorEmail" FROM payout_requests p JOIN users u ON u.id = p.creator_id ORDER BY p.requested_at DESC LIMIT 200')).rows; }
export async function updatePayoutStatus(id: string, status: string, userId?: string) { const parsed = z.enum(payoutStatuses).parse(status); const result = await pool.query('UPDATE payout_requests SET status = $1, processed_at = CASE WHEN $1 IN (\'APPROVED\',\'REJECTED\',\'PAID\') THEN now() ELSE NULL END, processed_by = $2 WHERE id = $3', [parsed, userId ?? null, id]); if (!result.rowCount) throw Object.assign(new Error('Payout not found'), { statusCode: 404 }); await audit(userId, `PAYOUT_${parsed}`, 'PAYOUT', id, { status: parsed }); return { id, status: parsed }; }
export async function adminSupportTickets() { return (await pool.query('SELECT t.id, t.subject, t.description, t.priority, t.status, t.created_at AS "createdAt", u.name AS "userName", u.email AS "userEmail" FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ORDER BY CASE WHEN t.status IN (\'OPEN\',\'IN_PROGRESS\') THEN 0 ELSE 1 END, t.created_at DESC LIMIT 200')).rows; }
export async function updateSupportTicketStatus(id: string, status: string, userId?: string) { const parsed = z.enum(supportStatuses).parse(status); const result = await pool.query('UPDATE support_tickets SET status = $1, resolved_at = CASE WHEN $1 IN (\'RESOLVED\',\'CLOSED\') THEN now() ELSE NULL END WHERE id = $2', [parsed, id]); if (!result.rowCount) throw Object.assign(new Error('Support ticket not found'), { statusCode: 404 }); await audit(userId, `SUPPORT_TICKET_${parsed}`, 'SUPPORT_TICKET', id, { status: parsed }); return { id, status: parsed }; }
