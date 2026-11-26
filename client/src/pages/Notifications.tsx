import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, DefaultSidebar } from '../components/AppShell';
import { Avatar } from '../components/Avatar';
import { InstallPrompt } from '../components/InstallPrompt';
import { useToast } from '../components/Toast';
import { IconBell, IconCheck, IconClose, IconSettings } from '../components/icons';
import { useAuth } from '../lib/auth';
import {
  NOTIFICATION_LABELS,
  NOTIFICATION_TONES,
  notificationsApi,
  playNotificationSound,
  shortWhen,
  showDesktopNotification,
  type AppNotification,
} from '../lib/notifications';
import { useRealtime } from '../lib/realtime';
import '../styles/stage6.css';

type FilterId = 'all' | 'unread' | 'messages' | 'social' | 'calls' | 'system';

const FILTERS: { id: FilterId; label: string; types: string[] | null }[] = [
  { id: 'all', label: 'All', types: null },
  { id: 'unread', label: 'Unread', types: null },
  { id: 'messages', label: 'Messages', types: ['message', 'mention', 'reply', 'reaction'] },
  { id: 'social', label: 'Friends', types: ['friend_request', 'friend_accepted', 'server_invite'] },
  { id: 'calls', label: 'Calls', types: ['call_incoming', 'call_missed'] },
  { id: 'system', label: 'System', types: ['moderation', 'announcement'] },
];

const matches = (entry: AppNotification, filter: FilterId) => {
  if (filter === 'all') return true;
  if (filter === 'unread') return !entry.readAt;
  const types = FILTERS.find((item) => item.id === filter)?.types ?? null;
  return types ? types.includes(entry.type) : true;
};

export default function Notifications() {
  const { settings } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<FilterId>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );

  const prefs = settings?.notifications;

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const result = await notificationsApi.list(80);
        setItems(result.notifications);
        setUnread(result.unread);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Notifications could not be loaded.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live delivery: the SSE stream carries a lightweight 'notification' event and
  // the authoritative list is re-read, so nothing is duplicated or invented.
  useRealtime((event, data) => {
    if (event !== 'notification') return;
    void load(true);
    if (data && prefs?.sounds) playNotificationSound();
    if (data && prefs?.desktop && typeof data === 'object') {
      showDesktopNotification(data as unknown as AppNotification, { sounds: Boolean(prefs.sounds) });
    }
  });

  const visible = useMemo(() => items.filter((entry) => matches(entry, filter)), [items, filter]);

  const markAll = async () => {
    try {
      const result = await notificationsApi.markAllRead();
      setUnread(result.unread);
      setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })));
      toast.push({ kind: 'success', title: 'All notifications marked as read' });
    } catch (cause) {
      toast.push({ kind: 'error', title: 'Could not mark notifications', description: cause instanceof Error ? cause.message : undefined });
    }
  };

  const clearRead = async () => {
    try {
      const result = await notificationsApi.clearRead();
      setItems((current) => current.filter((entry) => !entry.readAt));
      setUnread(result.unread);
      toast.push({ kind: 'success', title: 'Cleared read notifications' });
    } catch (cause) {
      toast.push({ kind: 'error', title: 'Could not clear notifications', description: cause instanceof Error ? cause.message : undefined });
    }
  };

  const open = async (entry: AppNotification) => {
    if (!entry.readAt) {
      try {
        const result = await notificationsApi.markRead(entry.id);
        setUnread(result.unread);
        setItems((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, readAt: new Date().toISOString() } : item)),
        );
      } catch {
        // Navigation is more important than the read receipt; retry happens on reload.
      }
    }
    if (entry.link) navigate(entry.link);
  };

  const remove = async (entry: AppNotification) => {
    try {
      const result = await notificationsApi.remove(entry.id);
      setItems((current) => current.filter((item) => item.id !== entry.id));
      setUnread(result.unread);
    } catch (cause) {
      toast.push({ kind: 'error', title: 'Could not dismiss notification', description: cause instanceof Error ? cause.message : undefined });
    }
  };

  const enableDesktop = async () => {
    if (typeof Notification === 'undefined') {
      toast.push({ kind: 'error', title: 'Desktop notifications are not supported here' });
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      toast.push({ kind: 'success', title: 'Desktop notifications enabled' });
    } else {
      toast.push({
        kind: 'info',
        title: 'Desktop notifications blocked',
        description: 'Allow notifications for this site in your browser settings, then try again.',
      });
    }
  };

  return (
    <AppShell
      title="Notifications"
      subtitle="Messages, friend requests, calls and platform announcements"
      sidebar={<DefaultSidebar active="home" />}
      headActions={
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={markAll} disabled={unread === 0}>
            <IconCheck size={14} /> Mark all read
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearRead}>
            Clear read
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <InstallPrompt />

        {permission !== 'granted' && (
          <div className="card card-pad row" style={{ gap: 12, alignItems: 'center' }}>
            <IconBell size={18} />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 13.5 }}>Desktop notifications</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                Get a native alert for new messages and calls while Chatter is in the background.
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-primary" onClick={enableDesktop}>
              Enable
            </button>
          </div>
        )}

        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Notification filters">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              className="chip"
              data-active={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
              {entry.id === 'unread' && unread > 0 ? ` · ${unread}` : ''}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="skeleton-list" aria-busy="true">
            {[0, 1, 2].map((key) => (
              <div key={key} className="skeleton-row" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="notif-empty">
            <IconBell size={26} />
            <strong>{filter === 'unread' ? 'You are all caught up' : 'No notifications yet'}</strong>
            <span>
              {filter === 'unread'
                ? 'New messages, friend requests and calls will appear here.'
                : 'Activity from your friends, communities and calls shows up in this list.'}
            </span>
          </div>
        ) : (
          <div className="notif-list">
            {visible.map((entry) => (
              <div key={entry.id} className="notif-item" data-unread={!entry.readAt}>
                <button
                  type="button"
                  className="notif-body"
                  style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}
                  onClick={() => void open(entry)}
                >
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    {entry.actor ? (
                      <Avatar
                        user={{
                          username: entry.actor.username,
                          displayName: entry.actor.displayName,
                          avatarUrl: entry.actor.avatarUrl,
                          accentColor: '',
                          presence: 'offline',
                          isOwner: false,
                        }}
                        size="sm"
                      />
                    ) : (
                      <span className="avatar" style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(56,189,248,0.16)' }}>
                        <IconSettings size={15} />
                      </span>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="notif-title">{entry.title}</div>
                      {entry.body && <div className="notif-text">{entry.body}</div>}
                      <div className="notif-meta">
                        <span className="notif-type" data-tone={NOTIFICATION_TONES[entry.type] ?? 'info'}>
                          {NOTIFICATION_LABELS[entry.type] ?? 'Activity'}
                        </span>
                        <span>{shortWhen(entry.createdAt)}</span>
                        {!entry.readAt && <span style={{ color: 'var(--accent-400)' }}>Unread</span>}
                      </div>
                    </div>
                  </div>
                </button>
                <div className="notif-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Dismiss notification"
                    onClick={() => void remove(entry)}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
