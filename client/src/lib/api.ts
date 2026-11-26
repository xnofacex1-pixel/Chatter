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

export type AttachmentUpload = {
  id: string;
  url: string;
  mime: string;
  byteSize: number;
  kind: string;
};

export type MessageReaction = { emoji: string; count: number; me: boolean };

export type Message = {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  author: User | null;
  attachments: AttachmentUpload[];
  reactions: MessageReaction[];
  replyTo: { id: string; body: string; authorName: string } | null;
};

export type MessagePreview = {
  id: string;
  body: string;
  createdAt: string;
  deleted: boolean;
  authorName: string;
  authorId: string | null;
} | null;

export type Conversation = {
  id: string;
  kind: 'dm' | 'group';
  title: string | null;
  iconUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  muted: boolean;
  archived: boolean;
  unreadCount: number;
  memberCount: number;
  members: User[];
  partner: User | null;
  lastMessage: MessagePreview;
};

export type ConversationMember = {
  user: User;
  role: 'owner' | 'member';
  joinedAt: string;
  muted: boolean;
  lastReadAt: string | null;
};

export type FriendRequestItem = {
  id: string;
  message: string | null;
  createdAt: string;
  direction: 'incoming' | 'outgoing';
  user: User | null;
};

export type FriendsPayload = {
  friends: User[];
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
  blocked: { user: User; createdAt: string }[];
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

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

export type AiStatus = {
  provider: 'groq';
  configured: boolean;
  model: string;
  defaultModel: string;
  streaming: boolean;
  limits: { maxContent: number; maxHistory: number; maxConversations: number };
};

export type AiConversation = {
  id: string;
  title: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string | null;
};

export type AiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export const api = {
  health: () =>
    request<{ status: string; database: string; mailConfigured: boolean; aiConfigured?: boolean; aiProvider?: string }>(
      '/api/health',
    ),

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

  friends: () => request<FriendsPayload>('/api/friends'),
  sendFriendRequest: (input: { userId?: string; username?: string; message?: string }) =>
    request<{ request?: FriendRequestItem; autoAccepted?: boolean; friend?: User }>('/api/friends/requests', {
      method: 'POST',
      body: input,
    }),
  acceptFriendRequest: (id: string) =>
    request<{ ok: boolean; friend: User }>(`/api/friends/requests/${id}/accept`, { method: 'POST' }),
  declineFriendRequest: (id: string) =>
    request<{ ok: boolean }>(`/api/friends/requests/${id}/decline`, { method: 'POST' }),
  cancelFriendRequest: (id: string) => request<{ ok: boolean }>(`/api/friends/requests/${id}`, { method: 'DELETE' }),
  removeFriend: (userId: string) => request<{ ok: boolean }>(`/api/friends/${userId}`, { method: 'DELETE' }),
  blockUser: (userId: string) =>
    request<{ ok: boolean; blocked: boolean }>(`/api/friends/block/${userId}`, { method: 'POST' }),
  unblockUser: (userId: string) => request<{ ok: boolean }>(`/api/friends/block/${userId}`, { method: 'DELETE' }),

  conversations: () => request<{ conversations: Conversation[]; totalUnread: number }>('/api/conversations'),
  conversation: (id: string) =>
    request<{ conversation: Conversation; members: ConversationMember[] }>(`/api/conversations/${id}`),
  createConversation: (input: { kind: 'dm' | 'group'; userIds: string[]; title?: string }) =>
    request<{ conversation: Conversation; existed: boolean }>('/api/conversations', { method: 'POST', body: input }),
  updateConversation: (id: string, input: { title?: string }) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}`, { method: 'PATCH', body: input }),
  addConversationMembers: (id: string, userIds: string[]) =>
    request<{ added: string[]; conversation: Conversation }>(`/api/conversations/${id}/members`, {
      method: 'POST',
      body: { userIds },
    }),
  removeConversationMember: (id: string, userId: string) =>
    request<{ ok: boolean }>(`/api/conversations/${id}/members/${userId}`, { method: 'DELETE' }),
  leaveConversation: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}/leave`, { method: 'POST' }),
  conversationPreferences: (id: string, input: { muted?: boolean; archived?: boolean }) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/preferences`, { method: 'PATCH', body: input }),

  messages: (id: string, params: { before?: string; beforeId?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.before) search.set('before', params.before);
    if (params.beforeId) search.set('beforeId', params.beforeId);
    if (params.limit) search.set('limit', String(params.limit));
    const query = search.toString();
    return request<{ messages: Message[]; hasMore: boolean }>(
      `/api/conversations/${id}/messages${query ? `?${query}` : ''}`,
    );
  },
  sendMessage: (id: string, input: { body?: string; attachmentIds?: string[]; replyToId?: string | null }) =>
    request<{ message: Message }>(`/api/conversations/${id}/messages`, { method: 'POST', body: input }),
  editMessage: (id: string, messageId: string, body: string) =>
    request<{ message: Message }>(`/api/conversations/${id}/messages/${messageId}`, {
      method: 'PATCH',
      body: { body },
    }),
  deleteMessage: (id: string, messageId: string) =>
    request<{ ok: boolean; messageId: string }>(`/api/conversations/${id}/messages/${messageId}`, { method: 'DELETE' }),
  reactToMessage: (id: string, messageId: string, emoji: string) =>
    request<{ message: Message }>(`/api/conversations/${id}/messages/${messageId}/reactions`, {
      method: 'POST',
      body: { emoji },
    }),
  pinMessage: (id: string, messageId: string) =>
    request<{ message: Message; pinned: boolean }>(`/api/conversations/${id}/messages/${messageId}/pin`, {
      method: 'POST',
    }),
  pins: (id: string) => request<{ messages: Message[] }>(`/api/conversations/${id}/pins`),
  markRead: (id: string, messageId?: string) =>
    request<{ ok: boolean; lastReadAt: string }>(`/api/conversations/${id}/read`, {
      method: 'POST',
      body: { messageId },
    }),
  setTyping: (id: string, typing: boolean) =>
    request<{ ok: boolean }>(`/api/conversations/${id}/typing`, { method: 'POST', body: { typing } }),
  searchMessages: (query: string) =>
    request<{ results: { message: Message; conversation: Conversation }[] }>(
      `/api/messages/search?q=${encodeURIComponent(query)}`,
    ),
  uploadAttachment: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ attachment: AttachmentUpload }>('/api/attachments', { method: 'POST', formData });
  },

  ai: {
    status: () => request<AiStatus>('/api/ai/status'),
    conversations: () => request<{ conversations: AiConversation[] }>('/api/ai/conversations'),
    createConversation: (title?: string) =>
      request<{ conversation: AiConversation }>('/api/ai/conversations', { method: 'POST', body: { title } }),
    conversation: (id: string) =>
      request<{ conversation: AiConversation; messages: AiMessage[] }>(`/api/ai/conversations/${id}`),
    deleteConversation: (id: string) =>
      request<{ ok: boolean }>(`/api/ai/conversations/${id}`, { method: 'DELETE' }),
  },
};
