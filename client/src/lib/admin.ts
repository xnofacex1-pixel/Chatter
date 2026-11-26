import { request as apiRequest, type User } from './api';

type RequestOptions = NonNullable<Parameters<typeof apiRequest>[1]>;

// Admin routes are mounted at /api/admin on the server; apiRequest sends the path verbatim,
// so every admin call needs the /api prefix or the SPA fallback answers with HTML.
const request = <T,>(path: string, options?: RequestOptions): Promise<T> => apiRequest<T>(`/api${path}`, options);

export type StaffRole = 'administrator' | 'moderator' | 'support';

export type StaffPermission =
  | 'moderate.users'
  | 'moderate.messages'
  | 'manage.servers'
  | 'view.reports'
  | 'view.audit'
  | 'support.tickets';

export interface AdminUser extends User {
  email?: string;
  serverCount: number;
  messageCount: number;
  openReports: number;
  isBanned: boolean;
  bannedReason: string | null;
  suspendedUntil: string | null;
  suspendedReason: string | null;
}

export interface AdminServer {
  id: string;
  name: string;
  description: string | null;
  is_public: number;
  is_suspended: number;
  created_at: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_username: string | null;
  member_count: number;
  channel_count: number;
}

export interface StaffMember {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: StaffRole;
  permissions: StaffPermission[];
  grantedBy: string | null;
  createdAt: string;
}

export interface ModerationEntry {
  id: string;
  action: string;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
  actor_name: string | null;
}

export interface ReportEntry {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporter: { name: string; username: string } | null;
  reported: { name: string; username: string } | null;
  serverName: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorName: string | null;
  actorUsername: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminChannel {
  id: string;
  name: string;
  type: string;
  topic: string | null;
  isPrivate: boolean;
  readOnly: boolean;
  slowmodeSeconds: number;
  createdAt: string;
  serverId: string;
  serverName: string;
  serverSuspended: boolean;
  categoryName: string | null;
  messageCount: number;
}

export interface AdminMessage {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  pinned: boolean;
  authorId: string | null;
  authorName: string | null;
  authorUsername: string | null;
  kind: string;
  title: string | null;
  channelName: string | null;
  serverName: string | null;
  attachmentCount: number;
  reactionCount: number;
}

export interface PlatformModerationEntry {
  id: string;
  action: string;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  actorName: string | null;
  actorUsername: string | null;
  targetId: string | null;
  targetName: string | null;
  targetUsername: string | null;
}

export interface AppSettings {
  appName: string;
  announcement: string;
  registrationOpen: boolean;
  maintenanceMode: boolean;
  uploadLimitMb: number;
  moderationEnabled: boolean;
  accentColor: string;
}

export interface OwnerOverview {
  stats: {
    totalUsers: number;
    onlineUsers: number;
    offlineUsers: number;
    totalServers: number;
    suspendedServers: number;
    totalChannels: number;
    totalMessages: number;
    activeCalls: number;
    newRegistrations: number;
    bannedUsers: number;
    suspendedUsers: number;
    openReports: number;
    staffCount: number;
  };
  recentActivity: {
    id: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    created_at: string;
    actor_name: string | null;
    actor_username: string | null;
  }[];
  recentUsers: { id: string; username: string; display_name: string; created_at: string; email_verified_at: string | null }[];
  health: {
    status: string;
    uptimeSeconds: number;
    memoryMb: number;
    node: string;
    database: string;
    checkedAt: string;
  };
  settings: AppSettings;
}

export interface AdminAccess {
  owner: boolean;
  permissions: StaffPermission[];
  roles: StaffRole[];
  available: StaffPermission[];
}

export const adminApi = {
  access: () => request<AdminAccess>('/admin/access'),
  overview: () => request<OwnerOverview>('/admin/overview'),
  users: (query = '', limit = 25, offset = 0) =>
    request<{ total: number; users: AdminUser[] }>(
      `/admin/users?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
    ),
  user: (id: string) =>
    request<{
      user: AdminUser;
      servers: { id: string; name: string; is_suspended: number; role: string }[];
      reports: { id: string; reason: string; details: string | null; status: string; created_at: string }[];
      moderation: ModerationEntry[];
      counts: { messages: number; friends: number };
    }>(`/admin/users/${id}`),
  suspend: (id: string, hours: number, reason: string) =>
    request<{ ok: boolean; suspendedUntil: string }>(`/admin/users/${id}/suspend`, {
      method: 'POST',
      body: { hours, reason },
    }),
  unsuspend: (id: string) => request<{ ok: boolean }>(`/admin/users/${id}/unsuspend`, { method: 'POST', body: {} }),
  ban: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/admin/users/${id}/ban`, { method: 'POST', body: { reason } }),
  unban: (id: string) => request<{ ok: boolean }>(`/admin/users/${id}/unban`, { method: 'POST', body: {} }),
  deleteUser: (id: string, confirm: string) =>
    request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE', body: { confirm } }),
  servers: (query = '') =>
    request<{ total: number; servers: AdminServer[] }>(`/admin/servers?query=${encodeURIComponent(query)}`),
  suspendServer: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/admin/servers/${id}/suspend`, { method: 'POST', body: { reason } }),
  unsuspendServer: (id: string) =>
    request<{ ok: boolean }>(`/admin/servers/${id}/unsuspend`, { method: 'POST', body: {} }),
  deleteServer: (id: string, confirm: string) =>
    request<{ ok: boolean }>(`/admin/servers/${id}`, { method: 'DELETE', body: { confirm } }),
  staff: () => request<{ staff: StaffMember[]; roles: StaffRole[]; available: StaffPermission[] }>('/admin/staff'),
  grantStaff: (userId: string, role: StaffRole, permissions: StaffPermission[]) =>
    request<{ ok: boolean }>('/admin/staff', { method: 'POST', body: { userId, role, permissions } }),
  revokeStaff: (id: string) => request<{ ok: boolean }>(`/admin/staff/${id}`, { method: 'DELETE' }),
  reports: (status = 'open') => request<{ reports: ReportEntry[] }>(`/admin/reports?status=${status}`),
  resolveReport: (id: string, status: 'resolved' | 'dismissed', note: string) =>
    request<{ ok: boolean }>(`/admin/reports/${id}/resolve`, { method: 'POST', body: { status, note } }),
  channels: (query = '') =>
    request<{ total: number; channels: AdminChannel[] }>(`/admin/channels?query=${encodeURIComponent(query)}`),
  messages: (query = '') =>
    request<{ total: number; messages: AdminMessage[] }>(`/admin/messages?query=${encodeURIComponent(query)}`),
  moderation: (query = '') =>
    request<{ entries: PlatformModerationEntry[] }>(`/admin/moderation?query=${encodeURIComponent(query)}`),
  settings: () => request<{ settings: AppSettings; emailConfigured?: boolean }>('/admin/settings'),
  saveSettings: (patch: Partial<AppSettings>) =>
    request<{ ok: boolean; settings: AppSettings }>('/admin/settings', { method: 'PATCH', body: patch }),
  audit: (query = '', limit = 60) =>
    request<{ entries: AuditEntry[] }>(`/admin/audit?query=${encodeURIComponent(query)}&limit=${limit}`),
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  administrator: 'Administrator',
  moderator: 'Moderator',
  support: 'Support staff',
};

export const PERMISSION_LABELS: Record<StaffPermission, string> = {
  'moderate.users': 'Moderate members',
  'moderate.messages': 'Moderate messages',
  'manage.servers': 'Manage communities',
  'view.reports': 'Review reports',
  'view.audit': 'View audit log',
  'support.tickets': 'Manage support tickets',
};

export const formatWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};
