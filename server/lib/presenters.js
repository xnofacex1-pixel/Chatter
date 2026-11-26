import { db, nowIso } from '../db.js';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

/** Presence is derived server-side: a user is only "online" while recently active. */
export function effectivePresence(user) {
  if (!user) return 'offline';
  if (user.is_banned) return 'offline';
  const lastSeen = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0;
  if (!lastSeen || Date.now() - lastSeen > ONLINE_WINDOW_MS) return 'offline';
  if (user.status === 'invisible' || user.status === 'offline') return 'offline';
  if (user.status === 'idle' || user.status === 'dnd') return user.status;
  return 'online';
}

export function isOnline(user) {
  return effectivePresence(user) === 'online';
}

function profileFor(userId) {
  return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
}

/** Shape returned to other members (never includes email or hashes). */
export function publicUser(user, { includeEmail = false } = {}) {
  if (!user) return null;
  const profile = profileFor(user.id) || {};
  const presence = effectivePresence(user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    title: user.title || null,
    isOwner: Boolean(user.is_owner),
    presence,
    status: user.status,
    customStatus: profile.custom_status || null,
    aboutMe: profile.about_me || null,
    pronouns: profile.pronouns || null,
    accentColor: profile.accent_color || '#38bdf8',
    bannerColor: profile.banner_color || '#0f1b30',
    avatarUrl: profile.avatar_media_id ? `/api/media/${profile.avatar_media_id}` : null,
    bannerUrl: profile.banner_media_id ? `/api/media/${profile.banner_media_id}` : null,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
    emailVerified: Boolean(user.email_verified_at),
    ...(includeEmail ? { email: user.email, isBanned: Boolean(user.is_banned) } : {}),
  };
}

export function settingsFor(userId) {
  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    theme: row.theme,
    accent: row.accent,
    reducedMotion: Boolean(row.reduced_motion),
    compactMode: Boolean(row.compact_mode),
    textScale: row.text_scale,
    messageDisplay: row.message_display,
    dmPrivacy: row.dm_privacy,
    friendRequestPrivacy: row.friend_request_privacy,
    presenceVisibility: row.presence_visibility,
    readReceipts: Boolean(row.read_receipts),
    notifications: {
      desktop: Boolean(row.notif_desktop),
      sounds: Boolean(row.notif_sounds),
      mentions: Boolean(row.notif_mentions),
      messages: Boolean(row.notif_messages),
      calls: Boolean(row.notif_calls),
    },
  };
}

export function touchPresence(userId, status = null) {
  const now = nowIso();
  if (status) {
    db.prepare('UPDATE users SET last_seen_at = ?, status = ? WHERE id = ?').run(now, status, userId);
  } else {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, userId);
  }
}
