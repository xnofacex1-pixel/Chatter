import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addDays, db, nowIso } from '../db.js';
import { clientIp, userAgent } from './http.js';

export const SESSION_COOKIE = 'chatter_session';
const SESSION_TTL_DAYS = 30;
const RENEW_BEFORE_DAYS = 14;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function createSession(userId, req) {
  const token = randomToken(32);
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, sha256(token), userAgent(req), clientIp(req), now, now, addDays(SESSION_TTL_DAYS));
  return { id, token, expiresAt: addDays(SESSION_TTL_DAYS) };
}

export function findSession(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, s.last_used_at,
              u.*
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function touchSession(sessionId, expiresAt) {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  const renew = remainingMs < RENEW_BEFORE_DAYS * 86400 * 1000;
  if (renew) {
    db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?').run(
      nowIso(),
      addDays(SESSION_TTL_DAYS),
      sessionId,
    );
  } else {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(nowIso(), sessionId);
  }
}

export function revokeSession(sessionId) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), sessionId);
}

export function revokeAllSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').run(
      nowIso(),
      userId,
      exceptSessionId,
    );
  } else {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
  }
}

export function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function createAuthToken(userId, purpose, ttlMinutes) {
  const token = randomToken(32);
  const now = new Date();
  db.prepare(
    `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, purpose, sha256(token), new Date(now.getTime() + ttlMinutes * 60000).toISOString(), now.toISOString());
  return token;
}

export function consumeAuthToken(token, purpose) {
  if (!token) return null;
  const row = db
    .prepare('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?')
    .get(sha256(token), purpose);
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return row;
}

export function audit(actorId, action, { targetType = null, targetId = null, metadata = null, ip = null } = {}) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), actorId, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null, ip, nowIso());
}
