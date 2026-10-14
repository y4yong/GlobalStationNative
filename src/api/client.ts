import { DramaItem, UserRole } from '../data/models/Drama';
import { createSessionFingerprint, readSession, saveSession } from '../core/security/sessionStorage';
import { Platform } from 'react-native';

const API_BASE_URL = 'http://10.0.2.2:5000/api/v1';

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
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
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

export async function registerViewer(name: string, email: string, password: string, referralCode?: string): Promise<ViewerProfile> {
  const session = await request<SessionResponse>('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, referralCode }),
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

export interface AdvertiserCampaign {
  id: string;
  campaignName: string;
  creativeVideoUrl: string;
  clickThroughUrl: string;
  cpmRate: string;
  totalBudget: string;
  remainingBudget: string;
  targetTier: 'ALL' | 'FREE';
  status: 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'REJECTED' | 'COMPLETED';
  impressions: number;
}

export async function getCatalog(): Promise<DramaItem[]> {
  const catalog = await request<DramaItem[]>('/dramas');
  return catalog.filter((item) => !!item && typeof item.id === 'string' && item.id.trim().length > 0);
}

export async function searchCatalog(query: string): Promise<DramaItem[]> {
  const catalog = await getCatalog();
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery ? catalog.filter((item) => item.title.toLowerCase().includes(normalizedQuery)) : catalog;
}

export function authorizePlayback(episodeId: string): Promise<PlaybackAccess> {
  return request<PlaybackAccess>('/streams/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId }),
  });
}

export function recordPlaybackProgress(
  episodeId: string,
  sessionUid: string,
  watchSeconds: number,
  positionSeconds: number,
  durationSeconds: number | null,
  completed = false,
): Promise<void> {
  return request<void>('/streams/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId, sessionUid, watchSeconds, positionSeconds, durationSeconds, completed, deviceType: analyticsDeviceType() }),
  });
}

export function createCreatorUpload(contentLength: number) {
  return request<{ uploadUrl: string; objectKey: string; contentType: 'video/mp4'; expiresInSeconds: number }>('/creator/uploads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentLength }),
  });
}

export function createCreatorPosterUpload(contentType: string, contentLength: number) {
  return request<{ uploadUrl: string; objectKey: string; contentType: string; expiresInSeconds: number; requiredHeaders?: Record<string, string> }>('/creator/uploads/poster', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType, contentLength }),
  });
}

export function listCreatorSubmissions(): Promise<CreatorSubmission[]> {
  return request<CreatorSubmission[]>('/creator/submissions');
}

export function getCreatorDashboard(): Promise<CreatorDashboard> {
  return request<CreatorDashboard>('/creator/dashboard');
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
  genre: string;
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
  genre: string;
  category: string;
  episodeTitle: string;
  durationSeconds: number;
  mediaKey: string;
  isExclusiveVip: boolean;
}) {
  return request<{ id: string; status: 'IN_REVIEW' }>('/creator/submissions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function calculatePayout(views: number, revenueShare = 0.3) {
  return { views, revenueShare, amount: Number((views * 0.012 * revenueShare).toFixed(2)) };
}

export function getAdPayload(): Promise<AdPayload | null> {
  return request<AdPayload | null>('/ads/next', {
    headers: { 'X-Device-Type': analyticsDeviceType() },
  });
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

export function listAdvertiserCampaigns(): Promise<AdvertiserCampaign[]> {
  return request<AdvertiserCampaign[]>('/advertiser/campaigns');
}

export function createAdvertiserUpload(contentLength: number) {
  return request<{ uploadUrl: string; objectKey: string; contentType: 'video/mp4'; expiresInSeconds: number }>('/advertiser/uploads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentLength }),
  });
}

export function createAdvertiserCampaign(input: {
  campaignName: string;
  creativeKey: string;
  clickThroughUrl: string;
  cpmRate: number;
  totalBudget: number;
  targetTier: 'FREE';
}) {
  return request<{ id: string; status: AdvertiserCampaign['status'] }>('/advertiser/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}
