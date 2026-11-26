#!/usr/bin/env node
/**
 * Stage 6 functional check — notifications, settings expansion and PWA assets.
 *
 * Boots the real Chatter server against a throwaway SQLite file and exercises
 * the notification contract end to end: friend request / acceptance notices,
 * direct message and mention notices, unread counters, read + delete lifecycle,
 * cross-account isolation, per-type preference gating (via user_settings) and
 * unauthenticated access. PWA delivery is checked by parsing the shipped
 * manifest and asserting the worker never caches private /api responses.
 *
 * Usage: node scripts/verify-stage6.mjs
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const PORT = Number(process.env.CHECK_PORT || 4616);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage6-${process.pid}.db`);
const PASSWORD = 'ChatterTest!2026';
const STAMP = randomBytes(3).toString('hex');

for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_FILE}${suffix}`, { force: true });

let failures = 0;
function check(condition, label, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async req(path, { method = 'GET', body } = {}) {
      const headers = {};
      if (body) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const entry of res.headers.getSetCookie?.() ?? []) cookie = entry.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body */
      }
      return { status: res.status, json, text };
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/auth/session`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error('server did not become ready');
}

async function signUp(c, username) {
  const reg = await c.req('/api/auth/register', {
    method: 'POST',
    body: { email: `${username}@example.com`, username, password: PASSWORD },
  });
  if (reg.status !== 201) {
    return { error: `register ${reg.status} ${reg.text.slice(0, 200)}` };
  }
  const login = await c.req('/api/auth/login', {
    method: 'POST',
    body: { identifier: `${username}@example.com`, password: PASSWORD },
  });
  if (login.status !== 200) {
    return { error: `login ${login.status} ${login.text.slice(0, 200)}` };
  }
  return { user: login.json?.user ?? reg.json?.user };
}

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_FILE: DB_FILE, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[server:err] ${chunk}`));

const shutdown = () => {
  server.kill('SIGTERM');
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_FILE}${suffix}`, { force: true });
};

try {
  await waitForServer();
  console.log('\nStage 6 — notifications, settings and PWA\n');

  const alice = client();
  const bob = client();
  const aliceName = `n6alice${STAMP}`;
  const bobName = `n6bob${STAMP}`;

  const aliceAccount = await signUp(alice, aliceName);
  const bobAccount = await signUp(bob, bobName);
  check(Boolean(aliceAccount.user?.id), 'alice registers and signs in', aliceAccount.error);
  check(Boolean(bobAccount.user?.id), 'bob registers and signs in', bobAccount.error);
  const aliceId = aliceAccount.user?.id;
  const bobId = bobAccount.user?.id;

  console.log('\nStage 6 — unauthenticated access');
  const anonymous = await fetch(`${BASE}/api/notifications`);
  check(anonymous.status === 401, 'notifications require a session', `status ${anonymous.status}`);
  const anonymousUnread = await fetch(`${BASE}/api/notifications/unread`);
  check(anonymousUnread.status === 401, 'unread counter requires a session', `status ${anonymousUnread.status}`);

  const emptyInbox = await bob.req('/api/notifications');
  check(emptyInbox.status === 200, 'new account reads an empty inbox');
  check(Array.isArray(emptyInbox.json?.notifications), 'inbox returns a notifications array');
  check(emptyInbox.json?.unread === 0, 'new account starts with no unread notifications');

  console.log('\nStage 6 — friend request notifications');
  const friendRequest = await alice.req('/api/friends/requests', {
    method: 'POST',
    body: { username: bobName, message: 'Stage 6 check' },
  });
  check(friendRequest.status === 201, 'friend request sent', `status ${friendRequest.status}`);
  const requestId = friendRequest.json?.request?.id;

  const bobInbox = await bob.req('/api/notifications');
  const bobRequestNotice = (bobInbox.json?.notifications ?? []).find((entry) => entry.type === 'friend_request');
  check(Boolean(bobRequestNotice), 'recipient receives a friend request notification');
  check(bobRequestNotice?.actor?.username === aliceName, 'friend request notification names the sender');
  check(bobInbox.json?.unread >= 1, 'friend request increments the unread counter');
  check(bobRequestNotice?.read === false, 'new notification starts unread');

  const noAliceNotice = await alice.req('/api/notifications');
  check(
    !(noAliceNotice.json?.notifications ?? []).some((entry) => entry.type === 'friend_request'),
    'sender does not receive their own request notification',
  );

  const acceptRes = await bob.req(`/api/friends/requests/${requestId}/accept`, { method: 'POST' });
  check(acceptRes.status === 200, 'friend request accepted', `status ${acceptRes.status}`);

  const aliceInbox = await alice.req('/api/notifications');
  const accepted = (aliceInbox.json?.notifications ?? []).find((entry) => entry.type === 'friend_accepted');
  check(Boolean(accepted), 'sender is notified when the request is accepted');
  check(accepted?.actor?.username === bobName, 'acceptance notification names the accepting user');

  console.log('\nStage 6 — direct message and mention notifications');
  const dm = await alice.req('/api/conversations', {
    method: 'POST',
    body: { kind: 'dm', userIds: [bobId] },
  });
  check(dm.status === 201, 'DM conversation created', `status ${dm.status}`);
  const conversationId = dm.json?.conversation?.id;

  const plain = await alice.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Stage 6 plain message' },
  });
  check(plain.status === 201, 'plain DM sent', `status ${plain.status}`);

  await sleep(300);
  const afterPlain = await bob.req('/api/notifications');
  const messageNotice = (afterPlain.json?.notifications ?? []).find((entry) => entry.type === 'message');
  check(Boolean(messageNotice), 'recipient receives a message notification');
  check(messageNotice?.actor?.username === aliceName, 'message notification names the sender');
  check(Boolean(messageNotice?.conversationId), 'message notification links to the conversation');

  const mention = await alice.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: `@${bobName} stage 6 mention check` },
  });
  check(mention.status === 201, 'mentioning DM sent', `status ${mention.status}`);

  await sleep(300);
  const afterMention = await bob.req('/api/notifications');
  const mentionNotice = (afterMention.json?.notifications ?? []).find((entry) => entry.type === 'mention');
  check(Boolean(mentionNotice), 'mention is recorded as a mention notification, not a plain message');
  check(
    (afterMention.json?.notifications ?? []).filter((entry) => entry.type === 'message').length <= 1,
    'mention does not also create a duplicate plain message notification',
  );

  console.log('\nStage 6 — unread counter and read lifecycle');
  const unreadBefore = await bob.req('/api/notifications/unread');
  check(typeof unreadBefore.json?.unread === 'number' && unreadBefore.json.unread >= 2, 'unread counter totals pending notices');

  const target = mentionNotice ?? messageNotice;
  const marked = await bob.req(`/api/notifications/${target?.id}/read`, { method: 'POST' });
  check(marked.status === 200, 'marking a notification read succeeds', `status ${marked.status}`);
  const unreadAfter = await bob.req('/api/notifications/unread');
  check(unreadAfter.json?.unread === unreadBefore.json.unread - 1, 'unread counter decreases by one');

  const reread = await bob.req(`/api/notifications/${target?.id}/read`, { method: 'POST' });
  check(reread.status === 200, 're-reading an already read notification is idempotent');
  const unreadStable = await bob.req('/api/notifications/unread');
  check(unreadStable.json?.unread === unreadAfter.json?.unread, 'idempotent read does not change the counter');

  const readAll = await bob.req('/api/notifications/read-all', { method: 'POST' });
  check(readAll.status === 200, 'mark all read succeeds', `status ${readAll.status}`);
  const zeroUnread = await bob.req('/api/notifications/unread');
  check(zeroUnread.json?.unread === 0, 'mark all read clears the unread counter');

  console.log('\nStage 6 — cross-account isolation');
  const aliceInboxIds = (aliceInbox.json?.notifications ?? []).map((entry) => entry.id);
  const targetOwnedByAlice = aliceInboxIds[0];
  const stealRead = await bob.req(`/api/notifications/${targetOwnedByAlice}/read`, { method: 'POST' });
  check(stealRead.status === 404, 'another account cannot mark a notification read', `status ${stealRead.status}`);
  const stealDelete = await bob.req(`/api/notifications/${targetOwnedByAlice}`, { method: 'DELETE' });
  check(stealDelete.status === 404, 'another account cannot delete a notification', `status ${stealDelete.status}`);

  const aliceStillThere = await alice.req('/api/notifications');
  check(
    (aliceStillThere.json?.notifications ?? []).some((entry) => entry.id === targetOwnedByAlice),
    'rejected cross-account action leaves the notification intact',
  );
  check(
    !(aliceStillThere.json?.notifications ?? []).some((entry) => entry.type === 'message'),
    'private DM notices are not exposed to the wrong account',
  );

  console.log('\nStage 6 — delete and clear');
  const removable = (afterMention.json?.notifications ?? [])[0];
  const removed = await bob.req(`/api/notifications/${removable?.id}`, { method: 'DELETE' });
  check(removed.status === 200, 'dismissing a notification succeeds', `status ${removed.status}`);
  const afterRemove = await bob.req('/api/notifications');
  check(
    !(afterRemove.json?.notifications ?? []).some((entry) => entry.id === removable?.id),
    'dismissed notification disappears from the inbox',
  );

  const cleared = await bob.req('/api/notifications/read', { method: 'DELETE' });
  check(cleared.status === 200, 'clearing read notifications succeeds', `status ${cleared.status}`);
  const afterClear = await bob.req('/api/notifications');
  check(
    (afterClear.json?.notifications ?? []).every((entry) => entry.read === false),
    'only read notifications are cleared',
  );

  console.log('\nStage 6 — notification preference gating');
  const db = new Database(DB_FILE, { readonly: false });
  db.prepare('UPDATE user_settings SET notif_messages = 0 WHERE user_id = ?').run(bobId);
  db.close();

  const suppressed = await alice.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Stage 6 muted message' },
  });
  check(suppressed.status === 201, 'message still sends while notices are muted', `status ${suppressed.status}`);
  await sleep(300);
  const afterMuted = await bob.req('/api/notifications');
  check(
    !(afterMuted.json?.notifications ?? []).some((entry) => entry.type === 'message'),
    'muted message preference suppresses new message notifications',
  );

  const settings = await bob.req('/api/me/settings');
  check(settings.status === 200, 'settings endpoint returns notification preferences');
  const notificationsPrefs = settings.json?.settings?.notifications;
  check(
    notificationsPrefs !== null && typeof notificationsPrefs === 'object',
    'settings expose a notifications group for the UI',
  );
  check(
    notificationsPrefs && 'desktop' in notificationsPrefs && 'messages' in notificationsPrefs,
    'notification settings include desktop and message toggles',
  );

  console.log('\nStage 6 — PWA assets');
  const manifest = JSON.parse(readFileSync('client/public/manifest.webmanifest', 'utf8'));
  check(manifest.name?.startsWith('Chatter'), 'manifest names the Chatter application');
  check(manifest.short_name === 'Chatter', 'manifest short name is Chatter');
  check(manifest.display === 'standalone', 'manifest requests standalone display');
  check(manifest.start_url === '/' && manifest.scope === '/', 'manifest scopes the whole app shell');
  check(Boolean(manifest.theme_color && manifest.background_color), 'manifest declares theme and background colours');
  const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
  check(sizes.includes('192x192') && sizes.includes('512x512'), 'manifest ships 192px and 512px icons');
  check(
    (manifest.icons ?? []).some((icon) => String(icon.purpose ?? '').includes('maskable')),
    'manifest includes a maskable icon for Android installs',
  );

  const worker = readFileSync('client/public/sw.js', 'utf8');
  check(/startsWith\(['"]\/api/.test(worker), 'service worker excludes /api from its cache rules');
  check(/offline\.html/.test(worker), 'service worker falls back to the offline page');
  const offline = readFileSync('client/public/offline.html', 'utf8');
  check(/Chatter/i.test(offline), 'offline fallback page is branded');

  console.log(`\nStage 6 — ${failures === 0 ? 'PASS' : 'FAIL'}\n`);
} catch (error) {
  failures += 1;
  console.error('\ncheck crashed:', error);
} finally {
  shutdown();
}

process.exitCode = failures === 0 ? 0 : 1;
