const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/v1';

export interface Session { token: string; role: string; expiresAt: string }

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
  users: (filters: { search?: string; role?: string; plan?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return request<any[]>(`/admin/users${query.size ? `?${query}` : ''}`);
  },
  userPlan: (id: string, plan: string, confirmation = '') => request<any>(`/admin/users/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan, confirmation }) }),
  campaigns: () => request<any[]>('/admin/campaigns'),
  payouts: () => request<any[]>('/admin/payouts'),
  telemetry: () => request<any[]>('/admin/telemetry'),
  supportTickets: () => request<any[]>('/admin/support'),
  contentStatus: (id: string, status: string) => request<any>(`/admin/content/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createContent: (payload: unknown) => request<any>('/admin/content', { method: 'POST', body: JSON.stringify(payload) }),
  campaignStatus: (id: string, status: string) => request<any>(`/admin/campaigns/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  payoutStatus: (id: string, status: string) => request<any>(`/admin/payouts/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  supportStatus: (id: string, status: string) => request<any>(`/admin/support/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createMediaUpload: (purpose: 'poster' | 'media', file: File) => request<{ uploadUrl: string; objectKey: string; contentType: string; requiredHeaders: Record<string, string>; maximumBytes: number }>('/admin/media/uploads', {
    method: 'POST', body: JSON.stringify({ purpose, contentType: file.type, contentLength: file.size }),
  }),
  uploadMediaFile: async (purpose: 'poster' | 'media', file: File) => {
    const upload = await api.createMediaUpload(purpose, file);
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': upload.contentType, ...upload.requiredHeaders }, body: file });
    if (!response.ok) throw new Error(`File upload failed (${response.status}). Check the S3 bucket CORS configuration.`);
    return upload.objectKey;
  },
};
