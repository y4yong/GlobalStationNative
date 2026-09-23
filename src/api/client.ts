import { DramaItem, UserRole } from '../data/models/Drama';

const API_BASE_URL = 'http://10.0.2.2:5000/api/v1';
const MOCK_STREAM_URL = 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('API base URL is not configured');
  }
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export interface StreamTokenResponse {
  manifestUrl: string;
  token: string;
  expiresAt: string;
}

export interface AdPayload {
  id: string;
  title: string;
  clickThroughUrl: string;
  durationSeconds: number;
}

export async function getCatalog(): Promise<DramaItem[]> {
  return request<DramaItem[]>('/dramas');
}

export async function searchCatalog(query: string): Promise<DramaItem[]> {
  const catalog = await getCatalog();
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery ? catalog.filter((item) => item.title.toLowerCase().includes(normalizedQuery)) : catalog;
}

export async function getStreamToken(episodeId: string, role: UserRole = 'VIEWER'): Promise<StreamTokenResponse> {
  try {
    return await request<StreamTokenResponse>('/streams/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episodeId, role }),
    });
  } catch {
    return {
      manifestUrl: MOCK_STREAM_URL,
      token: `mock-stream-token-${episodeId}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
}

export async function submitCreatorContent(payload: { title: string; episodeId: string; mediaUrl: string }) {
  return request<{ id: string; status: 'IN_REVIEW' }>('/creator/submissions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function calculatePayout(views: number, revenueShare = 0.3) {
  return { views, revenueShare, amount: Number((views * 0.012 * revenueShare).toFixed(2)) };
}

export async function getAdPayload(): Promise<AdPayload> {
  try {
    return await request<AdPayload>('/ads/next');
  } catch {
    return { id: 'ev-launch-q3', title: 'Clean Energy EV Launch - Q3', clickThroughUrl: 'https://globalstation.example/ads/ev-launch', durationSeconds: 12 };
  }
}
