const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/v1';

function getAdminUploadUrl(uploadUrl: string) {
  const upload = new URL(uploadUrl);
  const api = new URL(API_URL);
  if (upload.pathname.startsWith('/api/v1/media/local/') && upload.hostname === '10.0.2.2' && ['localhost', '127.0.0.1'].includes(api.hostname)) {
    upload.protocol = api.protocol;
    upload.host = api.host;
  }
  return upload.toString();
}

export interface Session { token: string; role: string; expiresAt: string }

export interface AnalyticsData {
  summary: Record<string, number | string>;
  daily: Array<{ day: string; viewers: number; watchSeconds: number; sessions: number }>;
  programmes: Array<{ id: string; title: string; sessions: number; viewers: number; watchSeconds: number; completionRate: number; dropoffPercent: number }>;
  devices: Array<{ device: string; viewers: number; sessions: number; watchSeconds: number }>;
  geography: Array<{ country: string; latitude: number | null; longitude: number | null; viewers: number; sessions: number }>;
  advertising: Array<{ id: string; campaignName: string; impressions: number; completions: number; clicks: number; clickThroughRate: number; completionRate: number; revenue: string }>;
  churn: Array<{ userId: string; name: string; email: string; planCode: string; reason: string; occurredAt: string }>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('gs_admin_token');
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? 'Request failed');
  }
  return response.json() as Promise<T>;
}

export async function login(email: string, password: string) {
  const session = await request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (session.role !== 'ADMIN') throw new Error('This account does not have administrator access.');
  localStorage.setItem('gs_admin_token', session.token);
  return session;
}

export const api = {
  overview: () => request<any>('/admin/overview'),
  content: (status = 'ALL') => request<any[]>(`/admin/content?status=${encodeURIComponent(status)}`),
  contentDetail: (id: string) => request<any>(`/admin/content/${encodeURIComponent(id)}`),
  users: (filters: { search?: string; role?: string; plan?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return request<any[]>(`/admin/users${query.size ? `?${query}` : ''}`);
  },
  userPlan: (id: string, plan: string, confirmation = '') => request<any>(`/admin/users/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan, confirmation }) }),
  campaigns: () => request<any[]>('/admin/campaigns'),
  payouts: () => request<any[]>('/admin/payouts'),
  telemetry: () => request<any[]>('/admin/telemetry'),
  analytics: () => request<AnalyticsData>('/admin/analytics'),
  supportTickets: () => request<any[]>('/admin/support'),
  contentStatus: (id: string, status: string) => request<any>(`/admin/content/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  contentArchive: (id: string, archived: boolean) => request<any>(`/admin/content/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
  deleteContent: (id: string) => request<any>(`/admin/content/${id}`, { method: 'DELETE' }),
  createContent: (payload: unknown) => request<any>('/admin/content', { method: 'POST', body: JSON.stringify(payload) }),
  campaignStatus: (id: string, status: string) => request<any>(`/admin/campaigns/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  payoutStatus: (id: string, status: string) => request<any>(`/admin/payouts/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  supportStatus: (id: string, status: string) => request<any>(`/admin/support/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createMediaUpload: (purpose: 'poster' | 'media', file: File) => request<{ uploadUrl: string; objectKey: string; contentType: string; requiredHeaders: Record<string, string>; maximumBytes: number }>('/admin/media/uploads', {
    method: 'POST', body: JSON.stringify({ purpose, contentType: file.type, contentLength: file.size }),
  }),
  uploadMediaFile: async (purpose: 'poster' | 'media', file: File) => {
    const upload = await api.createMediaUpload(purpose, file);
    const uploadUrl = getAdminUploadUrl(upload.uploadUrl);
    let response: Response;
    try {
      response = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': upload.contentType, ...upload.requiredHeaders }, body: file });
    } catch {
      throw new Error(`Could not reach the media upload service at ${new URL(uploadUrl).host}. Confirm the API is running and try again.`);
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message ?? `File upload failed (${response.status}).`);
    }
    return upload.objectKey;
  },
};
