import { DramaItem, UserRole } from '../data/models/Drama';
import { createSessionFingerprint, readSession, saveSession } from '../core/security/sessionStorage';
import { NativeModules, Platform } from 'react-native';

function getApiBaseUrl(): string {
  const scriptUrl = NativeModules.SourceCode?.scriptURL;
  const bundleHost = __DEV__ && typeof scriptUrl === 'string'
    ? /^https?:\/\/([^/:?#]+)/i.exec(scriptUrl)?.[1]
    : undefined;
  const localBundleHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2']);
  const reachableBundleHost = bundleHost && !localBundleHosts.has(bundleHost.toLowerCase())
    ? bundleHost
    : undefined;
  // React Native's Android model constant is not consistent across runtimes.
  // Prefer a reachable Metro/LAN host when supplied; otherwise Android's
  // emulator bridge is the reliable local API address.
  const fallbackHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  const host = reachableBundleHost ?? fallbackHost;

  return `http://${host}:5000/api/v1`;
}

export const API_BASE_URL = getApiBaseUrl();
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/i, '');

export function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(?::\d+)?(?=\/|[?#]|$)/i, API_ORIGIN);
}

export type AnalyticsDeviceType = 'android' | 'ios' | 'web' | 'other';
function analyticsDeviceType(): AnalyticsDeviceType {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') return Platform.OS;
  return 'other';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('API base URL is not configured');
  }
  const session = await readSession();
  const headers = new Headers(init?.headers);
  if (session?.jwt) headers.set('Authorization', `Bearer ${session.jwt}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (err) {
    throw new Error(`Network request failed to ${API_BASE_URL}${path}. Please check your connection or API server.`);
  }
  if (response.status === 204) return null as T;
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(error.message ?? error.error ?? `API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface PlaybackAccess {
  manifestUrl: string;
}

export interface ViewerProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
  isVip: boolean;
  coinBalance: number;
  locationAnalyticsEnabled: boolean;
  adPersonalizationEnabled: boolean;
  adAgeRange: string | null;
  adGender: 'WOMAN' | 'MAN' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY' | null;
}

export interface CoinWallet {
  balance: number;
  unlockedEpisodeIds: string[];
  episodePrice: number;
  packs: Array<{ code: 'STARTER' | 'POPULAR' | 'VALUE'; coins: number; amount: string; currency: 'MYR'; label: string }>;
}

export function getCoinWallet(): Promise<CoinWallet> {
  return request<CoinWallet>('/coins/wallet');
}

export function purchaseEpisodeWithCoins(episodeId: string): Promise<{ balance: number; episodeId: string; alreadyUnlocked: boolean }> {
  return request<{ balance: number; episodeId: string; alreadyUnlocked: boolean }>(`/coins/episodes/${encodeURIComponent(episodeId)}/purchase`, { method: 'POST' });
}

export function createCoinCheckout(pack: CoinWallet['packs'][number]['code']): Promise<{ paymentUrl: string; coins: number }> {
  return request<{ paymentUrl: string; coins: number }>('/coins/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack }),
  });
}

interface SessionResponse { token: string; role: UserRole; expiresAt: string }

async function persistSession(session: SessionResponse) {
  await saveSession({ jwt: session.token, role: session.role, fingerprint: createSessionFingerprint() });
}

export async function loginViewer(email: string, password: string): Promise<ViewerProfile> {
  const session = await request<SessionResponse>('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  await persistSession(session);
  return getViewerProfile();
}

export async function registerViewer(
  name: string,
  email: string,
  password: string,
  referralCode?: string,
  adPreferences: {
    enabled: boolean;
    ageRange: ViewerProfile['adAgeRange'];
    gender: ViewerProfile['adGender'];
  } = { enabled: false, ageRange: null, gender: null },
): Promise<ViewerProfile> {
  const session = await request<SessionResponse>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      email,
      password,
      referralCode,
      adPersonalizationEnabled: adPreferences.enabled,
      adAgeRange: adPreferences.ageRange,
      adGender: adPreferences.gender,
    }),
  });
  await persistSession(session);
  return getViewerProfile();
}

export async function upgradeViewerRole(role: 'CREATOR' | 'ADVERTISER'): Promise<ViewerProfile> {
  const session = await request<SessionResponse>('/auth/upgrade-role', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
  });
  await persistSession(session);
  return getViewerProfile();
}

export function getViewerProfile(): Promise<ViewerProfile> {
  return request<ViewerProfile>('/auth/me');
}

export function setLocationAnalyticsEnabled(enabled: boolean): Promise<{ locationAnalyticsEnabled: boolean }> {
  return request<{ locationAnalyticsEnabled: boolean }>('/auth/location-sharing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export function setAdPreferences(input: { enabled: boolean; ageRange: string | null; gender: ViewerProfile['adGender'] }) {
  return request<{ adPersonalizationEnabled: boolean; adAgeRange: string | null; adGender: ViewerProfile['adGender'] }>('/auth/ad-preferences', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  readAt: string | null;
  createdAt: string;
}

export type NotificationPreferences = Record<'in_app' | 'push' | 'email' | 'sms' | 'whatsapp', boolean>;

export interface ReferralOverview {
  code: string;
  referrals: Array<{ status: string; count: number }>;
  rewards: Array<{
    id: string;
    rewardType: 'VIP_DAYS' | 'DISCOUNT_PERCENT' | 'DISCOUNT_AMOUNT' | 'CREDIT';
    amount: string;
    currency: string | null;
    status: 'PENDING' | 'APPROVED' | 'GRANTED' | 'REVOKED';
    createdAt: string;
    grantedAt: string | null;
  }>;
}

export function getNotifications(limit = 50): Promise<InAppNotification[]> {
  return request<InAppNotification[]>(`/notifications?limit=${encodeURIComponent(limit)}`);
}

export function markNotificationRead(id: string): Promise<void> {
  return request<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return request<{ updated: number }>('/notifications/read', { method: 'PATCH' });
}

export function getNotificationPreferences(): Promise<NotificationPreferences> {
  return request<NotificationPreferences>('/notifications/preferences');
}

export function updateNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  return request<NotificationPreferences>('/notifications/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
}

export function getReferralOverview(): Promise<ReferralOverview> {
  return request<ReferralOverview>('/referrals/me');
}

export interface CurrentSubscription {
  planCode: 'FREE' | 'VIP_MONTHLY' | 'VIP_YEARLY';
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
  startedAt: string;
  renewsAt: string | null;
}

export interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  createdAt: string;
}

export interface CreatorSubmission {
  id: string;
  title: string;
  contentType: 'MOVIE' | 'SERIES';
  description: string;
  posterUrl: string | null;
  posterHorizontalUrl: string | null;
  rating: string;
  genre: string;
  category: string;
  isExclusiveVip: boolean;
  isArchived: boolean;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  episodeCount: number;
  views: number;
  uniqueViewers: number;
  watchSeconds: number;
  episodes: Array<{ episodeNumber: number; title: string; durationSeconds: number; views: number; watchSeconds: number }>;
}

export interface CreatorPayoutRequest {
  id: string;
  amount: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  requestedAt: string;
  processedAt: string | null;
}

export interface CreatorDashboard {
  submissions: CreatorSubmission[];
  payouts: {
    earned: string;
    reserved: string;
    paid: string;
    available: string;
    minimumRequest: string;
    requests: CreatorPayoutRequest[];
  };
}

export function getCurrentSubscription(): Promise<CurrentSubscription | null> {
  return request<CurrentSubscription | null>('/subscriptions/current');
}

export function createVipCheckout(plan: 'VIP_MONTHLY' | 'VIP_YEARLY') {
  return request<{ paymentUrl: string; subscriptionId: string }>('/subscriptions/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
  });
}

export function listSupportTickets(): Promise<SupportTicket[]> {
  return request<SupportTicket[]>('/support/tickets');
}

export function createSupportTicket(input: { subject: string; description: string; priority: SupportTicket['priority'] }) {
  return request<{ id: string; status: SupportTicket['status'] }>('/support/tickets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export interface AdPayload {
  id: string;
  impressionId: string;
  title: string;
  creativeVideoUrl: string;
  clickThroughUrl: string | null;
}

export interface ContinueWatchingItem {
  id: string;
  title: string;
  category: string;
  genre: string;
  rating: string;
  badge: 'VIP' | 'FREE';
  posterUrl?: string;
  description: string;
  episodeId: string;
  episodeTitle: string;
  durationSeconds: number;
  resumeAtSeconds: number;
  progress: number;
  timeLeft: string;
}

export type IndustryRole = 'CREATOR' | 'ADVERTISER' | 'VIEWER' | 'ADMIN';
export type MarketplaceProjectKind = 'PROJECT' | 'SCRIPT' | 'IP' | 'TALENT';
export type MarketplaceProjectFormat = 'VERTICAL_SERIES' | 'SHORT_FILM' | 'FEATURE_FILM' | 'OTHER';
export type MarketplaceProjectStage = 'IDEA' | 'SCRIPT' | 'DEVELOPMENT' | 'PRODUCTION' | 'POST_PRODUCTION';
export type MarketplaceNeed =
  | 'CO_PRODUCTION'
  | 'TALENT'
  | 'FUNDING'
  | 'SUBTITLING'
  | 'DUBBING'
  | 'LOCAL_ADAPTATION'
  | 'LICENSING'
  | 'OTT_DISTRIBUTION';

export interface IndustryProfile {
  id: string;
  organization: string;
  industryRole: string;
  bio: string;
  region: string;
}

export interface IndustryPerson extends IndustryProfile {
  name: string;
  roles: IndustryRole[];
  connectionId: string | null;
  connectionStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED' | null;
  connectionDirection: 'INCOMING' | 'OUTGOING' | null;
}

export interface IndustryConnection {
  id: string;
  requesterId: string;
  recipientId: string;
  peerId: string;
  peerName: string;
  organization: string | null;
  industryRole: string | null;
  message: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  createdAt: string;
}

export interface MarketplaceProject {
  id: string;
  creatorId: string;
  title: string;
  summary: string;
  kind: MarketplaceProjectKind;
  format: MarketplaceProjectFormat;
  category: string;
  stage: MarketplaceProjectStage;
  seeking: MarketplaceNeed[];
  regions: string[];
  subtitleLanguages: string[];
  dubbingLanguages: string[];
  investmentTarget: string | number | null;
  status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  createdAt: string;
  creatorName?: string;
  organization?: string;
  hasExpressedInterest?: boolean;
  interestCount?: number;
}

export interface MarketplaceInterest {
  id: string;
  projectId: string;
  projectTitle: string;
  creatorId: string;
  investorId: string;
  investorName: string;
  amount: string | number | null;
  message: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'DECLINED';
  createdAt: string;
  isOwner: boolean;
}

export interface CreateMarketplaceProject {
  title: string;
  summary: string;
  kind: MarketplaceProjectKind;
  format: MarketplaceProjectFormat;
  category: string;
  stage: MarketplaceProjectStage;
  seeking: MarketplaceNeed[];
  regions: string[];
  subtitleLanguages: string[];
  dubbingLanguages: string[];
  investmentTarget: number | null;
}

export interface AdvertiserCampaign {
  id: string;
  campaignName: string;
  creativeVideoUrl: string;
  clickThroughUrl: string;
  cpmRate: string;
  totalBudget: string;
  remainingBudget: string;
  targetTier: 'ALL' | 'FREE';
  targetGender: 'ALL' | 'WOMAN' | 'MAN';
  targetAgeRanges: string[];
  targetCountryCodes: string[];
  targetMalaysiaStates: string[];
  status: 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'REJECTED' | 'COMPLETED';
  impressions: number;
}

export async function getCatalog(): Promise<DramaItem[]> {
  const catalog = await request<DramaItem[]>('/dramas');
  return catalog
    .filter((item) => !!item && typeof item.id === 'string' && item.id.trim().length > 0)
    .map((item) => ({
      ...item,
      posterUrl: normalizeUrl(item.posterUrl) ?? undefined,
      posterHorizontalUrl: normalizeUrl(item.posterHorizontalUrl) ?? undefined,
    }));
}

export async function getContinueWatching(): Promise<ContinueWatchingItem[]> {
  const history = await request<ContinueWatchingItem[]>('/watch-history');
  return history
    .filter((item) => !!item && typeof item.episodeId === 'string' && item.episodeId.trim().length > 0)
    .map((item) => ({ ...item, posterUrl: normalizeUrl(item.posterUrl) ?? undefined }));
}

export function getIndustryProfile(): Promise<IndustryProfile | null> {
  return request<IndustryProfile | null>('/industry/profile');
}

export function saveIndustryProfile(input: Omit<IndustryProfile, 'id'>): Promise<IndustryProfile> {
  return request<IndustryProfile>('/industry/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getIndustryPeople(): Promise<IndustryPerson[]> {
  return request<IndustryPerson[]>('/industry/people');
}

export function getIndustryConnections(): Promise<IndustryConnection[]> {
  return request<IndustryConnection[]>('/industry/connections');
}

export function createIndustryConnection(recipientId: string, message: string): Promise<IndustryConnection> {
  return request<IndustryConnection>('/industry/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipientId, message }),
  });
}

export function respondToIndustryConnection(id: string, status: 'ACCEPTED' | 'DECLINED'): Promise<IndustryConnection> {
  return request<IndustryConnection>(`/industry/connections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export function getMarketplaceProjects(view: 'DISCOVER' | 'MINE' | 'INVEST' = 'DISCOVER'): Promise<MarketplaceProject[]> {
  return request<MarketplaceProject[]>(`/industry/projects?view=${encodeURIComponent(view)}`);
}

export function createMarketplaceProject(input: CreateMarketplaceProject): Promise<MarketplaceProject> {
  return request<MarketplaceProject>('/industry/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function generateStoryIdea(prompt: string): Promise<{ title: string; summary: string }> {
  return request<{ title: string; summary: string }>('/industry/projects/story-idea', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export function getMarketplaceInterests(): Promise<MarketplaceInterest[]> {
  return request<MarketplaceInterest[]>('/industry/interests');
}

export function createMarketplaceInterest(projectId: string, amount: number | null, message: string): Promise<MarketplaceInterest> {
  return request<MarketplaceInterest>(`/industry/projects/${encodeURIComponent(projectId)}/interests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, message }),
  });
}

export function updateMarketplaceInterest(id: string, status: 'ACKNOWLEDGED' | 'DECLINED'): Promise<MarketplaceInterest> {
  return request<MarketplaceInterest>(`/industry/interests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function searchCatalog(query: string): Promise<DramaItem[]> {
  const catalog = await getCatalog();
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery ? catalog.filter((item) => item.title.toLowerCase().includes(normalizedQuery)) : catalog;
}

export async function authorizePlayback(episodeId: string): Promise<PlaybackAccess> {
  const access = await request<PlaybackAccess>('/streams/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId }),
  });
  return {
    ...access,
    manifestUrl: normalizeUrl(access.manifestUrl) ?? access.manifestUrl,
  };
}

export function recordPlaybackProgress(
  episodeId: string,
  sessionUid: string,
  watchSeconds: number,
  positionSeconds: number,
  durationSeconds: number | null,
  completed = false,
  location?: { latitude: number; longitude: number } | null,
): Promise<void> {
  return request<void>('/streams/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId, sessionUid, watchSeconds, positionSeconds, durationSeconds, completed, deviceType: analyticsDeviceType(), ...location }),
  });
}

export async function createCreatorUpload(contentLength: number) {
  const res = await request<{ uploadUrl: string; objectKey: string; contentType: 'video/mp4'; expiresInSeconds: number }>('/creator/uploads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentLength }),
  });
  return { ...res, uploadUrl: normalizeUrl(res.uploadUrl) ?? res.uploadUrl };
}

export async function createCreatorPosterUpload(contentType: string, contentLength: number) {
  const res = await request<{ uploadUrl: string; objectKey: string; contentType: string; expiresInSeconds: number; requiredHeaders?: Record<string, string> }>('/creator/uploads/poster', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType, contentLength }),
  });
  return { ...res, uploadUrl: normalizeUrl(res.uploadUrl) ?? res.uploadUrl };
}

export async function listCreatorSubmissions(): Promise<CreatorSubmission[]> {
  const submissions = await request<CreatorSubmission[]>('/creator/submissions');
  return submissions.map((s) => ({
    ...s,
    posterUrl: normalizeUrl(s.posterUrl),
    posterHorizontalUrl: normalizeUrl(s.posterHorizontalUrl),
  }));
}

export async function getCreatorDashboard(): Promise<CreatorDashboard> {
  const dashboard = await request<CreatorDashboard>('/creator/dashboard');
  return {
    ...dashboard,
    submissions: dashboard.submissions.map((s) => ({
      ...s,
      posterUrl: normalizeUrl(s.posterUrl),
      posterHorizontalUrl: normalizeUrl(s.posterHorizontalUrl),
    })),
  };
}

export function archiveCreatorContent(id: string, archived: boolean) {
  return request<{ id: string; isArchived: boolean }>(`/creator/submissions/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }),
  });
}

export function updateCreatorContent(id: string, input: {
  title: string;
  description: string;
  rating: string;
  genre: string[];
  category: string;
  isExclusiveVip: boolean;
  posterKey?: string;
  posterHorizontalKey?: string;
}) {
  return request<{ id: string; status: 'IN_REVIEW' }>(`/creator/submissions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function addCreatorEpisode(id: string, input: {
  title: string;
  durationSeconds: number;
  mediaKey: string;
  subtitleLanguages: string[];
  dubbingLanguages: string[];
}) {
  return request<{ id: string; episodeNumber: number; status: 'IN_REVIEW' }>(`/creator/submissions/${encodeURIComponent(id)}/episodes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function deleteCreatorContent(id: string) {
  return request<{ id: string; deleted: true }>(`/creator/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function requestCreatorPayout(amount: number): Promise<CreatorPayoutRequest> {
  return request<CreatorPayoutRequest>('/creator/payout-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }),
  });
}

export function submitCreatorContent(payload: {
  title: string;
  contentType: 'MOVIE' | 'SERIES';
  description: string;
  posterKey: string;
  posterHorizontalKey: string;
  rating: string;
  genre: string[];
  category: string;
  episodeTitle: string;
  durationSeconds: number;
  mediaKey: string;
  isExclusiveVip: boolean;
  subtitleLanguages: string[];
  dubbingLanguages: string[];
}) {
  return request<{ id: string; status: 'IN_REVIEW' }>('/creator/submissions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function calculatePayout(views: number, revenueShare = 0.3) {
  return { views, revenueShare, amount: Number((views * 0.012 * revenueShare).toFixed(2)) };
}

export async function getAdPayload(): Promise<AdPayload | null> {
  const ad = await request<AdPayload | null>('/ads/next', {
    headers: { 'X-Device-Type': analyticsDeviceType() },
  });
  if (!ad) return null;
  return {
    ...ad,
    creativeVideoUrl: normalizeUrl(ad.creativeVideoUrl) ?? ad.creativeVideoUrl,
  };
}

export function recordAdProgress(impressionId: string, positionSeconds: number, durationSeconds: number, completed = false) {
  return request<void>(`/ads/impressions/${encodeURIComponent(impressionId)}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionSeconds, durationSeconds, completed, deviceType: analyticsDeviceType() }),
  });
}

export function recordAdClick(impressionId: string) {
  return request<void>(`/ads/impressions/${encodeURIComponent(impressionId)}/click`, { method: 'POST' });
}

export async function listAdvertiserCampaigns(): Promise<AdvertiserCampaign[]> {
  const campaigns = await request<AdvertiserCampaign[]>('/advertiser/campaigns');
  return campaigns.map((c) => ({
    ...c,
    creativeVideoUrl: normalizeUrl(c.creativeVideoUrl) ?? c.creativeVideoUrl,
  }));
}

export async function createAdvertiserUpload(contentLength: number) {
  const res = await request<{ uploadUrl: string; objectKey: string; contentType: 'video/mp4'; expiresInSeconds: number }>('/advertiser/uploads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentLength }),
  });
  return { ...res, uploadUrl: normalizeUrl(res.uploadUrl) ?? res.uploadUrl };
}

export function createAdvertiserCampaign(input: {
  campaignName: string;
  creativeKey: string;
  clickThroughUrl: string;
  cpmRate: number;
  totalBudget: number;
  targetTier: 'FREE';
  targetGender: AdvertiserCampaign['targetGender'];
  targetAgeRanges: string[];
  targetCountryCodes: string[];
  targetMalaysiaStates: string[];
}) {
  return request<{ id: string; status: AdvertiserCampaign['status'] }>('/advertiser/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}
