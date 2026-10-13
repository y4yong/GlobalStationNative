import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { contentCategories, contentGenres } from './contentOptions.js';
import { getAuthenticatedUser, hasRole, login, loginSchema, register, registerSchema, requireAuthenticated, upgradeRole } from './auth.js';
import { creatorOverview, requestCreatorPayout } from './creatorRepository.js';
import { deleteContentPermanently, setContentArchived } from './contentLifecycle.js';
import { listDramas } from './catalogRepository.js';
import { pool } from './db.js';
import { createAdminUpload, createAdvertiserUpload, createCreatorPosterUpload, createCreatorUpload, getMediaStorageDirectory, signPlaybackUrl, storeLocalUpload, verifyAdminUpload, verifyAdvertiserUpload, verifyCreatorPosterUpload, verifyCreatorUpload } from './mediaStorage.js';
import { createVipCheckout, currentSubscription, processBillplzCallback } from './billing.js';
import {
  adminCampaigns,
  adminContent,
  adminContentDetail,
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
app.use('/assets/ads', express.static(fileURLToPath(new URL('../assets/ads/', import.meta.url)), { maxAge: '1d' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'globalstation-api' });
});

if (config.MEDIA_STORAGE_DRIVER === 'local') {
  app.use('/uploads', (_request, response, next) => {
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(getMediaStorageDirectory()));
  app.put('/api/v1/media/local/:token', async (request, response, next) => {
    try {
      await storeLocalUpload(request.params.token, request, request.header('content-type') ?? '', request.header('content-length'));
      response.sendStatus(201);
    } catch (error) {
      next(error);
    }
  });
}

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

app.post('/api/v1/auth/upgrade-role', requireAuthenticated, async (request, response, next) => {
  try {
    const input = z.object({ role: z.enum(['CREATOR', 'ADVERTISER']) }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose a valid account role.' });
      return;
    }

    const user = getAuthenticatedUser(request);
    const result = await upgradeRole(user.id, input.data.role);
    if (!result) {
      response.status(409).json({ error: 'ROLE_UPDATE_FAILED', message: 'This account could not be upgraded right now.' });
      return;
    }

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/auth/me', requireAuthenticated, (request, response) => {
  response.json(getAuthenticatedUser(request));
});

app.get('/api/v1/creator/dashboard', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    response.json(await creatorOverview(user.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/creator/payout-requests', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({ amount: z.number().positive().max(1_000_000) }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Enter a valid payout amount.' });
      return;
    }
    response.status(201).json(await requestCreatorPayout(user.id, input.data.amount));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/creator/uploads', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
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

app.post('/api/v1/creator/uploads/poster', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({ contentType: z.string(), contentLength: z.number().int().positive() }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A supported poster type and positive file size are required.' });
      return;
    }
    response.status(201).json(await createCreatorPosterUpload(user.id, input.data.contentType, input.data.contentLength));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/creator/submissions', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
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

app.patch('/api/v1/creator/submissions/:id/archive', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({ archived: z.boolean() }).safeParse(request.body);
    const id = z.string().uuid().safeParse(request.params.id);
    if (!input.success || !id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A content ID and archive state are required.' });
      return;
    }
    response.json(await setContentArchived(id.data, input.data.archived, user.id));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/creator/submissions/:id', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const id = z.string().uuid().safeParse(request.params.id);
    const input = z.object({
      title: z.string().trim().min(2).max(255),
      description: z.string().trim().min(10).max(5000),
      rating: z.enum(['U', 'P12', 'P13', '16', '18']),
      genre: z.enum(contentGenres),
      category: z.enum(contentCategories),
      isExclusiveVip: z.boolean(),
      posterKey: z.string().min(1).optional(),
    }).safeParse(request.body);
    if (!id.success || !input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide valid content details and an optional uploaded poster.' });
      return;
    }
    const posterUrl = input.data.posterKey
      ? await verifyCreatorPosterUpload(user.id, input.data.posterKey)
      : undefined;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<{ id: string }>(
        'SELECT id FROM content WHERE id = $1 AND created_by = $2 AND is_archived = FALSE FOR UPDATE',
        [id.data, user.id],
      );
      if (!owned.rowCount) throw Object.assign(new Error('Content not found or archived.'), { statusCode: 404 });
      await client.query(`
        UPDATE content
        SET title = $1, description = $2, rating = $3, genre = $4, category = $5,
          is_exclusive_vip = $6, poster_url = COALESCE($7, poster_url),
          status = 'IN_REVIEW', updated_at = now()
        WHERE id = $8 AND created_by = $9
      `, [
        input.data.title, input.data.description, input.data.rating, input.data.genre,
        input.data.category, input.data.isExclusiveVip, posterUrl ?? null, id.data, user.id,
      ]);
      await client.query('COMMIT');
      response.json({ id: id.data, status: 'IN_REVIEW' });
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

app.post('/api/v1/creator/submissions/:id/episodes', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const id = z.string().uuid().safeParse(request.params.id);
    const input = z.object({
      title: z.string().trim().min(1).max(255),
      durationSeconds: z.number().int().positive(),
      mediaKey: z.string().min(1),
    }).safeParse(request.body);
    if (!id.success || !input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a valid episode title, duration, and uploaded MP4.' });
      return;
    }
    const mediaReference = await verifyCreatorUpload(user.id, input.data.mediaKey);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<{ content_type: string; is_archived: boolean }>(
        'SELECT content_type, is_archived FROM content WHERE id = $1 AND created_by = $2 FOR UPDATE',
        [id.data, user.id],
      );
      const content = owned.rows[0];
      if (!content) throw Object.assign(new Error('Content not found.'), { statusCode: 404 });
      if (content.is_archived) throw Object.assign(new Error('Restore this series before adding episodes.'), { statusCode: 409 });
      if (content.content_type !== 'SERIES') throw Object.assign(new Error('Episodes can only be added to a series.'), { statusCode: 400 });
      const numberResult = await client.query<{ nextEpisodeNumber: number }>(
        'SELECT COALESCE(MAX(episode_number), 0)::int + 1 AS "nextEpisodeNumber" FROM episodes WHERE content_id = $1',
        [id.data],
      );
      const episodeNumber = numberResult.rows[0].nextEpisodeNumber;
      await client.query(
        'INSERT INTO episodes (content_id, episode_number, title, duration_seconds, hls_manifest_url, is_free_preview) VALUES ($1,$2,$3,$4,$5,false)',
        [id.data, episodeNumber, input.data.title, input.data.durationSeconds, mediaReference],
      );
      await client.query("UPDATE content SET status = 'IN_REVIEW', updated_at = now() WHERE id = $1", [id.data]);
      await client.query('COMMIT');
      response.status(201).json({ id: id.data, episodeNumber, status: 'IN_REVIEW' });
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

app.delete('/api/v1/creator/submissions/:id', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'CREATOR')) {
      response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
      return;
    }
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid content ID is required.' });
      return;
    }
    response.json(await deleteContentPermanently(id.data, user.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/creator/submissions', requireAuthenticated, async (request, response, next) => {
  const user = getAuthenticatedUser(request);
  if (!hasRole(user, 'CREATOR')) {
    response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED' });
    return;
  }
  const input = z.object({
    title: z.string().trim().min(2).max(255),
    contentType: z.enum(['MOVIE', 'SERIES']),
    description: z.string().trim().min(10),
    posterKey: z.string().min(1),
    rating: z.enum(['U', 'P12', 'P13', '16', '18']),
    genre: z.enum(contentGenres),
    category: z.enum(contentCategories),
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
    const [posterUrl, mediaReference] = await Promise.all([
      verifyCreatorPosterUpload(user.id, input.data.posterKey),
      verifyCreatorUpload(user.id, input.data.mediaKey),
    ]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const content = await client.query<{ id: string }>(
        'INSERT INTO content (title, content_type, description, poster_url, rating, genre, category, is_exclusive_vip, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'IN_REVIEW\',$9) RETURNING id',
        [input.data.title, input.data.contentType, input.data.description, posterUrl, input.data.rating, input.data.genre, input.data.category, input.data.isExclusiveVip, user.id],
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
      WHERE e.id = $1 AND c.status = 'APPROVED' AND NOT c.is_archived AND u.status = 'ACTIVE'
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

app.post('/api/v1/streams/progress', requireAuthenticated, async (request, response, next) => {
  const input = z.object({
    episodeId: z.string().uuid(),
    sessionUid: z.string().trim().min(8).max(100),
    watchSeconds: z.number().int().min(1).max(60),
  }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Valid playback progress is required.' });
    return;
  }

  const user = getAuthenticatedUser(request);
  try {
    const { rows } = await pool.query(`
      SELECT e.id FROM episodes e
      JOIN content c ON c.id = e.content_id
      WHERE e.id = $1 AND c.status = 'APPROVED'
        AND (NOT (c.is_exclusive_vip OR NOT e.is_free_preview) OR $2::boolean)
    `, [input.data.episodeId, user.isVip]);
    if (!rows[0]) {
      response.status(404).json({ error: 'EPISODE_NOT_FOUND' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [input.data.sessionUid]);
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM watch_logs WHERE session_uid = $1 AND episode_id = $2 ORDER BY id LIMIT 1 FOR UPDATE',
        [input.data.sessionUid, input.data.episodeId],
      );
      if (existing.rows[0]) {
        await client.query('UPDATE watch_logs SET watch_seconds = watch_seconds + $1 WHERE id = $2', [input.data.watchSeconds, existing.rows[0].id]);
      } else {
        await client.query(
          'INSERT INTO watch_logs (user_id, episode_id, watch_seconds, device_ip, session_uid) VALUES ($1, $2, $3, $4, $5)',
          [user.id, input.data.episodeId, input.data.watchSeconds, request.ip ?? '127.0.0.1', input.data.sessionUid],
        );
      }
      await client.query('COMMIT');
      response.sendStatus(204);
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

app.post('/api/v1/advertiser/uploads', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'ADVERTISER')) {
      response.status(403).json({ error: 'ADVERTISER_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({ contentLength: z.number().int().positive() }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A positive MP4 file size is required.' });
      return;
    }
    response.status(201).json(await createAdvertiserUpload(user.id, input.data.contentLength));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/advertiser/campaigns', requireAuthenticated, async (request, response, next) => {
  try {
    const user = getAuthenticatedUser(request);
    if (!hasRole(user, 'ADVERTISER')) {
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
    if (!hasRole(user, 'ADVERTISER')) {
      response.status(403).json({ error: 'ADVERTISER_ACCESS_REQUIRED' });
      return;
    }
    const input = z.object({
      campaignName: z.string().trim().min(2).max(150),
      creativeKey: z.string().min(1).optional(),
      creativeVideoUrl: z.string().url().optional(),
      clickThroughUrl: z.string().url(),
      cpmRate: z.number().positive().max(10000),
      totalBudget: z.number().positive().max(10000000),
      targetTier: z.enum(['ALL', 'FREE']),
    }).refine(value => Boolean(value.creativeKey || value.creativeVideoUrl), { message: 'Upload an MP4 creative.' }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a campaign, uploaded MP4, click URL, CPM, budget, and audience.' });
      return;
    }
    if (!input.data.clickThroughUrl.startsWith('https://') || (input.data.creativeVideoUrl && !input.data.creativeVideoUrl.startsWith('https://'))) {
      response.status(400).json({ error: 'HTTPS_REQUIRED', message: 'Campaign click URLs and external creative URLs must use HTTPS.' });
      return;
    }
    const creativeVideoUrl = input.data.creativeKey
      ? await verifyAdvertiserUpload(user.id, input.data.creativeKey)
      : input.data.creativeVideoUrl!;
    const { rows } = await pool.query<{ id: string; status: string }>(`
      INSERT INTO ad_campaigns (advertiser_id, campaign_name, creative_video_url, click_through_url, cpm_rate, total_budget, remaining_budget, target_tier, status)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'PENDING_REVIEW')
      RETURNING id, status
    `, [user.id, input.data.campaignName, creativeVideoUrl, input.data.clickThroughUrl, input.data.cpmRate, input.data.totalBudget, input.data.targetTier]);
    response.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/ads/next', requireAuthenticated, async (request, response, next) => {
  const user = getAuthenticatedUser(request);
  if (user.isVip) {
    response.sendStatus(204);
    return;
  }
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
        AND c.target_tier IN ('ALL', 'FREE')
      ORDER BY c.created_at ASC
      LIMIT 1
      FOR UPDATE OF c SKIP LOCKED
    `);
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

app.patch('/api/v1/admin/content/:id/archive', async (request, response, next) => {
  try {
    const input = z.object({ archived: z.boolean() }).safeParse(request.body);
    const id = z.string().uuid().safeParse(request.params.id);
    if (!input.success || !id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A content ID and archive state are required.' });
      return;
    }
    response.json(await setContentArchived(id.data, input.data.archived, undefined, getAdminUserId(request)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/v1/admin/content/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid content ID is required.' });
      return;
    }
    response.json(await deleteContentPermanently(id.data, undefined, getAdminUserId(request)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/admin/content/:id', async (request, response, next) => {
  try { response.json(await adminContentDetail(request.params.id)); } catch (error) { next(error); }
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
