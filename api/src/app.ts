import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { config } from './config.js';
import { getAuthenticatedUser, login, loginSchema, register, registerSchema, requireAuthenticated } from './auth.js';
import { listDramas } from './catalogRepository.js';
import { pool } from './db.js';
import { createAdminUpload, createCreatorUpload, signPlaybackUrl, verifyAdminUpload, verifyCreatorUpload } from './mediaStorage.js';
import { createVipCheckout, currentSubscription, processBillplzCallback } from './billing.js';
import {
  adminCampaigns,
  adminContent,
  createContent,
  adminOverview,
  adminPayouts,
  adminSupportTickets,
  adminTelemetry,
  adminUsers,
  adminSetUserPlan,
  getAdminUserId,
  requireAdmin,
  updateCampaignStatus,
  updateContentStatus,
  updatePayoutStatus,
  updateSupportTicketStatus,
} from './admin.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'globalstation-api' });
});

app.get('/api/v1/dramas', async (_request, response, next) => {
  try {
    response.json(await listDramas());
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/login', async (request, response, next) => {
  try {
    const input = loginSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid email and password are required.' });
      return;
    }
    const result = await login(input.data.email, input.data.password);
    if (!result) {
      response.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      return;
    }
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/register', async (request, response, next) => {
  try {
    const input = registerSchema.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A name, valid email, and password of at least 8 characters are required.' });
      return;
    }
    const result = await register(input.data.name, input.data.email, input.data.password);
    if (!result) {
      response.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email.' });
      return;
    }
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/auth/me', requireAuthenticated, (request, response) => {
  response.json(getAuthenticatedUser(request));
});

app.post('/api/v1/creator/uploads', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (user.role !== 'CREATOR') {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({ contentLength: z.number().int().positive().max(config.MEDIA_UPLOAD_MAX_BYTES) }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A positive video file size within the configured limit is required.' });
      return;
    }
    response.status(201).json(await createCreatorUpload(user.id, input.data.contentLength));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/creator/submissions', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (user.role !== 'CREATOR') {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const { rows } = await pool.query(`
      SELECT c.id, c.title, c.status, c.created_at AS "createdAt", COUNT(e.id)::int AS "episodeCount"
      FROM content c LEFT JOIN episodes e ON e.content_id = c.id
      WHERE c.created_by = $1
      GROUP BY c.id ORDER BY c.created_at DESC
      LIMIT 100
    `, [user.id]);
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/creator/submissions', requireAuthenticated, async (request, response, next) => {
  const user = getAuthenticatedUser(request);
  if (user.role !== 'CREATOR') {
    response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
    return;
  }
  const input = z.object({
    title: z.string().trim().min(2).max(255),
    contentType: z.enum(['MOVIE', 'SERIES']),
    description: z.string().trim().min(10),
    posterUrl: z.string().url(),
    rating: z.string().min(1).max(20),
    genre: z.string().min(1).max(100),
    category: z.string().min(1).max(100),
    episodeTitle: z.string().trim().min(1).max(255),
    durationSeconds: z.number().int().positive(),
    mediaKey: z.string().min(1),
    isExclusiveVip: z.boolean().default(false),
  }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Complete content details and an uploaded MP4 are required.' });
    return;
  }
  try {
    const mediaReference = await verifyCreatorUpload(user.id, input.data.mediaKey);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const content = await client.query<{ id: string }>(
        'INSERT INTO content (title, content_type, description, poster_url, rating, genre, category, is_exclusive_vip, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'IN_REVIEW\',$9) RETURNING id',
        [input.data.title, input.data.contentType, input.data.description, input.data.posterUrl, input.data.rating, input.data.genre, input.data.category, input.data.isExclusiveVip, user.id],
      );
      await client.query(
        'INSERT INTO episodes (content_id, episode_number, title, duration_seconds, hls_manifest_url, is_free_preview) VALUES ($1,1,$2,$3,$4,true)',
        [content.rows[0].id, input.data.episodeTitle, input.data.durationSeconds, mediaReference],
      );
      await client.query('COMMIT');
      response.status(201).json({ id: content.rows[0].id, status: 'IN_REVIEW' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/streams/access', requireAuthenticated, async (request, response, next) => {
  try {
    const input = z.object({ episodeId: z.string().uuid() }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid episodeId is required.' });
      return;
    }

    const user = getAuthenticatedUser(request);
    const { rows } = await pool.query<{
      hls_manifest_url: string;
      is_free_preview: boolean;
      is_exclusive_vip: boolean;
      has_active_vip: boolean;
    }>(`
      SELECT e.hls_manifest_url, e.is_free_preview, c.is_exclusive_vip,
        (u.is_vip OR EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.user_id = u.id AND s.status = 'ACTIVE'
            AND (s.renews_at IS NULL OR s.renews_at > now())
        )) AS has_active_vip
      FROM episodes e
      JOIN content c ON c.id = e.content_id
      JOIN users u ON u.id = $2
      WHERE e.id = $1 AND c.status = 'APPROVED' AND u.status = 'ACTIVE'
    `, [input.data.episodeId, user.id]);
    const episode = rows[0];
    if (!episode) {
      response.status(404).json({ error: 'EPISODE_NOT_FOUND' });
      return;
    }
    if ((episode.is_exclusive_vip || !episode.is_free_preview) && !episode.has_active_vip) {
      response.status(403).json({ error: 'VIP_REQUIRED', message: 'An active VIP membership is required to play this episode.' });
      return;
    }

    response.json({ manifestUrl: signPlaybackUrl(episode.hls_manifest_url) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/subscriptions/current', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await currentSubscription(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/subscriptions/checkout', requireAuthenticated, async (request, response, next) => {
  try {
    const input = z.object({ plan: z.enum(['VIP_MONTHLY', 'VIP_YEARLY']) }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose a supported VIP plan.' });
      return;
    }
    response.status(201).json(await createVipCheckout(getAuthenticatedUser(request), input.data.plan));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/payments/billplz/callback', async (request, response, next) => {
  try {
    await processBillplzCallback(request.body as Record<string, unknown>);
    response.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/payments/billplz/return', (_request, response) => {
  response.type('text/plain').send('Payment status is verified by Billplz callback. You may return to Global Station.');
});

app.get('/api/v1/support/tickets', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    const { rows } = await pool.query(`
      SELECT id, subject, description, priority, status, created_at AS "createdAt"
      FROM support_tickets
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [user.id]);
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/support/tickets', requireAuthenticated, async (request, response, next) => {
  try {
    const input = z.object({
      subject: z.string().trim().min(3).max(200),
      description: z.string().trim().min(10).max(5000),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a subject and a message of at least 10 characters.' });
      return;
    }
    const user = getAuthenticatedUser(request);
    const { rows } = await pool.query<{ id: string; status: string }>(
      'INSERT INTO support_tickets (user_id, subject, description, priority) VALUES ($1,$2,$3,$4) RETURNING id, status',
      [user.id, input.data.subject, input.data.description, input.data.priority],
    );
    response.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/advertiser/campaigns', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (user.role !== 'ADVERTISER') {
      response.status(403).json({ error: 'ADVERTISER_ACCESS_REQUIRED' });
      return;
    }
    const { rows } = await pool.query(`
      SELECT c.id, c.campaign_name AS "campaignName", c.creative_video_url AS "creativeVideoUrl",
        c.click_through_url AS "clickThroughUrl", c.cpm_rate AS "cpmRate", c.total_budget AS "totalBudget",
        c.remaining_budget AS "remainingBudget", c.target_tier AS "targetTier", c.status,
        c.created_at AS "createdAt", COUNT(i.id)::int AS impressions
      FROM ad_campaigns c LEFT JOIN ad_impressions i ON i.campaign_id = c.id
      WHERE c.advertiser_id = $1
      GROUP BY c.id ORDER BY c.created_at DESC
    `, [user.id]);
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/advertiser/campaigns', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (user.role !== 'ADVERTISER') {
      response.status(403).json({ error: 'ADVERTISER_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({
      campaignName: z.string().trim().min(2).max(150),
      creativeVideoUrl: z.string().url(),
      clickThroughUrl: z.string().url(),
      cpmRate: z.number().positive().max(10000),
      totalBudget: z.number().positive().max(10000000),
      targetTier: z.enum(['ALL', 'FREE', 'VIP']),
    }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a campaign name, HTTPS creative and click URL, CPM, budget, and audience.' });
      return;
    }
    if (![input.data.creativeVideoUrl, input.data.clickThroughUrl].every((value) => value.startsWith('https://'))) {
      response.status(400).json({ error: 'HTTPS_REQUIRED', message: 'Campaign media and click URLs must use HTTPS.' });
      return;
    }
    const { rows } = await pool.query<{ id: string; status: string }>(`
      INSERT INTO ad_campaigns (advertiser_id, campaign_name, creative_video_url, click_through_url, cpm_rate, total_budget, remaining_budget, target_tier, status)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'PAUSED')
      RETURNING id, status
    `, [user.id, input.data.campaignName, input.data.creativeVideoUrl, input.data.clickThroughUrl, input.data.cpmRate, input.data.totalBudget, input.data.targetTier]);
    response.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/ads/next', requireAuthenticated, async (request, response, next) => {
  const user = getAuthenticatedUser(request);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      campaign_name: string;
      creative_video_url: string;
      click_through_url: string | null;
      cpm_rate: string;
    }>(`
      SELECT c.id, c.campaign_name, c.creative_video_url, c.click_through_url, c.cpm_rate::text
      FROM ad_campaigns c
      WHERE c.status = 'ACTIVE'
        AND c.remaining_budget >= GREATEST(0.01, ROUND(c.cpm_rate / 1000, 2))
        AND (c.target_tier = 'ALL' OR (c.target_tier = 'VIP' AND $1) OR (c.target_tier = 'FREE' AND NOT $1))
      ORDER BY c.created_at ASC
      LIMIT 1
      FOR UPDATE OF c SKIP LOCKED
    `, [user.isVip]);
    const campaign = rows[0];
    if (!campaign) {
      await client.query('COMMIT');
      response.sendStatus(204);
      return;
    }

    const creativeVideoUrl = signPlaybackUrl(campaign.creative_video_url);
    const cost = Math.max(0.01, Math.round(Number(campaign.cpm_rate) / 10) / 100);
    const address = request.ip ?? request.socket.remoteAddress ?? '127.0.0.1';
    await client.query('INSERT INTO ad_impressions (campaign_id, user_id, device_ip) VALUES ($1,$2,$3)', [campaign.id, user.id, address]);
    await client.query(`
      UPDATE ad_campaigns
      SET remaining_budget = GREATEST(0, remaining_budget - $1),
          status = CASE WHEN remaining_budget <= $1 THEN 'COMPLETED' ELSE status END
      WHERE id = $2
    `, [cost, campaign.id]);
    await client.query('COMMIT');
    response.json({
      id: campaign.id,
      title: campaign.campaign_name,
      creativeVideoUrl,
      clickThroughUrl: campaign.click_through_url,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

app.use('/api/v1/admin', requireAdmin);

app.get('/api/v1/admin/overview', async (_request, response, next) => {
  try { response.json(await adminOverview()); } catch (error) { next(error); }
});

app.get('/api/v1/admin/content', async (request, response, next) => {
  try { response.json(await adminContent(typeof request.query.status === 'string' ? request.query.status : undefined)); } catch (error) { next(error); }
});

app.post('/api/v1/admin/media/uploads', async (request, response, next) => {
  try {
    const input = z.object({
      purpose: z.enum(['poster', 'media']),
      contentType: z.string(),
      contentLength: z.number().int().positive(),
    }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A media purpose, supported content type, and positive file size are required.' });
      return;
    }
    response.status(201).json(await createAdminUpload(getAdminUserId(request)!, input.data.purpose, input.data.contentType, input.data.contentLength));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/content', async (request, response, next) => {
  try {
    const userId = getAdminUserId(request)!;
    const input = z.object({ posterKey: z.string().min(1), mediaKey: z.string().min(1) }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Upload a supported poster image and MP4 media file first.' });
      return;
    }
    const [posterUrl, hlsManifestUrl] = await Promise.all([
      verifyAdminUpload(userId, 'poster', input.data.posterKey),
      verifyAdminUpload(userId, 'media', input.data.mediaKey),
    ]);
    response.status(201).json(await createContent({ ...request.body, posterUrl, hlsManifestUrl }, userId));
  } catch (error) { next(error); }
});

app.patch('/api/v1/admin/content/:id/status', async (request, response, next) => {
  try { response.json(await updateContentStatus(request.params.id, request.body.status, getAdminUserId(request))); } catch (error) { next(error); }
});

app.get('/api/v1/admin/users', async (request, response, next) => {
  try {
    const stringQuery = (key: string) => typeof request.query[key] === 'string' ? request.query[key] as string : undefined;
    response.json(await adminUsers({ search: stringQuery('search'), role: stringQuery('role'), plan: stringQuery('plan'), status: stringQuery('status') }));
  } catch (error) { next(error); }
});

app.patch('/api/v1/admin/users/:id/plan', async (request, response, next) => {
  try {
    const input = z.object({ plan: z.enum(['FREE', 'VIP_MONTHLY', 'VIP_YEARLY']), confirmation: z.string().optional().default('') }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Select a valid plan.' });
      return;
    }
    response.json(await adminSetUserPlan(request.params.id, input.data.plan, input.data.confirmation, getAdminUserId(request)));
  } catch (error) { next(error); }
});

app.get('/api/v1/admin/campaigns', async (_request, response, next) => {
  try { response.json(await adminCampaigns()); } catch (error) { next(error); }
});

app.patch('/api/v1/admin/campaigns/:id/status', async (request, response, next) => {
  try { response.json(await updateCampaignStatus(request.params.id, request.body.status, getAdminUserId(request))); } catch (error) { next(error); }
});

app.get('/api/v1/admin/telemetry', async (_request, response, next) => {
  try { response.json(await adminTelemetry()); } catch (error) { next(error); }
});

app.get('/api/v1/admin/payouts', async (_request, response, next) => {
  try { response.json(await adminPayouts()); } catch (error) { next(error); }
});

app.patch('/api/v1/admin/payouts/:id/status', async (request, response, next) => {
  try { response.json(await updatePayoutStatus(request.params.id, request.body.status, getAdminUserId(request))); } catch (error) { next(error); }
});

app.get('/api/v1/admin/support', async (_request, response, next) => {
  try { response.json(await adminSupportTickets()); } catch (error) { next(error); }
});

app.patch('/api/v1/admin/support/:id/status', async (request, response, next) => {
  try { response.json(await updateSupportTicketStatus(request.params.id, request.body.status, getAdminUserId(request))); } catch (error) { next(error); }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  response.status(statusCode).json({ error: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED', message: error instanceof Error ? error.message : 'An unexpected server error occurred.' });
});
