export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

export type User = {
  id: string;
  username: string;
  displayName: string;
  title: string | null;
  isOwner: boolean;
  presence: Presence;
  status: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
  customStatus: string | null;
  aboutMe: string | null;
  pronouns: string | null;
  accentColor: string;
  bannerColor: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  emailVerified: boolean;
  email?: string;
  isBanned?: boolean;
};

export type AccentName = 'cyan' | 'blue' | 'violet' | 'emerald' | 'rose' | 'amber';

export type Settings = {
  theme: 'dark' | 'light';
  accent: AccentName;
  reducedMotion: boolean;
  compactMode: boolean;
  textScale: number;
  messageDisplay: 'cozy' | 'compact';
  dmPrivacy: 'everyone' | 'friends' | 'none';
  friendRequestPrivacy: 'everyone' | 'friends' | 'none';
  presenceVisibility: 'everyone' | 'friends' | 'nobody';
  readReceipts: boolean;
  notifications: {
    desktop: boolean;
    sounds: boolean;
    mentions: boolean;
    messages: boolean;
    calls: boolean;
  };
};

export type SessionInfo = {
  id: string;
  device: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

export type PlatformStats = {
  totalUsers: number;
  onlineUsers: number;
  offlineUsers: number;
  verifiedUsers: number;
  newThisWeek: number;
  owners: number;
  serverTime: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  fields: { field: string; message: string }[];

  constructor(status: number, code: string, message: string, fields: { field: string; message: string }[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal } = options;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;

  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch {
    throw new ApiError(0, 'network_error', 'Chatter could not reach the server. Check your connection and try again.');
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; fields?: { field: string; message: string }[] } })?.error;
    throw new ApiError(
      response.status,
      error?.code || 'request_failed',
      error?.message || 'Something went wrong. Please try again.',
      error?.fields || [],
    );
  }
  return data as T;
}

export const api = {
  health: () => request<{ status: string; database: string; mailConfigured: boolean }>('/api/health'),

  session: () => request<{ user: User | null; settings: Settings | null }>('/api/auth/session'),
  register: (input: { email: string; username: string; displayName?: string; password: string }) =>
    request<{ user: User; settings: Settings; verification: { emailSent: boolean; emailConfigured: boolean; verificationUrl?: string } }>(
      '/api/auth/register',
      { method: 'POST', body: input },
    ),
  login: (input: { identifier: string; password: string }) =>
    request<{ user: User; settings: Settings }>('/api/auth/login', { method: 'POST', body: input }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  verifyEmail: (token: string) =>
    request<{ ok: boolean; user: User; settings: Settings }>('/api/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: () =>
    request<{ ok: boolean; alreadyVerified: boolean; emailSent: boolean; emailConfigured: boolean; verificationUrl?: string }>(
      '/api/auth/resend-verification',
      { method: 'POST' },
    ),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; emailSent: boolean; emailConfigured: boolean; resetUrl?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>('/api/auth/reset-password', { method: 'POST', body: { token, password } }),
  sessions: () => request<{ sessions: SessionInfo[] }>('/api/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: boolean; signedOut: boolean }>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () => request<{ ok: boolean }>('/api/auth/sessions/revoke-others', { method: 'POST' }),

  me: () => request<{ user: User; settings: Settings }>('/api/me'),
  updateAccount: (input: { username?: string; displayName?: string; email?: string }) =>
    request<{ user: User; settings: Settings }>('/api/me/account', { method: 'PATCH', body: input }),
  updateProfile: (input: {
    customStatus?: string | null;
    aboutMe?: string | null;
    pronouns?: string | null;
    accentColor?: string;
    bannerColor?: string;
  }) => request<{ user: User }>('/api/me/profile', { method: 'PATCH', body: input }),
  updatePresence: (status: 'online' | 'idle' | 'dnd' | 'invisible') =>
    request<{ user: User }>('/api/me/presence', { method: 'PATCH', body: { status } }),
  updateSettings: (input: Partial<Settings>) =>
    request<{ settings: Settings }>('/api/me/settings', { method: 'PATCH', body: input }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/me/password', { method: 'POST', body: { currentPassword, newPassword } }),
  uploadImage: (kind: 'avatar' | 'banner', file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ user: User }>(`/api/me/${kind}`, { method: 'POST', formData });
  },
  removeImage: (kind: 'avatar' | 'banner') => request<{ user: User }>(`/api/me/${kind}`, { method: 'DELETE' }),
  deleteAccount: (password: string) =>
    request<{ ok: boolean }>('/api/me', { method: 'DELETE', body: { password, confirm: 'DELETE' } }),
  heartbeat: () => request<{ ok: boolean }>('/api/me/heartbeat', { method: 'POST' }),

  users: (query = '', limit = 40) =>
    request<{ users: User[]; total: number; query: string }>(
      `/api/users?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  user: (username: string) =>
    request<{ user: User; memberSince: string; viewerIsSelf: boolean }>(`/api/users/${encodeURIComponent(username)}`),
  stats: () => request<{ stats: PlatformStats; recentMembers: User[] }>('/api/stats'),
};
