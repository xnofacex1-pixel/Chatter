import { request } from './api';

export type NotificationType =
  | 'message'
  | 'mention'
  | 'reply'
  | 'reaction'
  | 'friend_request'
  | 'friend_accepted'
  | 'server_invite'
  | 'call_incoming'
  | 'call_missed'
  | 'moderation'
  | 'announcement';

export interface NotificationActor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  link: string | null;
  actor: NotificationActor | null;
  serverId: string | null;
  conversationId: string | null;
  messageId: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: (limit = 40) => request<{ notifications: AppNotification[]; unread: number }>(`/api/notifications?limit=${limit}`),
  unread: () => request<{ unread: number }>('/api/notifications/unread'),
  markRead: (id: string) => request<{ ok: true; unread: number }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ ok: true; unread: number }>('/api/notifications/read-all', { method: 'POST' }),
  remove: (id: string) => request<{ ok: true; unread: number }>(`/api/notifications/${id}`, { method: 'DELETE' }),
  clearRead: () => request<{ ok: true; removed: number; unread: number }>('/api/notifications/read', { method: 'DELETE' }),
};

export const NOTIFICATION_LABELS: Record<string, string> = {
  message: 'Message',
  mention: 'Mention',
  reply: 'Reply',
  reaction: 'Reaction',
  friend_request: 'Friend request',
  friend_accepted: 'Friend request accepted',
  server_invite: 'Community invite',
  call_incoming: 'Incoming call',
  call_missed: 'Missed call',
  moderation: 'Moderation',
  announcement: 'Announcement',
};

export const NOTIFICATION_TONES: Record<string, string> = {
  message: 'info',
  mention: 'accent',
  reply: 'accent',
  reaction: 'info',
  friend_request: 'accent',
  friend_accepted: 'success',
  server_invite: 'accent',
  call_incoming: 'accent',
  call_missed: 'danger',
  moderation: 'danger',
  announcement: 'success',
};

/** Short "3m", "2h", "5d" style stamp used by the notification list. */
export function shortWhen(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Desktop notifications are only raised when the account has them enabled and
 * the browser has granted permission. Nothing is shown for the active window.
 */
export function showDesktopNotification(notification: AppNotification, { sounds }: { sounds: boolean }) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    const shown = new Notification(notification.title, {
      body: notification.body ?? undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: notification.id,
      silent: !sounds,
    });
    shown.onclick = () => {
      window.focus();
      if (notification.link) window.location.assign(notification.link);
      shown.close();
    };
  } catch {
    // Browsers can refuse notifications from a non-secure or non-focused context.
  }
}

/** A short, synthesised chime — no audio asset download required. */
export function playNotificationSound() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(990, context.currentTime + 0.14);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.32);
    osc.onended = () => void context.close();
  } catch {
    // Sound is a nicety; a blocked audio context must never break the UI.
  }
}
