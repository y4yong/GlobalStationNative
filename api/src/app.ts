import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { contentCategories, contentGenreSchema } from './contentOptions.js';
import { getAuthenticatedUser, hasRole, login, loginSchema, register, registerSchema, requireAuthenticated, upgradeRole } from './auth.js';
import { creatorOverview, requestCreatorPayout } from './creatorRepository.js';
import { deleteContentPermanently, setContentArchived } from './contentLifecycle.js';
import { listContinueWatching, listDramas } from './catalogRepository.js';
import { pool } from './db.js';
import { lookupViewerRegion } from './locationRegions.js';
import { createAdminUpload, createAdvertiserUpload, createCreatorPosterUpload, createCreatorUpload, getMediaStorageDirectory, signPlaybackUrl, storeLocalUpload, verifyAdminUpload, verifyAdvertiserUpload, verifyCreatorPosterUpload, verifyCreatorUpload } from './mediaStorage.js';
import { createVipCheckout, currentSubscription, processStripeWebhook } from './billing.js';
import {
  createIndustryConnection,
  createMarketplaceInterest,
  createMarketplaceProject,
  getIndustryProfile,
  listIndustryConnections,
  listIndustryPeople,
  listMarketplaceInterests,
  listMarketplaceProjects,
  respondToIndustryConnection,
  saveIndustryProfile,
  updateMarketplaceInterest,
} from './industryMarketplace.js';
import { generateStoryIdea } from './storyGeneration.js';
import {
  createEngagementCode,
  createNotificationCampaign,
  cancelNotificationCampaign,
  getNotificationPreferences,
  getReferralOverview,
  listEngagementCodes,
  listNotificationCampaigns,
  listNotifications,
  markNotificationRead,
  sendNotificationCampaign,
  setEngagementCodeActive,
  updateNotificationPreferences,
} from './engagement.js';
import {
  adminCampaigns,
  adminContent,
  adminContentDetail,
  createContent,
  adminAnalytics,
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
if (config.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN }));
app.use('/api/v1/payments/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use('/assets/ads', express.static(fileURLToPath(new URL('../assets/ads/', import.meta.url)), { maxAge: '1d' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'globalstation-api' });
});

const deviceTypeSchema = z.enum(['android', 'ios', 'web', 'other']);
const notificationChannels = ['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP'] as const;
function requestDeviceType(request: express.Request, supplied?: string) {
  const clientType = deviceTypeSchema.safeParse(supplied ?? request.header('x-device-type'));
  if (clientType.success) return clientType.data;
  const agent = request.header('user-agent') ?? '';
  if (/android/i.test(agent)) return 'android';
  if (/iphone|ipad|ipod/i.test(agent)) return 'ios';
  if (/mozilla|chrome|safari|firefox|edg/i.test(agent)) return 'web';
  return 'other';
}

function requestCountryCode(request: express.Request) {
  if (config.TRUST_PROXY !== 'true') return null;
  const country = request.header('cf-ipcountry') ?? request.header('x-vercel-ip-country');
  if (!country || !/^[a-z]{2}$/i.test(country) || country.toUpperCase() === 'XX') return null;
  return country.toUpperCase();
}

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

app.get('/api/v1/watch-history', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await listContinueWatching(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/industry/profile', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await getIndustryProfile(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/industry/profile', requireAuthenticated, async (request, response, next) => {
  const input = z.object({
    organization: z.string().trim().max(160).default(''),
    industryRole: z.string().trim().min(2).max(100),
    bio: z.string().trim().max(1000).default(''),
    region: z.string().trim().min(2).max(80).default('Malaysia'),
  }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide an industry role and valid profile details.' });
    return;
  }
  try {
    response.json(await saveIndustryProfile(getAuthenticatedUser(request).id, input.data));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/industry/people', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await listIndustryPeople(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/industry/connections', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await listIndustryConnections(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/industry/connections', requireAuthenticated, async (request, response, next) => {
  const input = z.object({
    recipientId: z.string().uuid(),
    message: z.string().trim().max(500).default(''),
  }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose a valid member and connection message.' });
    return;
  }
  try {
    const connection = await createIndustryConnection(getAuthenticatedUser(request).id, input.data.recipientId, input.data.message);
    if (!connection) {
      response.status(409).json({ error: 'CONNECTION_UNAVAILABLE', message: 'This member is unavailable or a connection already exists.' });
      return;
    }
    response.status(201).json(connection);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/industry/connections/:id', requireAuthenticated, async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const input = z.object({ status: z.enum(['ACCEPTED', 'DECLINED']) }).safeParse(request.body);
  if (!id.success || !input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a valid connection and response.' });
    return;
  }
  try {
    const connection = await respondToIndustryConnection(getAuthenticatedUser(request).id, id.data, input.data.status);
    if (!connection) {
      response.status(404).json({ error: 'CONNECTION_NOT_FOUND', message: 'This pending request is not available to your account.' });
      return;
    }
    response.json(connection);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/industry/projects', requireAuthenticated, async (request, response, next) => {
  const view = z.enum(['DISCOVER', 'MINE', 'INVEST']).safeParse(request.query.view ?? 'DISCOVER');
  if (!view.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose a valid project view.' });
    return;
  }
  try {
    response.json(await listMarketplaceProjects(getAuthenticatedUser(request).id, view.data));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/industry/projects', requireAuthenticated, async (request, response, next) => {
  const user = getAuthenticatedUser(request);
  if (!hasRole(user, 'CREATOR') && user.role !== 'ADMIN') {
    response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED', message: 'Register as a creator before publishing a project pitch.' });
    return;
  }
  const input = z.object({
    title: z.string().trim().min(3).max(160),
    summary: z.string().trim().min(20).max(3000),
    kind: z.enum(['PROJECT', 'SCRIPT', 'IP', 'TALENT']),
    format: z.enum(['VERTICAL_SERIES', 'SHORT_FILM', 'FEATURE_FILM', 'OTHER']),
    category: z.string().trim().min(2).max(100),
    stage: z.enum(['IDEA', 'SCRIPT', 'DEVELOPMENT', 'PRODUCTION', 'POST_PRODUCTION']),
    seeking: z.array(z.enum(['CO_PRODUCTION', 'TALENT', 'FUNDING', 'SUBTITLING', 'DUBBING', 'LOCAL_ADAPTATION', 'LICENSING', 'OTT_DISTRIBUTION'])).max(8).default([]),
    regions: z.array(z.enum(['MY', 'SG', 'ID', 'TH', 'PH', 'VN', 'BN', 'KH', 'LA', 'MM'])).max(10).default(['MY']),
    subtitleLanguages: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
    dubbingLanguages: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
    investmentTarget: z.number().positive().max(100_000_000).nullable().default(null),
  }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Complete the project title, synopsis, format, stage, and valid opportunity details.' });
    return;
  }
  try {
    response.status(201).json(await createMarketplaceProject(user.id, input.data));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/industry/projects/story-idea', requireAuthenticated, async (request, response, next) => {
  const user = getAuthenticatedUser(request);
  if (!hasRole(user, 'CREATOR') && user.role !== 'ADMIN') {
    response.status(403).json({ error: 'CREATOR_ACCESS_REQUIRED', message: 'Story idea generation is available to creator accounts.' });
    return;
  }
  const input = z.object({ prompt: z.string().trim().min(10).max(2000) }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Describe the story idea in at least 10 characters.' });
    return;
  }
  try {
    response.json(await generateStoryIdea(input.data.prompt));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/industry/interests', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await listMarketplaceInterests(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/industry/projects/:id/interests', requireAuthenticated, async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const input = z.object({
    amount: z.number().positive().max(100_000_000).nullable().default(null),
    message: z.string().trim().max(1000).default(''),
  }).safeParse(request.body);
  if (!id.success || !input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a valid project interest.' });
    return;
  }
  try {
    const interest = await createMarketplaceInterest(getAuthenticatedUser(request).id, id.data, input.data.amount, input.data.message);
    if (!interest) {
      response.status(409).json({ error: 'INTEREST_UNAVAILABLE', message: 'This project is unavailable or you have already contacted its creator.' });
      return;
    }
    response.status(201).json(interest);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/industry/interests/:id', requireAuthenticated, async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const input = z.object({ status: z.enum(['ACKNOWLEDGED', 'DECLINED']) }).safeParse(request.body);
  if (!id.success || !input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a valid inquiry response.' });
    return;
  }
  try {
    const interest = await updateMarketplaceInterest(getAuthenticatedUser(request).id, id.data, input.data.status);
    if (!interest) {
      response.status(404).json({ error: 'INTEREST_NOT_FOUND', message: 'This pending inquiry is not available to your account.' });
      return;
    }
    response.json(interest);
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
    const input = registerSchema.extend({
      referralCode: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
    }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A name, valid email, and password of at least 8 characters are required.' });
      return;
    }
    const result = await register(input.data.name, input.data.email, input.data.password, input.data.referralCode);
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

app.patch('/api/v1/auth/location-sharing', requireAuthenticated, async (request, response, next) => {
  const input = z.object({ enabled: z.boolean() }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose whether to share viewing location.' });
    return;
  }
  try {
    const user = getAuthenticatedUser(request);
    const { rows } = await pool.query<{ location_analytics_enabled: boolean }>(
      'UPDATE users SET location_analytics_enabled = $1 WHERE id = $2 RETURNING location_analytics_enabled',
      [input.data.enabled, user.id],
    );
    response.json({ locationAnalyticsEnabled: rows[0].location_analytics_enabled });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/auth/ad-preferences', requireAuthenticated, async (request, response, next) => {
  const input = z.object({ enabled: z.boolean(), ageRange: z.enum(['18-24', '25-34', '35-44', '45+']).nullable(), gender: z.enum(['WOMAN', 'MAN', 'NON_BINARY', 'PREFER_NOT_TO_SAY']).nullable() }).safeParse(request.body);
  if (!input.success) { response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose valid optional ad preferences.' }); return; }
  try {
    const user = getAuthenticatedUser(request);
    const values = input.data;
    const { rows } = await pool.query<{ ad_personalization_enabled: boolean; ad_age_range: string | null; ad_gender: string | null }>(
      `UPDATE users SET ad_personalization_enabled = $1, ad_age_range = CASE WHEN $1 THEN $2 ELSE NULL END,
        ad_gender = CASE WHEN $1 THEN $3 ELSE NULL END WHERE id = $4
       RETURNING ad_personalization_enabled, ad_age_range, ad_gender`,
      [values.enabled, values.ageRange, values.gender, user.id],
    );
    response.json({ adPersonalizationEnabled: rows[0].ad_personalization_enabled, adAgeRange: rows[0].ad_age_range, adGender: rows[0].ad_gender });
  } catch (error) { next(error); }
});

app.get('/api/v1/notifications', requireAuthenticated, async (request, response, next) => {
  try {
    const parsedLimit = z.coerce.number().int().min(1).max(100).safeParse(request.query.limit ?? 50);
    if (!parsedLimit.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Notification limit must be between 1 and 100.' });
      return;
    }
    response.json(await listNotifications(getAuthenticatedUser(request).id, parsedLimit.data));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/notifications/:id/read', requireAuthenticated, async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid notification ID is required.' });
      return;
    }
    await markNotificationRead(getAuthenticatedUser(request).id, id.data);
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/notifications/read', requireAuthenticated, async (request, response, next) => {
  try {
    const result = await pool.query(`
      UPDATE user_notifications SET status = 'READ', read_at = COALESCE(read_at, now())
      WHERE user_id = $1 AND channel = 'IN_APP' AND read_at IS NULL
    `, [getAuthenticatedUser(request).id]);
    response.json({ updated: result.rowCount ?? 0 });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/notifications/preferences', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await getNotificationPreferences(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/notifications/preferences', requireAuthenticated, async (request, response, next) => {
  try {
    const input = z.object({
      in_app: z.boolean().optional(),
      push: z.boolean().optional(),
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
    }).refine((preferences) => Object.keys(preferences).length > 0, 'At least one preference is required.').safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide at least one valid notification preference.' });
      return;
    }
    const preferences = Object.fromEntries(
      Object.entries(input.data)
        .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
        .map(([channel, enabled]) => [channel.toUpperCase(), enabled]),
    ) as Partial<Record<(typeof notificationChannels)[number], boolean>>;
    response.json(await updateNotificationPreferences(getAuthenticatedUser(request).id, preferences));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/referrals/me', requireAuthenticated, async (request, response, next) => {
  try {
    response.json(await getReferralOverview(getAuthenticatedUser(request).id));
  } catch (error) {
    next(error);
  }
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
      genre: contentGenreSchema,
      category: z.enum(contentCategories),
      isExclusiveVip: z.boolean(),
      posterKey: z.string().min(1).optional(),
      posterHorizontalKey: z.string().min(1).optional(),
    }).safeParse(request.body);
    if (!id.success || !input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide valid content details and an optional uploaded poster.' });
      return;
    }
    const posterUrl = input.data.posterKey
      ? await verifyCreatorPosterUpload(user.id, input.data.posterKey)
      : undefined;
    const posterHorizontalUrl = input.data.posterHorizontalKey
      ? await verifyCreatorPosterUpload(user.id, input.data.posterHorizontalKey)
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
          poster_horizontal_url = COALESCE($8, poster_horizontal_url),
          status = 'IN_REVIEW', updated_at = now()
        WHERE id = $9 AND created_by = $10
      `, [
        input.data.title, input.data.description, input.data.rating, input.data.genre,
        input.data.category, input.data.isExclusiveVip, posterUrl ?? null, posterHorizontalUrl ?? null, id.data, user.id,
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
    posterHorizontalKey: z.string().min(1),
    rating: z.enum(['U', 'P12', 'P13', '16', '18']),
    genre: contentGenreSchema,
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
    const [posterUrl, posterHorizontalUrl, mediaReference] = await Promise.all([
      verifyCreatorPosterUpload(user.id, input.data.posterKey),
      verifyCreatorPosterUpload(user.id, input.data.posterHorizontalKey),
      verifyCreatorUpload(user.id, input.data.mediaKey),
    ]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const content = await client.query<{ id: string }>(
        'INSERT INTO content (title, content_type, description, poster_url, poster_horizontal_url, rating, genre, category, is_exclusive_vip, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'IN_REVIEW\',$10) RETURNING id',
        [input.data.title, input.data.contentType, input.data.description, posterUrl, posterHorizontalUrl, input.data.rating, input.data.genre, input.data.category, input.data.isExclusiveVip, user.id],
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
    watchSeconds: z.number().int().min(0).max(60),
    positionSeconds: z.number().int().min(0).max(86_400),
    durationSeconds: z.number().int().min(1).max(86_400).nullable(),
    completed: z.boolean().default(false),
    deviceType: deviceTypeSchema.optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).refine(({ latitude, longitude }) => (latitude === undefined && longitude === undefined)
    || (latitude !== undefined && longitude !== undefined), {
    message: 'Latitude and longitude must be provided together.',
  }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Valid playback progress is required.' });
    return;
  }

  const user = getAuthenticatedUser(request);
  try {
    if ((input.data.latitude !== undefined || input.data.longitude !== undefined) && !user.locationAnalyticsEnabled) {
      response.status(403).json({ error: 'LOCATION_SHARING_DISABLED', message: 'Enable viewing location sharing in your profile first.' });
      return;
    }
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
      const deviceType = requestDeviceType(request, input.data.deviceType);
      const countryCode = requestCountryCode(request);
      const latitude = input.data.latitude === undefined ? null : Math.round(input.data.latitude * 100) / 100;
      const longitude = input.data.longitude === undefined ? null : Math.round(input.data.longitude * 100) / 100;
      const completed = input.data.completed
        && input.data.durationSeconds !== null
        && input.data.positionSeconds >= input.data.durationSeconds * 0.9;
      if (existing.rows[0]) {
        await client.query(`
          UPDATE watch_logs SET
            watch_seconds = watch_seconds + $1,
            last_seen_at = now(),
            last_position_seconds = $2,
            max_position_seconds = GREATEST(max_position_seconds, $2),
            duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE($3, 0)),
            completed_at = CASE WHEN $4 THEN COALESCE(completed_at, now()) ELSE completed_at END,
            device_type = COALESCE(device_type, $5),
            country_code = COALESCE(country_code, $6),
            latitude = COALESCE($8, latitude),
            longitude = COALESCE($9, longitude),
            location = CASE WHEN $8::double precision IS NULL OR $9::double precision IS NULL THEN location
              ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END
          WHERE id = $7
        `, [input.data.watchSeconds, input.data.positionSeconds, input.data.durationSeconds, completed, deviceType, countryCode, existing.rows[0].id, latitude, longitude]);
      } else {
        await client.query(
          `INSERT INTO watch_logs
            (user_id, episode_id, watch_seconds, device_ip, session_uid, last_seen_at, last_position_seconds,
             max_position_seconds, duration_seconds, completed_at, device_type, country_code, latitude, longitude, location)
           VALUES ($1, $2, $3, $4, $5, now(), $6, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END, $9, $10,
             $11, $12, CASE WHEN $11::double precision IS NULL OR $12::double precision IS NULL THEN NULL
               ELSE ST_SetSRID(ST_MakePoint($12, $11), 4326)::geography END)`,
          [user.id, input.data.episodeId, input.data.watchSeconds, request.ip ?? '127.0.0.1', input.data.sessionUid,
            input.data.positionSeconds, input.data.durationSeconds, completed, deviceType, countryCode, latitude, longitude],
        );
      }
      if (input.data.watchSeconds > 0) {
        await client.query(`
          INSERT INTO viewer_activity (user_id, session_uid, activity_date, watch_seconds, device_type, country_code)
          VALUES ($1, $2, current_date, $3, $4, $5)
          ON CONFLICT (user_id, session_uid, activity_date) DO UPDATE SET
            watch_seconds = viewer_activity.watch_seconds + EXCLUDED.watch_seconds,
            device_type = COALESCE(viewer_activity.device_type, EXCLUDED.device_type),
            country_code = COALESCE(viewer_activity.country_code, EXCLUDED.country_code)
        `, [user.id, input.data.sessionUid, input.data.watchSeconds, deviceType, countryCode]);
      }
      await client.query('COMMIT');
      if (latitude !== null && longitude !== null) {
        void lookupViewerRegion(latitude, longitude);
      }
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

app.post('/api/v1/payments/stripe/webhook', async (request, response, next) => {
  try {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: 'INVALID_WEBHOOK_PAYLOAD', message: 'Stripe webhook requires a raw JSON request body.' });
      return;
    }
    await processStripeWebhook(request.body, request.header('stripe-signature'));
    response.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/payments/stripe/return', (_request, response) => {
  response.type('text/plain').send('Payment status is verified by Stripe. You may return to CINEVA and refresh membership status.');
});

app.get('/api/v1/payments/stripe/cancel', (_request, response) => {
  response.type('text/plain').send('Checkout was cancelled. No membership change was made.');
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
        c.created_at AS "createdAt", c.target_gender AS "targetGender",
        c.target_age_ranges AS "targetAgeRanges", c.target_country_codes AS "targetCountryCodes",
        c.target_malaysia_states AS "targetMalaysiaStates",
        COUNT(i.id) FILTER (WHERE i.qualified_at IS NOT NULL)::int AS impressions
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
      targetGender: z.enum(['ALL', 'WOMAN', 'MAN']).default('ALL'),
      targetAgeRanges: z.array(z.enum(['18-24', '25-34', '35-44', '45+'])).max(4).default([]),
      targetCountryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(30).default([]),
      targetMalaysiaStates: z.array(z.enum(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16'])).max(16).default([]),
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
      INSERT INTO ad_campaigns (advertiser_id, campaign_name, creative_video_url, click_through_url, cpm_rate, total_budget, remaining_budget, target_tier, target_gender, target_age_ranges, target_country_codes, target_malaysia_states, status)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,'PENDING_REVIEW')
      RETURNING id, status
    `, [user.id, input.data.campaignName, creativeVideoUrl, input.data.clickThroughUrl, input.data.cpmRate, input.data.totalBudget, input.data.targetTier, input.data.targetGender, input.data.targetAgeRanges, input.data.targetCountryCodes, input.data.targetMalaysiaStates]);
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
      FROM ad_campaigns c JOIN users u ON u.id = $1
      WHERE c.status = 'ACTIVE'
        AND c.remaining_budget >= GREATEST(0.01, ROUND(c.cpm_rate / 1000, 2))
        AND c.target_tier IN ('ALL', 'FREE')
        AND (c.target_gender = 'ALL' OR (u.ad_personalization_enabled AND u.ad_gender = c.target_gender))
        AND (cardinality(c.target_age_ranges) = 0 OR (u.ad_personalization_enabled AND u.ad_age_range = ANY(c.target_age_ranges)))
        AND (cardinality(c.target_country_codes) = 0 AND cardinality(c.target_malaysia_states) = 0
          OR EXISTS (
          SELECT 1 WHERE $2::char(2) = ANY(c.target_country_codes)
          UNION ALL
          SELECT 1 FROM ad_impressions ai WHERE ai.user_id = u.id AND ai.country_code = ANY(c.target_country_codes)
            AND ai.created_at > now() - interval '90 days'
          UNION ALL
          SELECT 1 FROM watch_logs w JOIN viewer_location_regions r
            ON r.latitude = ROUND(w.latitude::numeric, 2)
            AND r.longitude = ROUND(w.longitude::numeric, 2)
          WHERE w.user_id = u.id AND u.location_analytics_enabled
            AND w.last_seen_at > now() - interval '90 days'
            AND r.country_code = ANY(c.target_country_codes)
          )
          OR (cardinality(c.target_malaysia_states) > 0 AND EXISTS (
            SELECT 1 FROM watch_logs w JOIN viewer_location_regions r
              ON r.latitude = ROUND(w.latitude::numeric, 2)
              AND r.longitude = ROUND(w.longitude::numeric, 2)
            WHERE w.user_id = u.id AND u.location_analytics_enabled
              AND w.last_seen_at > now() - interval '90 days'
              AND r.country_code = 'MY' AND r.region_code::text = ANY(c.target_malaysia_states)
          )))
      ORDER BY -LN(GREATEST(random(), 0.000001)) / GREATEST(c.cpm_rate, 0.01), c.created_at ASC
      LIMIT 1
      FOR UPDATE OF c SKIP LOCKED
    `, [user.id, requestCountryCode(request)]);
    const campaign = rows[0];
    if (!campaign) {
      await client.query('COMMIT');
      response.sendStatus(204);
      return;
    }

    const creativeVideoUrl = signPlaybackUrl(campaign.creative_video_url);
    const address = request.ip ?? request.socket.remoteAddress ?? '127.0.0.1';
    const impression = await client.query<{ id: string }>(
      `INSERT INTO ad_impressions (campaign_id, user_id, device_ip, device_type, country_code)
       VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
      [campaign.id, user.id, address, requestDeviceType(request), requestCountryCode(request)],
    );
    await client.query('COMMIT');
    response.json({
      id: campaign.id,
      impressionId: impression.rows[0].id,
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

app.post('/api/v1/ads/impressions/:id/progress', requireAuthenticated, async (request, response, next) => {
  const id = z.string().regex(/^\d+$/).safeParse(request.params.id);
  const input = z.object({
    positionSeconds: z.number().int().min(0).max(86_400),
    durationSeconds: z.number().int().min(1).max(86_400),
    completed: z.boolean().default(false),
    deviceType: deviceTypeSchema.optional(),
  }).safeParse(request.body);
  if (!id.success || !input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Valid ad progress is required.' });
    return;
  }
  try {
    const user = getAuthenticatedUser(request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ watched_seconds: number; last_position_seconds: number; last_progress_at: Date | null; qualified_at: Date | null; campaign_id: string; cpm_rate: string }>(`
        SELECT i.watched_seconds, i.last_position_seconds, i.last_progress_at, i.qualified_at,
          i.campaign_id, c.cpm_rate::text
        FROM ad_impressions i JOIN ad_campaigns c ON c.id = i.campaign_id
        WHERE i.id = $1::bigint AND i.user_id = $2 FOR UPDATE OF i, c
      `, [id.data, user.id]);
      const impression = selected.rows[0];
      if (!impression) {
        await client.query('ROLLBACK');
        response.status(404).json({ error: 'AD_IMPRESSION_NOT_FOUND' });
        return;
      }
      const now = Date.now();
      const elapsed = impression.last_progress_at ? (now - new Date(impression.last_progress_at).getTime()) / 1000 : 0;
      const advance = input.data.positionSeconds - impression.last_position_seconds;
      const watchedDelta = elapsed >= 0 && elapsed <= 15 && advance > 0 && advance <= elapsed + 2 ? Math.floor(advance) : 0;
      const watched = impression.watched_seconds + watchedDelta;
      const completed = input.data.completed && input.data.positionSeconds >= input.data.durationSeconds * 0.9;
      await client.query(`UPDATE ad_impressions SET watched_seconds = $1,
        last_position_seconds = $2, last_progress_at = now(),
        creative_duration_seconds = GREATEST(COALESCE(creative_duration_seconds, 0), $3),
        completed_at = CASE WHEN $4 THEN COALESCE(completed_at, now()) ELSE completed_at END,
        device_type = COALESCE(device_type, $5) WHERE id = $6::bigint`,
      [watched, input.data.positionSeconds, input.data.durationSeconds, completed,
        requestDeviceType(request, input.data.deviceType), id.data]);
      if (!impression.qualified_at && watched >= 8) {
        const cost = Math.max(0.01, Math.round(Number(impression.cpm_rate) / 10) / 100);
        const billed = await client.query(`UPDATE ad_campaigns SET remaining_budget = remaining_budget - $1,
          status = CASE WHEN remaining_budget <= $1 THEN 'COMPLETED' ELSE status END
          WHERE id = $2 AND status = 'ACTIVE' AND remaining_budget >= $1 RETURNING id`, [cost, impression.campaign_id]);
        if (billed.rowCount) await client.query('UPDATE ad_impressions SET qualified_at = now() WHERE id = $1::bigint', [id.data]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/ads/impressions/:id/click', requireAuthenticated, async (request, response, next) => {
  const id = z.string().regex(/^\d+$/).safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid ad impression is required.' });
    return;
  }
  try {
    const impression = await pool.query<{ id: string }>(
      'SELECT id::text FROM ad_impressions WHERE id = $1::bigint AND user_id = $2 AND qualified_at IS NOT NULL',
      [id.data, getAuthenticatedUser(request).id],
    );
    if (!impression.rowCount) {
      response.status(404).json({ error: 'AD_IMPRESSION_NOT_FOUND' });
      return;
    }
    await pool.query('INSERT INTO ad_clicks (impression_id) VALUES ($1::bigint) ON CONFLICT DO NOTHING', [id.data]);
    response.sendStatus(204);
  } catch (error) {
    next(error);
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
    const input = z.object({ posterKey: z.string().min(1), posterHorizontalKey: z.string().min(1), mediaKey: z.string().min(1) }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Upload vertical and horizontal poster images and an MP4 media file first.' });
      return;
    }
    const [posterUrl, posterHorizontalUrl, hlsManifestUrl] = await Promise.all([
      verifyAdminUpload(userId, 'poster', input.data.posterKey),
      verifyAdminUpload(userId, 'poster', input.data.posterHorizontalKey),
      verifyAdminUpload(userId, 'media', input.data.mediaKey),
    ]);
    response.status(201).json(await createContent({ ...request.body, posterUrl, posterHorizontalUrl, hlsManifestUrl }, userId));
  } catch (error) { next(error); }
});

app.get('/api/v1/admin/industry/projects', async (request, response, next) => {
  const status = z.enum(['ALL', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'])
    .safeParse(typeof request.query.status === 'string' ? request.query.status : 'ALL');
  if (!status.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Choose a valid project status.' });
    return;
  }
  try {
    const values: string[] = [];
    const where = status.data === 'ALL' ? '' : `WHERE p.status = $${values.push(status.data)}`;
    const { rows } = await pool.query(`
      SELECT p.id, p.title, p.summary, p.kind, p.format, p.category, p.stage,
        p.seeking, p.regions, p.subtitle_languages AS "subtitleLanguages",
        p.dubbing_languages AS "dubbingLanguages",
        p.investment_target AS "investmentTarget", p.status,
        p.created_at AS "createdAt", u.name AS "creatorName", u.email AS "creatorEmail",
        COALESCE(ip.organization, '') AS organization,
        (SELECT COUNT(*)::int FROM marketplace_interests mi WHERE mi.project_id = p.id) AS "interestCount"
      FROM marketplace_projects p
      JOIN users u ON u.id = p.creator_id
      LEFT JOIN industry_profiles ip ON ip.user_id = p.creator_id
      ${where}
      ORDER BY CASE p.status WHEN 'IN_REVIEW' THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 200
    `, values);
    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/admin/industry/projects/:id/status', async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const input = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'ARCHIVED']) }).safeParse(request.body);
  if (!id.success || !input.success) {
    response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a valid project and moderation status.' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(`
      UPDATE marketplace_projects SET status = $1, updated_at = now()
      WHERE id = $2
      RETURNING id, title, status
    `, [input.data.status, id.data]);
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      response.status(404).json({ error: 'PROJECT_NOT_FOUND', message: 'This project listing no longer exists.' });
      return;
    }
    await client.query(`
      INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, 'MARKETPLACE_PROJECT', $3, $4)
    `, [getAdminUserId(request), `MARKETPLACE_PROJECT_${input.data.status}`, id.data, { status: input.data.status }]);
    await client.query('COMMIT');
    response.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
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

app.get('/api/v1/admin/analytics', async (_request, response, next) => {
  try { response.json(await adminAnalytics()); } catch (error) { next(error); }
});

app.get('/api/v1/admin/engagement/campaigns', async (_request, response, next) => {
  try { response.json(await listNotificationCampaigns()); } catch (error) { next(error); }
});

app.post('/api/v1/admin/engagement/campaigns', async (request, response, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      channel: z.enum(notificationChannels),
      audience: z.enum(['ALL', 'FREE', 'VIP']).default('ALL'),
      title: z.string().trim().min(1).max(160),
      body: z.string().trim().min(1).max(2_000),
      scheduledAt: z.string().datetime({ offset: true }).optional(),
    }).safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide a valid notification campaign.' });
      return;
    }
    response.status(201).json(await createNotificationCampaign(input.data, getAdminUserId(request)!));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/engagement/campaigns/:id/send', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid campaign ID is required.' });
      return;
    }
    response.json(await sendNotificationCampaign(id.data));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/admin/engagement/campaigns/:id/cancel', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid campaign ID is required.' });
      return;
    }
    response.json(await cancelNotificationCampaign(id.data));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/admin/engagement/codes', async (_request, response, next) => {
  try { response.json(await listEngagementCodes()); } catch (error) { next(error); }
});

app.patch('/api/v1/admin/engagement/codes/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().safeParse(request.params.id);
    const input = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!id.success || !input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'A valid code ID and active state are required.' });
      return;
    }
    response.json(await setEngagementCodeActive(id.data, input.data.isActive));
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/engagement/codes', async (request, response, next) => {
  try {
    const input = z.object({
      code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
      codeType: z.enum(['CAMPAIGN', 'INFLUENCER', 'PROMOTION']),
      ownerId: z.string().uuid().optional(),
      rewardConfig: z.record(z.string(), z.unknown()).default({}),
      maxRedemptions: z.number().int().positive().optional(),
      startsAt: z.string().datetime({ offset: true }).optional(),
      endsAt: z.string().datetime({ offset: true }).optional(),
    }).refine((value) => !value.startsAt || !value.endsAt || Date.parse(value.startsAt) < Date.parse(value.endsAt),
      'The code end time must be later than its start time.').safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: 'INVALID_REQUEST', message: 'Provide valid code details and an optional reward configuration.' });
      return;
    }
    response.status(201).json(await createEngagementCode(input.data));
  } catch (error) {
    next(error);
  }
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
