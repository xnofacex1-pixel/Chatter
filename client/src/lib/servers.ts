import { request, type User } from './api';

/**
 * Community (server) API surface.
 *
 * Every permission decision is made by the server; this module only mirrors the
 * bit flags so the UI can hide controls the account cannot use.
 */
export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  MANAGE_ROLES: 1 << 4,
  MANAGE_SERVER: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  CREATE_INVITES: 1 << 8,
  MANAGE_INVITES: 1 << 9,
  MENTION_EVERYONE: 1 << 10,
  CONNECT: 1 << 11,
  SPEAK: 1 << 12,
  MUTE_MEMBERS: 1 << 13,
  DEAFEN_MEMBERS: 1 << 14,
  MOVE_MEMBERS: 1 << 15,
  PIN_MESSAGES: 1 << 16,
  VIEW_AUDIT_LOG: 1 << 17,
  MANAGE_NICKNAMES: 1 << 18,
  TIMEOUT_MEMBERS: 1 << 19,
  ADMINISTRATOR: 1 << 20,
} as const;

export const has = (permissions: number, bit: number) => (permissions & bit) === bit;

export type ServerRole = {
  id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  isDefault: boolean;
  isSystem: boolean;
};

export type ChannelType = 'text' | 'voice' | 'announcement' | 'forum' | 'media';

export type ServerChannel = {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  categoryId: string | null;
  position: number;
  isPrivate: boolean;
  readOnly: boolean;
  slowmodeSeconds: number;
  userLimit: number;
  conversationId: string | null;
  canView: boolean;
  canSend: boolean;
  canConnect: boolean;
  canManage: boolean;
  unreadCount: number;
};

export type ServerCategory = { id: string; name: string | null; position: number };

export type ServerMember = {
  user: User;
  nickname: string | null;
  joinedAt: string;
  timeoutUntil: string | null;
  roles: ServerRole[];
  isOwner: boolean;
};

export type NotificationLevel = 'all' | 'mentions' | 'none';

export type ServerSummary = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  isPublic: boolean;
  isSuspended: boolean;
  ownerId: string;
  createdAt: string;
  memberCount: number;
  onlineCount: number;
  permissions: number;
  isOwner: boolean;
  isPlatformOwner: boolean;
  joined: boolean;
  myRoles: ServerRole[];
  notificationLevel: NotificationLevel;
};

export type PermissionInfo = { bit: number; label: string; key: string };

export type ServerSettings = {
  welcomeMessage: string | null;
  rules: string | null;
  defaultNotifications: NotificationLevel;
  uploadLimitMb: number;
  slowmodeSeconds: number;
  joinMode: 'open' | 'invite' | 'request';
};

export type ServerDetail = {
  server: ServerSummary;
  permissions: number;
  permissionList: PermissionInfo[];
  member: {
    joinedAt: string;
    nickname: string | null;
    timeoutUntil: string | null;
    roles: ServerRole[];
  };
  roles: ServerRole[];
  categories: ServerCategory[];
  channels: ServerChannel[];
  settings: ServerSettings;
  notificationLevel: NotificationLevel;
  myTopPosition: number;
};

export type ServerInvite = {
  id: string;
  code: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
  creatorId: string;
  revokedAt: string | null;
  url: string;
};

export type InvitePreview = {
  code: string;
  valid: boolean;
  reason: string | null;
  server: { id: string; name: string; iconUrl: string | null; description: string | null; memberCount: number; onlineCount: number };
};

export type ModerationEntry = {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  actorId: string;
  targetId: string | null;
  actorName: string | null;
  targetName: string | null;
};

export const serverApi = {
  list: () => request<{ servers: ServerSummary[] }>('/api/servers'),
  discover: (query = '') =>
    request<{ servers: ServerSummary[] }>(`/api/servers/discover?q=${encodeURIComponent(query)}`),
  create: (input: { name: string; description?: string; isPublic?: boolean }) =>
    request<{ server: ServerSummary }>('/api/servers', { method: 'POST', body: input }),
  get: (id: string) => request<ServerDetail>(`/api/servers/${id}`),
  update: (id: string, input: { name?: string; description?: string | null; isPublic?: boolean }) =>
    request<{ server: ServerSummary }>(`/api/servers/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/servers/${id}`, { method: 'DELETE' }),
  join: (id: string) => request<{ server: ServerSummary }>(`/api/servers/${id}/join`, { method: 'POST', body: {} }),
  leave: (id: string) => request<{ ok: boolean }>(`/api/servers/${id}/leave`, { method: 'POST', body: {} }),
  transfer: (id: string, userId: string) =>
    request<{ server: ServerSummary }>(`/api/servers/${id}/transfer`, { method: 'POST', body: { userId } }),
  setNotifications: (id: string, level: NotificationLevel) =>
    request<{ level: NotificationLevel }>(`/api/servers/${id}/notifications`, { method: 'PATCH', body: { level } }),

  members: (id: string, query = '') =>
    request<{ members: ServerMember[] }>(`/api/servers/${id}/members?q=${encodeURIComponent(query)}`),
  updateMember: (id: string, userId: string, input: { nickname?: string | null; roleIds?: string[] }) =>
    request<{ member: ServerMember }>(`/api/servers/${id}/members/${userId}`, { method: 'PATCH', body: input }),
  kick: (id: string, userId: string, reason?: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/members/${userId}/kick`, { method: 'POST', body: { reason } }),
  ban: (id: string, userId: string, reason?: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/members/${userId}/ban`, { method: 'POST', body: { reason } }),
  unban: (id: string, userId: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/bans/${userId}`, { method: 'DELETE' }),
  timeout: (id: string, userId: string, minutes: number, reason?: string) =>
    request<{ ok: boolean; timeoutUntil: string }>(`/api/servers/${id}/members/${userId}/timeout`, {
      method: 'POST',
      body: { minutes, reason },
    }),
  moderation: (id: string) => request<{ entries: ModerationEntry[] }>(`/api/servers/${id}/moderation`),

  roles: (id: string) => request<{ roles: ServerRole[] }>(`/api/servers/${id}/roles`),
  createRole: (id: string, input: { name: string; color?: string; permissions?: number }) =>
    request<{ role: ServerRole }>(`/api/servers/${id}/roles`, { method: 'POST', body: input }),
  updateRole: (id: string, roleId: string, input: { name?: string; color?: string; permissions?: number }) =>
    request<{ role: ServerRole }>(`/api/servers/${id}/roles/${roleId}`, { method: 'PATCH', body: input }),
  deleteRole: (id: string, roleId: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/roles/${roleId}`, { method: 'DELETE' }),
  reorderRoles: (id: string, ids: string[]) =>
    request<{ roles: ServerRole[] }>(`/api/servers/${id}/roles/order`, { method: 'PATCH', body: { ids } }),

  createCategory: (id: string, name: string) =>
    request<{ category: ServerCategory }>(`/api/servers/${id}/categories`, { method: 'POST', body: { name } }),
  updateCategory: (id: string, categoryId: string, input: { name?: string; position?: number }) =>
    request<{ category: ServerCategory }>(`/api/servers/${id}/categories/${categoryId}`, { method: 'PATCH', body: input }),
  deleteCategory: (id: string, categoryId: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/categories/${categoryId}`, { method: 'DELETE' }),

  createChannel: (
    id: string,
    input: {
      name: string;
      type?: ChannelType;
      categoryId?: string | null;
      topic?: string | null;
      isPrivate?: boolean;
      readOnly?: boolean;
      slowmodeSeconds?: number;
    },
  ) => request<{ channel: ServerChannel }>(`/api/servers/${id}/channels`, { method: 'POST', body: input }),
  updateChannel: (
    id: string,
    channelId: string,
    input: {
      name?: string;
      topic?: string | null;
      categoryId?: string | null;
      isPrivate?: boolean;
      readOnly?: boolean;
      slowmodeSeconds?: number;
      position?: number;
    },
  ) => request<{ channel: ServerChannel }>(`/api/servers/${id}/channels/${channelId}`, { method: 'PATCH', body: input }),
  deleteChannel: (id: string, channelId: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/channels/${channelId}`, { method: 'DELETE' }),
  reorderChannels: (id: string, order: { id: string; position: number; categoryId: string | null }[]) =>
    request<{ ok: boolean }>(`/api/servers/${id}/channels/order`, { method: 'PATCH', body: { items: order } }),
  markChannelRead: (id: string, channelId: string) =>
    request<{ ok: boolean; lastReadAt: string }>(`/api/servers/${id}/channels/${channelId}/read`, { method: 'POST', body: {} }),

  invites: (id: string) => request<{ invites: ServerInvite[] }>(`/api/servers/${id}/invites`),
  createInvite: (id: string, input: { maxUses?: number | null; expiresInHours?: number | null } = {}) =>
    request<{ invite: ServerInvite }>(`/api/servers/${id}/invites`, { method: 'POST', body: input }),
  revokeInvite: (id: string, inviteId: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/invites/${inviteId}`, { method: 'DELETE' }),

  invitePreview: (code: string) => request<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`),
  acceptInvite: (code: string) =>
    request<{ server: ServerSummary }>(`/api/invites/${encodeURIComponent(code)}`, { method: 'POST', body: {} }),

  uploadImage: (id: string, kind: 'icon' | 'banner', file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ server: ServerSummary }>(`/api/servers/${id}/${kind}`, { method: 'POST', formData });
  },
  removeImage: (id: string, kind: 'icon' | 'banner') =>
    request<{ server: ServerSummary }>(`/api/servers/${id}/${kind}`, { method: 'DELETE' }),
};
