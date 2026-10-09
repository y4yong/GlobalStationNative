import { DramaItem, UserRole } from '../data/models/Drama';
import { createSessionFingerprint, readSession, saveSession } from '../core/security/sessionStorage';

const API_BASE_URL = 'http://10.0.2.2:5000/api/v1';

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

export async function registerViewer(name: string, email: string, password: string, role: UserRole = 'VIEWER'): Promise<ViewerProfile> {
  const session = await request<SessionResponse>('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, role }),
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

export interface AdvertiserCampaign {
  id: string;
  campaignName: string;
  creativeVideoUrl: string;
  clickThroughUrl: string;
  cpmRate: string;
  totalBudget: string;
  remainingBudget: string;
  targetTier: 'ALL' | 'FREE' | 'VIP';
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  impressions: number;
}

export async function getCatalog(): Promise<DramaItem[]> {
  const catalog = await request<DramaItem[]>('/dramas');
  return catalog.filter((item) => !!item && typeof item.id === 'string' && item.id.trim().length > 0);
}

export async function getContinueWatching(): Promise<ContinueWatchingItem[]> {
  const history = await request<ContinueWatchingItem[]>('/watch-history');
  return history.filter((item) => !!item && typeof item.episodeId === 'string' && item.episodeId.trim().length > 0);
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

export function recordPlaybackProgress(episodeId: string, sessionUid: string, watchSeconds: number): Promise<void> {
  return request<void>('/streams/progress', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId, sessionUid, watchSeconds }),
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
  return request<AdPayload>('/ads/next');
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
  targetTier: AdvertiserCampaign['targetTier'];
}) {
  return request<{ id: string; status: AdvertiserCampaign['status'] }>('/advertiser/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}
