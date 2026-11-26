import { db, nowIso } from '../db.js';
import { fail } from './http.js';

/** Staff roles that can be granted by the owner from the owner console. */
export const STAFF_ROLES = ['administrator', 'moderator', 'support'];

export const STAFF_PERMISSIONS = [
  'moderate.users',
  'moderate.messages',
  'manage.servers',
  'view.reports',
  'view.audit',
  'support.tickets',
];

export const STAFF_ROLE_LABELS = {
  administrator: 'Administrator',
  moderator: 'Moderator',
  support: 'Support staff',
};

const isOwnerRow = (userId) =>
  Boolean(userId && db.prepare('SELECT is_owner FROM users WHERE id = ?').get(userId)?.is_owner);

/**
 * The owner console is reachable only by the verified platform owner. This is
 * always evaluated against the database, never against anything the browser
 * sends.
 */
export function requireOwner(req) {
  if (!req.user) fail(401, 'auth_required', 'Sign in to continue.');
  if (!isOwnerRow(req.user.id)) fail(403, 'owner_only', 'Only the Chatter owner can open this console.');
  return req.user;
}

export function activeStaff(userId) {
  return db
    .prepare('SELECT * FROM staff_assignments WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .all(userId);
}

export function parsePermissions(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => STAFF_PERMISSIONS.includes(entry)) : [];
  } catch {
    return [];
  }
}

/** Effective platform permissions for a user (owner implicitly has all). */
export function staffPermissions(userId) {
  if (isOwnerRow(userId)) return [...STAFF_PERMISSIONS];
  const granted = new Set();
  for (const row of activeStaff(userId)) {
    if (row.role === 'administrator') {
      for (const permission of STAFF_PERMISSIONS) granted.add(permission);
      continue;
    }
    for (const permission of parsePermissions(row.permissions)) granted.add(permission);
  }
  return [...granted];
}

/** Owner, or a staff member holding the exact permission. */
export function requirePermission(req, permission) {
  if (!req.user) fail(401, 'auth_required', 'Sign in to continue.');
  if (isOwnerRow(req.user.id)) return req.user;
  if (!staffPermissions(req.user.id).includes(permission)) {
    fail(403, 'permission_required', 'Your staff role does not allow this action.');
  }
  return req.user;
}

export const DEFAULT_APP_SETTINGS = {
  appName: 'Chatter',
  announcement: '',
  registrationOpen: true,
  maintenanceMode: false,
  uploadLimitMb: 25,
  moderationEnabled: true,
  accentColor: '#5ee7ff',
};

/** Merge stored platform settings over the defaults. */
export function appSettings() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const out = { ...DEFAULT_APP_SETTINGS };
  for (const row of rows) {
    if (!(row.key in DEFAULT_APP_SETTINGS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

/** Persist a settings patch; unknown keys are ignored by the caller's schema. */
export function saveAppSettings(patch, actorId) {
  const now = nowIso();
  const statement = db.prepare(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  );
  for (const [key, value] of Object.entries(patch)) {
    statement.run(key, JSON.stringify(value), actorId, now);
  }
  return appSettings();
}

/** Count helper used by the owner dashboard. */
export const count = (sql, ...params) => db.prepare(sql).get(...params)?.count ?? 0;
