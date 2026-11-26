import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, DefaultSidebar } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import {
  IconAt,
  IconBell,
  IconCheck,
  IconClose,
  IconCrown,
  IconGlobe,
  IconHeadphones,
  IconHome,
  IconInfo,
  IconLock,
  IconMail,
  IconMessage,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkle,
  IconTrash,
  IconUpload,
  IconUsers,
  IconWarning,
} from '../components/icons';
import {
  PERMISSION_LABELS,
  STAFF_ROLE_LABELS,
  adminApi,
  formatUptime,
  formatWhen,
  type AdminAccess,
  type AdminChannel,
  type AdminMessage,
  type AdminServer,
  type AdminUser,
  type AppSettings,
  type AuditEntry,
  type OwnerOverview,
  type ReportEntry,
  type StaffMember,
  type StaffPermission,
  type StaffRole,
} from '../lib/admin';
import '../styles/stage5.css';

type Panel =
  | 'overview'
  | 'users'
  | 'servers'
  | 'channels'
  | 'messages'
  | 'staff'
  | 'reports'
  | 'settings'
  | 'audit'
  | 'moderation';

type Section =
  | 'dashboard'
  | 'activity'
  | 'health'
  | 'users'
  | 'servers'
  | 'channels'
  | 'messages'
  | 'reports'
  | 'administrators'
  | 'moderators'
  | 'support'
  | 'permissions'
  | 'announcements'
  | 'notifications'
  | 'registration'
  | 'maintenance'
  | 'application'
  | 'uploads'
  | 'audit'
  | 'moderation'
  | 'security'
  | 'admin-actions';

const PANEL_FOR: Record<Section, Panel> = {
  dashboard: 'overview',
  activity: 'overview',
  health: 'overview',
  users: 'users',
  servers: 'servers',
  channels: 'channels',
  messages: 'messages',
  reports: 'reports',
  administrators: 'staff',
  moderators: 'staff',
  support: 'staff',
  permissions: 'staff',
  announcements: 'settings',
  notifications: 'settings',
  registration: 'settings',
  maintenance: 'settings',
  application: 'settings',
  uploads: 'settings',
  audit: 'audit',
  moderation: 'moderation',
  security: 'audit',
  'admin-actions': 'audit',
};

const STAFF_SECTIONS: Section[] = ['administrators', 'moderators', 'support'];
const ROLE_FOR_SECTION: Partial<Record<Section, StaffRole>> = {
  administrators: 'administrator',
  moderators: 'moderator',
  support: 'support',
};

const navGroups: { label: string; items: { id: Section; label: string; icon: typeof IconHome }[] }[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: IconHome },
      { id: 'activity', label: 'Activity', icon: IconSparkle },
      { id: 'health', label: 'System health', icon: IconInfo },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'users', label: 'Users', icon: IconUsers },
      { id: 'servers', label: 'Servers', icon: IconGlobe },
      { id: 'channels', label: 'Channels', icon: IconAt },
      { id: 'messages', label: 'Messages', icon: IconMessage },
      { id: 'reports', label: 'Reports', icon: IconWarning },
    ],
  },
  {
    label: 'Staff',
    items: [
      { id: 'administrators', label: 'Administrators', icon: IconShield },
      { id: 'moderators', label: 'Moderators', icon: IconUser },
      { id: 'support', label: 'Support staff', icon: IconHeadphones },
      { id: 'permissions', label: 'Staff permissions', icon: IconLock },
    ],
  },
  {
    label: 'Platform',
    items: [
      { id: 'announcements', label: 'Announcements', icon: IconBell },
      { id: 'notifications', label: 'Notifications', icon: IconMail },
      { id: 'registration', label: 'Registration', icon: IconUser },
      { id: 'maintenance', label: 'Maintenance mode', icon: IconWarning },
      { id: 'application', label: 'Application settings', icon: IconSettings },
      { id: 'uploads', label: 'Upload limits', icon: IconUpload },
    ],
  },
  {
    label: 'Security',
    items: [
      { id: 'audit', label: 'Audit logs', icon: IconShield },
      { id: 'moderation', label: 'Moderation history', icon: IconWarning },
      { id: 'security', label: 'Security events', icon: IconLock },
      { id: 'admin-actions', label: 'Administrative actions', icon: IconCrown },
    ],
  },
];

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;

interface ConfirmTarget {
  kind: 'user' | 'server';
  id: string;
  name: string;
  typed: string;
}

export default function OwnerConsole() {
  const { user } = useAuth();
  const toast = useToast();

  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('dashboard');
  const tab = PANEL_FOR[section];

  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userQuery, setUserQuery] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [servers, setServers] = useState<AdminServer[]>([]);
  const [serverQuery, setServerQuery] = useState('');
  const [serversError, setServersError] = useState<string | null>(null);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffPick, setStaffPick] = useState('');
  const [staffResults, setStaffResults] = useState<AdminUser[]>([]);
  const [staffUserId, setStaffUserId] = useState('');
  const [staffRole, setStaffRole] = useState<StaffRole>('moderator');
  const [staffPermissionsDraft, setStaffPermissionsDraft] = useState<StaffPermission[]>(['moderate.users']);
  const [staffError, setStaffError] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [reportStatus, setReportStatus] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open');
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [reportsError, setReportsError] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditError, setAuditError] = useState<string | null>(null);

  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [channelQuery, setChannelQuery] = useState('');
  const [channelsTotal, setChannelsTotal] = useState(0);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [messageQuery, setMessageQuery] = useState('');
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [moderation, setModeration] = useState<PlatformModerationEntry[]>([]);
  const [moderationQuery, setModerationQuery] = useState('');
  const [moderationError, setModerationError] = useState<string | null>(null);

  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .access()
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAccessError(errorMessage(error, 'The owner console could not be verified.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwner = Boolean(access?.owner);

  const loadOverview = useCallback(async () => {
    try {
      setOverviewError(null);
      setOverview(await adminApi.overview());
    } catch (error) {
      setOverviewError(errorMessage(error, 'Dashboard data is unavailable right now.'));
    }
  }, []);

  const loadUsers = useCallback(async (query: string) => {
    try {
      setUsersLoading(true);
      setUsersError(null);
      const result = await adminApi.users(query);
      setUsers(result.users);
      setUserTotal(result.total);
    } catch (error) {
      setUsersError(errorMessage(error, 'Member data is unavailable right now.'));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadServers = useCallback(async (query: string) => {
    try {
      setServersError(null);
      const result = await adminApi.servers(query);
      setServers(result.servers);
    } catch (error) {
      setServersError(errorMessage(error, 'Community data is unavailable right now.'));
    }
  }, []);

  const loadStaff = useCallback(async () => {
    try {
      setStaffError(null);
      const result = await adminApi.staff();
      setStaff(result.staff);
    } catch (error) {
      setStaffError(errorMessage(error, 'Staff data is unavailable right now.'));
    }
  }, []);

  const loadReports = useCallback(async (status: typeof reportStatus) => {
    try {
      setReportsError(null);
      const result = await adminApi.reports(status);
      setReports(result.reports);
    } catch (error) {
      setReportsError(errorMessage(error, 'Reports are unavailable right now.'));
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettingsError(null);
      const result = await adminApi.settings();
      setSettings(result.settings);
      setSettingsDraft(result.settings);
      setEmailConfigured(result.emailConfigured ?? null);
    } catch (error) {
      setSettingsError(errorMessage(error, 'Platform settings are unavailable right now.'));
    }
  }, []);

  const loadAudit = useCallback(async (query: string) => {
    try {
      setAuditError(null);
      const result = await adminApi.audit(query);
      setAudit(result.entries);
    } catch (error) {
      setAuditError(errorMessage(error, 'The audit log is unavailable right now.'));
    }
  }, []);

  const loadChannels = useCallback(async (query: string) => {
    try {
      setChannelsError(null);
      const result = await adminApi.channels(query);
      setChannels(result.channels);
      setChannelsTotal(result.total);
    } catch (error) {
      setChannelsError(errorMessage(error, 'Channel data is unavailable right now.'));
    }
  }, []);

  const loadMessages = useCallback(async (query: string) => {
    try {
      setMessagesError(null);
      const result = await adminApi.messages(query);
      setMessages(result.messages);
      setMessagesTotal(result.total);
    } catch (error) {
      setMessagesError(errorMessage(error, 'Message data is unavailable right now.'));
    }
  }, []);

  const loadModeration = useCallback(async (query: string) => {
    try {
      setModerationError(null);
      const result = await adminApi.moderation(query);
      setModeration(result.entries);
    } catch (error) {
      setModerationError(errorMessage(error, 'Moderation history is unavailable right now.'));
    }
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    if (tab === 'overview') void loadOverview();
    if (tab === 'users') void loadUsers(userQuery);
    if (tab === 'servers') void loadServers(serverQuery);
    if (tab === 'channels') void loadChannels(channelQuery);
    if (tab === 'messages') void loadMessages(messageQuery);
    if (tab === 'staff') void loadStaff();
    if (tab === 'reports') void loadReports(reportStatus);
    if (tab === 'settings') void loadSettings();
    if (tab === 'audit') void loadAudit(auditQuery);
    if (tab === 'moderation') void loadModeration(moderationQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isOwner, reportStatus]);

  const run = async (action: () => Promise<unknown>, success: string, description?: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success, description);
      if (tab === 'overview') await loadOverview();
      if (tab === 'users') await loadUsers(userQuery);
      if (tab === 'servers') await loadServers(serverQuery);
      if (tab === 'channels') await loadChannels(channelQuery);
      if (tab === 'messages') await loadMessages(messageQuery);
      if (tab === 'staff') await loadStaff();
      if (tab === 'reports') await loadReports(reportStatus);
      if (tab === 'audit') await loadAudit(auditQuery);
      if (tab === 'moderation') await loadModeration(moderationQuery);
    } catch (error) {
      toast.error('Action failed', errorMessage(error, 'The action could not be completed.'));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const searchStaffCandidates = async (query: string) => {
    setStaffPick(query);
    if (query.trim().length < 2) {
      setStaffResults([]);
      return;
    }
    try {
      const result = await adminApi.users(query);
      setStaffResults(result.users.filter((entry) => !entry.isOwner).slice(0, 8));
    } catch (error) {
      setStaffError(errorMessage(error, 'Member search failed.'));
    }
  };

  const pendingSettings = useMemo(() => {
    if (!settings || !settingsDraft) return {};
    const patch: Partial<AppSettings> = {};
    for (const key of Object.keys(settingsDraft) as (keyof AppSettings)[]) {
      if (settingsDraft[key] !== settings[key]) {
        if (typeof settingsDraft[key] === 'boolean') {
          (patch as Record<string, unknown>)[key] = settingsDraft[key];
        } else if (typeof settingsDraft[key] === 'number') {
          (patch as Record<string, unknown>)[key] = settingsDraft[key];
        } else {
          (patch as Record<string, unknown>)[key] = settingsDraft[key];
        }
      }
    }
    return patch;
  }, [settings, settingsDraft]);

  const sidebar = <DefaultSidebar active="owner" />;

  if (accessError) {
    return (
      <AppShell title="Owner console" subtitle="Verified owner access only">
        <div className="owner-denied">
          <div className="empty-icon"><IconLock size={26} /></div>
          <h2>Owner access could not be verified</h2>
          <p className="muted">{accessError}</p>
          <Link className="btn btn-primary" to="/">Back to Chatter</Link>
        </div>
      </AppShell>
    );
  }

  if (!access) {
    return (
      <AppShell title="Owner console" subtitle="Verifying owner access">
        <div className="owner-empty">Verifying owner access…</div>
      </AppShell>
    );
  }

  const staffVisible = ROLE_FOR_SECTION[section]
    ? staff.filter((entry) => entry.role === ROLE_FOR_SECTION[section])
    : staff;
  const auditVisible =
    section === 'security-events'
      ? audit.filter((entry) => /login|password|session|owner|verify|blocked/.test(entry.action))
      : section === 'admin-actions'
        ? audit.filter((entry) => entry.action.startsWith('admin.'))
        : audit;
  const staffTitle =
    section === 'administrators'
      ? 'Administrators'
      : section === 'moderators'
        ? 'Moderators'
        : section === 'support'
          ? 'Support staff'
          : 'Current staff';

    return (
      <AppShell title="Owner console" subtitle="Restricted area">
        <div className="owner-denied">
          <div className="empty-icon"><IconLock size={26} /></div>
          <h2>This area is reserved for the Chatter owner</h2>
          <p className="muted">
            Your account does not hold platform owner permissions. Every owner endpoint re-checks this on the server, so the
            console cannot be reached by editing anything in the browser.
          </p>
          <Link className="btn btn-primary" to="/">Back to Chatter</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Owner console"
      subtitle="Founder & Owner administration"
      sidebar={sidebar}
      headActions={<span className="owner-pill warn">Owner only</span>}
    >
      <div className="owner-console">
        <section className="owner-hero">
          <span className="owner-eyebrow">Chatter platform control</span>
          <h1>
            Welcome back, {user?.displayName ?? 'Mason'}
            <OwnerBadge />
          </h1>
          <p>
            {overview
              ? `${overview.stats.totalUsers.toLocaleString()} accounts · ${overview.stats.totalServers.toLocaleString()} communities · ${overview.stats.totalMessages.toLocaleString()} messages`
              : 'Loading platform totals…'}
          </p>
        </section>

        <div className="owner-layout">
          <nav className="owner-nav" aria-label="Owner console sections">
            {navGroups.map((group) => (
              <div key={group.label} className="owner-nav-group">
                <span className="owner-nav-label">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="owner-nav-item"
                      data-active={section === item.id}
                      aria-current={section === item.id ? 'page' : undefined}
                      onClick={() => setSection(item.id)}
                    >
                      <Icon size={16} />
                      <span className="grow">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="owner-content">

        {section === 'dashboard' && (
          <>
            {overviewError && (
              <div className="call-error-inline" role="alert">
                <IconWarning size={15} /> <span className="grow">{overviewError}</span>
              </div>
            )}
            {overview && (
              <>
                <div className="owner-grid">
                  {[
                    ['Total accounts', overview.stats.totalUsers, `${overview.stats.newRegistrations} joined this week`],
                    ['Online now', overview.stats.onlineUsers, `${overview.stats.offlineUsers} offline`],
                    ['Communities', overview.stats.totalServers, `${overview.stats.totalChannels} channels`],
                    ['Messages', overview.stats.totalMessages, 'All conversations'],
                    ['Active calls', overview.stats.activeCalls, 'Voice, video and rooms'],
                    ['Open reports', overview.stats.openReports, `${overview.stats.staffCount} staff on duty`],
                    ['Restricted accounts', overview.stats.bannedUsers + overview.stats.suspendedUsers, 'Banned or suspended'],
                    ['Suspended servers', overview.stats.suspendedServers, 'Under review'],
                  ].map(([label, value, hint]) => (
                    <div key={String(label)} className="owner-stat">
                      <span className="owner-stat-label">{label}</span>
                      <span className="owner-stat-value">{Number(value).toLocaleString()}</span>
                      <span className="owner-stat-hint">{hint}</span>
                    </div>
                  ))}
                </div>

                <div className="owner-panels">
                  <div className="owner-panel">
                    <h3>Recent administrative activity</h3>
                    {overview.recentActivity.length === 0 ? (
                      <div className="owner-empty">No recorded actions yet.</div>
                    ) : (
                      <div className="owner-table-wrap">
                        <table className="owner-table">
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>Administrator</th>
                              <th>When</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overview.recentActivity.map((entry) => (
                              <tr key={entry.id}>
                                <td><span className="owner-audit-action">{entry.action}</span></td>
                                <td>{entry.actor_name ?? entry.actor_username ?? 'System'}</td>
                                <td className="muted">{formatWhen(entry.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="owner-panel">
                    <h3>System health</h3>
                    <div className="owner-health">
                      <div className="owner-health-row">
                        <span>Status</span>
                        <span className="owner-pill ok">{overview.health.status}</span>
                      </div>
                      <div className="owner-health-row">
                        <span>Database</span>
                        <span>{overview.health.database}</span>
                      </div>
                      <div className="owner-health-row">
                        <span>Uptime</span>
                        <span>{formatUptime(overview.health.uptimeSeconds)}</span>
                      </div>
                      <div className="owner-health-row">
                        <span>Memory</span>
                        <span>{overview.health.memoryMb} MB</span>
                      </div>
                      <div className="owner-health-row">
                        <span>Runtime</span>
                        <span>Node {overview.health.node}</span>
                      </div>
                      <div className="owner-health-row">
                        <span>Checked</span>
                        <span>{formatWhen(overview.health.checkedAt)}</span>
                      </div>
                    </div>
                    <h3 style={{ marginTop: 16 }}>Newest accounts</h3>
                    {overview.recentUsers.map((entry) => (
                      <div key={entry.id} className="owner-health-row">
                        <span>{entry.display_name || entry.username}</span>
                        <span className="muted">{formatWhen(entry.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'users' && (
          <div className="owner-panel">
            <div className="owner-toolbar">
              <input
                type="search"
                className="input"
                placeholder="Search username, display name or email"
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadUsers(userQuery);
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadUsers(userQuery)}>
                <IconSearch size={15} /> Search
              </button>
              <span className="muted small">{userTotal.toLocaleString()} accounts</span>
            </div>
            {usersError && <div className="call-error-inline" role="alert"><IconWarning size={15} /> {usersError}</div>}
            {usersLoading ? (
              <div className="owner-empty">Loading accounts…</div>
            ) : (
              <div className="owner-table-wrap">
                <table className="owner-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Status</th>
                      <th>Communities</th>
                      <th>Messages</th>
                      <th>Joined</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((entry) => {
                      const suspended = Boolean(entry.suspendedUntil && entry.suspendedUntil > new Date().toISOString());
                      return (
                        <tr key={entry.id}>
                          <td>
                            <div className="owner-user-cell">
                              <Avatar user={entry} size="sm" />
                              <div>
                                <strong>
                                  {entry.displayName} {entry.isOwner && <OwnerBadge compact />}
                                </strong>
                                <span>@{entry.username}{entry.email ? ` · ${entry.email}` : ''}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            {entry.isOwner && <span className="owner-pill warn">Owner</span>}
                            {!entry.isOwner && entry.isBanned && <span className="owner-pill bad">Banned</span>}
                            {!entry.isOwner && !entry.isBanned && suspended && <span className="owner-pill warn">Suspended</span>}
                            {!entry.isOwner && !entry.isBanned && !suspended && <span className="owner-pill ok">Active</span>}
                          </td>
                          <td>{entry.serverCount}</td>
                          <td>{entry.messageCount}</td>
                          <td className="muted">{formatWhen(entry.createdAt)}</td>
                          <td>
                            <div className="owner-actions">
                              {!entry.isOwner && !suspended && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={busy}
                                  onClick={() => void run(() => adminApi.suspend(entry.id, 24, 'Owner review'), 'Account suspended', timeMessage(entry.username))}
                                >
                                  24h suspend
                                </button>
                              )}
                              {!entry.isOwner && suspended && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={busy}
                                  onClick={() => void run(() => adminApi.unsuspend(entry.id), 'Suspension lifted', entry.username)}
                                >
                                  Unsuspend
                                </button>
                              )}
                              {!entry.isOwner && !entry.isBanned && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={busy}
                                  onClick={() => void run(() => adminApi.ban(entry.id, 'Owner review'), 'Account banned', entry.username)}
                                >
                                  Ban
                                </button>
                              )}
                              {!entry.isOwner && entry.isBanned && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={busy}
                                  onClick={() => void run(() => adminApi.unban(entry.id), 'Ban removed', entry.username)}
                                >
                                  Unban
                                </button>
                              )}
                              {!entry.isOwner && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm call-danger"
                                  onClick={() => setConfirm({ kind: 'user', id: entry.id, name: entry.username, typed: '' })}
                                >
                                  <IconTrash size={14} /> Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {users.length === 0 && <div className="owner-empty">No accounts match that search.</div>}
              </div>
            )}
          </div>
        )}

        {tab === 'servers' && (
          <div className="owner-panel">
            <div className="owner-toolbar">
              <input
                type="search"
                className="input"
                placeholder="Search communities by name"
                value={serverQuery}
                onChange={(event) => setServerQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadServers(serverQuery);
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadServers(serverQuery)}>
                <IconSearch size={15} /> Search
              </button>
            </div>
            {serversError && <div className="call-error-inline" role="alert"><IconWarning size={15} /> {serversError}</div>}
            <div className="owner-table-wrap">
              <table className="owner-table">
                <thead>
                  <tr>
                    <th>Community</th>
                    <th>Owner</th>
                    <th>Members</th>
                    <th>Channels</th>
                    <th>Visibility</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {servers.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <div className="owner-user-cell">
                          <IconGlobe size={16} />
                          <div>
                            <strong>{entry.name}</strong>
                            <span>{entry.description || 'No description'}</span>
                          </div>
                        </div>
                      </td>
                      <td>{entry.owner_name ?? entry.owner_username ?? 'Unknown'}</td>
                      <td>{entry.member_count}</td>
                      <td>{entry.channel_count}</td>
                      <td>
                        <span className={`owner-pill ${entry.is_suspended ? 'bad' : entry.is_public ? 'ok' : ''}`}>
                          {entry.is_suspended ? 'Suspended' : entry.is_public ? 'Public' : 'Private'}
                        </span>
                      </td>
                      <td>
                        <div className="owner-actions">
                          {entry.is_suspended ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => void run(() => adminApi.unsuspendServer(entry.id), 'Community restored', entry.name)}
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => void run(() => adminApi.suspendServer(entry.id, 'Pending platform review'), 'Community suspended', entry.name)}
                            >
                              Suspend
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm call-danger"
                            onClick={() => setConfirm({ kind: 'server', id: entry.id, name: entry.name, typed: '' })}
                          >
                            <IconTrash size={14} /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {servers.length === 0 && <div className="owner-empty">No communities match that search.</div>}
            </div>
          </div>
        )}

        {tab === 'staff' && (
          <>
            <div className="owner-panel">
              <h3>Grant staff access</h3>
              <div className="owner-form">
                <label className="field">
                  <span>Find member</span>
                  <input
                    className="input"
                    placeholder="Search by username"
                    value={staffPick}
                    onChange={(event) => void searchStaffCandidates(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select
                    className="input"
                    value={staffRole}
                    onChange={(event) => setStaffRole(event.target.value as StaffRole)}
                  >
                    {(Object.keys(STAFF_ROLE_LABELS) as StaffRole[]).map((role) => (
                      <option key={role} value={role}>{STAFF_ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                </label>
                <div className="field full">
                  <span>Permissions</span>
                  <div className="owner-checks">
                    {(Object.keys(PERMISSION_LABELS) as StaffPermission[]).map((permission) => (
                      <label key={permission} className="owner-check">
                        <input
                          type="checkbox"
                          checked={staffPermissionsDraft.includes(permission)}
                          onChange={(event) =>
                            setStaffPermissionsDraft((current) =>
                              event.target.checked
                                ? [...current, permission]
                                : current.filter((entry) => entry !== permission),
                            )
                          }
                        />
                        {PERMISSION_LABELS[permission]}
                      </label>
                    ))}
                  </div>
                </div>
                {staffResults.length > 0 && (
                  <div className="field full">
                    <span>Select account</span>
                    <div className="owner-actions">
                      {staffResults.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className={`btn btn-sm ${staffUserId === entry.id ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setStaffUserId(entry.id)}
                        >
                          <IconUsers size={14} /> {entry.displayName} (@{entry.username})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="field full">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !staffUserId}
                    onClick={() =>
                      void run(
                        () => adminApi.grantStaff(staffUserId, staffRole, staffPermissionsDraft),
                        'Staff role saved',
                        `${STAFF_ROLE_LABELS[staffRole]} permissions updated`,
                      )
                    }
                  >
                    <IconShield size={15} /> Save staff role
                  </button>
                  <p className="owner-settings-note">
                    Administrators receive every platform permission. Moderators and support staff receive only the
                    permissions selected above.
                  </p>
                </div>
              </div>
            </div>

            <div className="owner-panel">
              <h3>Current staff</h3>
              {staffError && <div className="call-error-inline" role="alert"><IconWarning size={15} /> {staffError}</div>}
              <div className="owner-table-wrap">
                <table className="owner-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Permissions</th>
                      <th>Granted</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <div className="owner-user-cell">
                            <div>
                              <strong>{entry.displayName}</strong>
                              <span>@{entry.username} · {entry.email}</span>
                            </div>
                          </div>
                        </td>
                        <td><span className="owner-pill warn">{STAFF_ROLE_LABELS[entry.role]}</span></td>
                        <td className="muted">
                          {entry.permissions.length === 0
                            ? entry.role === 'administrator' ? 'All platform permissions' : 'None'
                            : entry.permissions.map((permission) => PERMISSION_LABELS[permission]).join(', ')}
                        </td>
                        <td className="muted">{formatWhen(entry.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm call-danger"
                            disabled={busy}
                            onClick={() => void run(() => adminApi.revokeStaff(entry.id), 'Staff access removed', entry.username)}
                          >
                            <IconClose size={14} /> Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {staff.length === 0 && <div className="owner-empty">No staff members yet. Grant a role above.</div>}
              </div>
            </div>
          </>
        )}

        {tab === 'reports' && (
          <div className="owner-panel">
            <div className="owner-toolbar">
              {(['open', 'resolved', 'dismissed', 'all'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`btn btn-sm ${reportStatus === status ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setReportStatus(status)}
                >
                  {status}
                </button>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadReports(reportStatus)}>
                Refresh
              </button>
            </div>
            {reportsError && <div className="call-error-inline" role="alert"><IconWarning size={15} /> {reportsError}</div>}
            <div style={{ display: 'grid', gap: 10 }}>
              {reports.map((entry) => (
                <div key={entry.id} className="owner-report">
                  <div className="owner-report-head">
                    <strong>
                      {entry.targetType} report · {entry.reason}
                    </strong>
                    <span className={`owner-pill ${entry.status === 'open' ? 'warn' : 'ok'}`}>{entry.status}</span>
                  </div>
                  <p>
                    {entry.reported ? `Reported account: ${entry.reported.name} (@${entry.reported.username})` : 'Reported content'}
                    {entry.serverName ? ` · ${entry.serverName}` : ''}
                  </p>
                  {entry.details && <p className="muted small">{entry.details}</p>}
                  <p className="muted small">
                    Filed by {entry.reporter ? `${entry.reporter.name} (@${entry.reporter.username})` : 'unknown'} ·{' '}
                    {formatWhen(entry.createdAt)}
                  </p>
                  {entry.status === 'open' ? (
                    <div className="owner-actions">
                      <input
                        className="input"
                        placeholder="Resolution note (optional)"
                        value={reportNotes[entry.id] ?? ''}
                        onChange={(event) => setReportNotes((current) => ({ ...current, [entry.id]: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void run(() => adminApi.resolveReport(entry.id, 'resolved', reportNotes[entry.id] ?? ''), 'Report resolved', entry.reason)}
                      >
                        <IconCheck size={14} /> Resolve
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void run(() => adminApi.resolveReport(entry.id, 'dismissed', reportNotes[entry.id] ?? ''), 'Report dismissed', entry.reason)}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    entry.resolutionNote && <p className="muted small">Note: {entry.resolutionNote}</p>
                  )}
                </div>
              ))}
              {reports.length === 0 && <div className="owner-empty">No {reportStatus} reports.</div>}
            </div>
          </div>
        )}

        {tab === 'settings' && settingsDraft && (
          <div className="owner-panel">
            <h3>Platform configuration</h3>
            {settingsError && <div className="call-error-inline" role="alert"><IconWarning size={15} /> {settingsError}</div>}
            <div className="owner-form">
              <label className="field">
                <span>Application name</span>
                <input
                  className="input"
                  value={settingsDraft.appName}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, appName: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Accent colour</span>
                <input
                  className="input"
                  value={settingsDraft.accentColor}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, accentColor: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Upload limit (MB)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={200}
                  value={settingsDraft.uploadLimitMb}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, uploadLimitMb: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field full">
                <span>Platform announcement</span>
                <textarea
                  className="input"
                  rows={3}
                  value={settingsDraft.announcement}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, announcement: event.target.value })}
                />
              </label>
              <div className="field full">
                <span>Controls</span>
                <div className="owner-checks">
                  <label className="owner-check">
                    <input
                      type="checkbox"
                      checked={settingsDraft.registrationOpen}
                      onChange={(event) => setSettingsDraft({ ...settingsDraft, registrationOpen: event.target.checked })}
                    />
                    Registration open
                  </label>
                  <label className="owner-check">
                    <input
                      type="checkbox"
                      checked={settingsDraft.moderationEnabled}
                      onChange={(event) => setSettingsDraft({ ...settingsDraft, moderationEnabled: event.target.checked })}
                    />
                    Moderation enabled
                  </label>
                  <label className="owner-check">
                    <input
                      type="checkbox"
                      checked={settingsDraft.maintenanceMode}
                      onChange={(event) => setSettingsDraft({ ...settingsDraft, maintenanceMode: event.target.checked })}
                    />
                    Maintenance mode
                  </label>
                </div>
              </div>
              <div className="field full">
                <div className="owner-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || Object.keys(pendingSettings).length === 0}
                    onClick={() => void run(() => adminApi.saveSettings(pendingSettings), 'Settings saved', 'Platform configuration updated')}
                  >
                    Save changes
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSettingsDraft(settings)}>
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="owner-panel">
            <div className="owner-toolbar">
              <input
                type="search"
                className="input"
                placeholder="Search actions or administrators"
                value={auditQuery}
                onChange={(event) => setAuditQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadAudit(auditQuery);
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadAudit(auditQuery)}>
                <IconSearch size={15} /> Search
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadAudit('')}>
                <IconBell size={15} /> Latest
              </button>
            </div>
            {auditError && <div className="call-error-inline" role="alert"><IconWarning size={15} /> {auditError}</div>}
            <div className="owner-table-wrap">
              <table className="owner-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Administrator</th>
                    <th>Target</th>
                    <th>IP</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td><span className="owner-audit-action">{entry.action}</span></td>
                      <td>{entry.actorName ?? entry.actorUsername ?? 'System'}</td>
                      <td className="muted">{entry.targetType ? `${entry.targetType} ${entry.targetId ?? ''}` : '—'}</td>
                      <td className="muted">{entry.ip ?? '—'}</td>
                      <td className="muted">{formatWhen(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {audit.length === 0 && <div className="owner-empty">No audit entries recorded yet.</div>}
            </div>
          </div>
        )}

        {confirm && (
          <div className="owner-confirm" role="dialog" aria-label="Confirm destructive action">
            <IconWarning size={16} />
            <span>
              Type <strong>{confirm.name}</strong> to permanently delete this {confirm.kind === 'user' ? 'account' : 'community'}.
            </span>
            <input
              className="input"
              value={confirm.typed}
              onChange={(event) => setConfirm({ ...confirm, typed: event.target.value })}
              aria-label="Confirmation name"
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm call-danger"
              disabled={busy || confirm.typed !== confirm.name}
              onClick={() =>
                void run(
                  () =>
                    confirm.kind === 'user'
                      ? adminApi.deleteUser(confirm.id, confirm.typed)
                      : adminApi.deleteServer(confirm.id, confirm.typed),
                  confirm.kind === 'user' ? 'Account deleted' : 'Community removed',
                  confirm.name,
                )
              }
            >
              Confirm delete
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function timeMessage(username: string) {
  return `${username} is suspended for 24 hours`;
}
