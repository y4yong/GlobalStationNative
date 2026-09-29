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

export async function registerViewer(name: string, email: string, password: string): Promise<ViewerProfile> {
  const session = await request<SessionResponse>('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }),
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
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  episodeCount: number;
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
  return request<DramaItem[]>('/dramas');
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

export function createCreatorUpload(contentLength: number) {
  return request<{ uploadUrl: string; objectKey: string; contentType: 'video/mp4'; expiresInSeconds: number }>('/creator/uploads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentLength }),
  });
}

export function listCreatorSubmissions(): Promise<CreatorSubmission[]> {
  return request<CreatorSubmission[]>('/creator/submissions');
}

export function submitCreatorContent(payload: {
  title: string;
  contentType: 'MOVIE' | 'SERIES';
  description: string;
  posterUrl: string;
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

export function createAdvertiserCampaign(input: {
  campaignName: string;
  creativeVideoUrl: string;
  clickThroughUrl: string;
  cpmRate: number;
  totalBudget: number;
  targetTier: AdvertiserCampaign['targetTier'];
}) {
  return request<{ id: string; status: AdvertiserCampaign['status'] }>('/advertiser/campaigns', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}
