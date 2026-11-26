#!/usr/bin/env node
/**
 * Stage 7 security and performance audit.
 *
 * Boots the real Chatter server against a throwaway SQLite file and checks the
 * cross-cutting guarantees that the per-stage suites do not cover directly:
 *
 *   1. Session security      — logout revokes the cookie, private routes stay closed.
 *   2. Unauthenticated sweep — every protected surface answers 401 without a session.
 *   3. Privilege escalation  — a normal account cannot reach owner-only endpoints.
 *   4. Upload security       — type allow-list, size ceiling, owner/shared read rules.
 *   5. Pagination bounds     — message history is bounded and cursor pages never overlap.
 *   6. Rate limiting         — repeated abuse of a limited endpoint is throttled.
 *
 * Usage: node scripts/verify-stage7.mjs
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4617);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage7-${process.pid}.db`);
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
    set cookie(value) {
      cookie = value;
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
      return { status: res.status, headers: res.headers, json, text };
    },
    async upload(filename, type, bytes) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), filename);
      const headers = {};
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${BASE}/api/attachments`, { method: 'POST', headers, body: form });
      for (const entry of res.headers.getSetCookie?.() ?? []) cookie = entry.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body */
      }
      return { status: res.status, headers: res.headers, json, text };
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  const email = `${username}-${STAMP}@example.com`;
  const reg = await c.req('/api/auth/register', {
    method: 'POST',
    body: { email, username, password: PASSWORD },
  });
  if (reg.status !== 201) throw new Error(`register ${username}: ${reg.status} ${reg.text.slice(0, 200)}`);
  const login = await c.req('/api/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`login ${username}: ${login.status} ${login.text.slice(0, 200)}`);
  return { user: login.json?.user ?? null, email };
}

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), DATABASE_FILE: DB_FILE, NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[server:err] ${chunk}`));

let exitCode = 0;
try {
  await waitForServer();
  console.log('\nStage 7 — sessions, authorisation, uploads, pagination and rate limits\n');

  const alice = client();
  const bob = client();
  const anon = client();
  const aliceAccount = await signUp(alice, `s7alice${STAMP}`);
  const bobAccount = await signUp(bob, `s7bob${STAMP}`);
  const aliceUser = aliceAccount.user;
  const bobUser = bobAccount.user;
  check(Boolean(aliceUser?.id && bobUser?.id), 'audit accounts created');

  // ---------------------------------------------------------------- sessions
  console.log('\nStage 7 — session security');
  const beforeLogout = await alice.req('/api/me');
  check(beforeLogout.status === 200, 'active session reads its own account');
  const logout = await alice.req('/api/auth/logout', { method: 'POST' });
  check(logout.status === 200 || logout.status === 204, 'logout succeeds', `status ${logout.status}`);
  const afterLogout = await alice.req('/api/me');
  check(afterLogout.status === 401, 'revoked cookie can no longer read the account', `status ${afterLogout.status}`);
  const replay = await alice.req('/api/notifications');
  check(replay.status === 401, 'revoked cookie cannot read notifications', `status ${replay.status}`);
  const relogin = await alice.req('/api/auth/login', {
    method: 'POST',
    body: { identifier: aliceAccount.email, password: PASSWORD },
  });
  check(relogin.status === 200, 'signing back in issues a fresh session');
  const freshSession = await alice.req('/api/me');
  check(freshSession.status === 200, 'fresh session cookie restores account access', `status ${freshSession.status}`);

  // -------------------------------------------------- unauthenticated sweep
  console.log('\nStage 7 — unauthenticated access sweep');
  const protectedRoutes = [
    ['/api/me', 'GET'],
    ['/api/friends', 'GET'],
    ['/api/conversations', 'GET'],
    ['/api/notifications', 'GET'],
    ['/api/servers', 'GET'],
    ['/api/calls/active', 'GET'],
    ['/api/admin/overview', 'GET'],
    ['/api/admin/users', 'GET'],
    ['/api/admin/audit', 'GET'],
    ['/api/messages/search?q=secret', 'GET'],
    ['/api/attachments/00000000-0000-0000-0000-000000000000', 'GET'],
  ];
  for (const [path, method] of protectedRoutes) {
    const res = await anon.req(path, { method });
    check(res.status === 401, `anonymous ${method} ${path.split('?')[0]} is rejected`, `status ${res.status}`);
  }

  // --------------------------------------------------- privilege escalation
  console.log('\nStage 7 — privilege escalation');
  const selfPromote = await bob.req('/api/admin/staff', { method: 'POST', body: { userId: bobUser?.id, permissions: ['*'] } });
  check([403, 404, 405].includes(selfPromote.status), 'account cannot grant itself owner access', `status ${selfPromote.status}`);
  const ownerProbe = await bob.req('/api/admin/users');
  check(ownerProbe.status === 403, 'ordinary account cannot list all users', `status ${ownerProbe.status}`);
  const meAfter = await bob.req('/api/me');
  check(!meAfter.json?.user?.isOwner, 'ordinary account never reports owner status');

  // ------------------------------------------------------- upload security
  console.log('\nStage 7 — upload security');
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const anonymousUpload = await anon.upload('pixel.png', 'image/png', tinyPng);
  check(anonymousUpload.status === 401, 'anonymous upload is rejected', `status ${anonymousUpload.status}`);

  const rejectedType = await bob.upload('payload.exe', 'application/x-msdownload', Buffer.from('MZ bin'));
  check(rejectedType.status === 415, 'executable upload is refused', `status ${rejectedType.status}`);

  const oversized = await bob.upload('huge.png', 'image/png', Buffer.alloc(11 * 1024 * 1024, 7));
  check(oversized.status === 413, 'oversized upload is refused', `status ${oversized.status} ${oversized.text.slice(0, 120)}`);

  const accepted = await bob.upload('pixel.png', 'image/png', tinyPng);
  const mediaId = accepted.json?.attachment?.id;
  check(accepted.status === 201 && Boolean(mediaId), 'valid image upload is accepted', `status ${accepted.status}`);
  check(accepted.json?.attachment?.url === `/api/attachments/${mediaId}`, 'upload returns a private media URL');

  const ownerRead = await bob.req(`/api/attachments/${mediaId}`);
  check(ownerRead.status === 200, 'owner can read their attachment');
  check(ownerRead.headers.get('x-content-type-options') === 'nosniff', 'attachment response sets nosniff');
  const strangerRead = await alice.req(`/api/attachments/${mediaId}`);
  check(strangerRead.status === 404, 'unrelated account cannot read the attachment', `status ${strangerRead.status}`);

  // ----------------------------------------------------------- pagination
  console.log('\nStage 7 — message pagination');
  const dm = await bob.req('/api/conversations', { method: 'POST', body: { kind: 'dm', userIds: [aliceUser?.id] } });
  const conversationId = dm.json?.conversation?.id;
  check(Boolean(conversationId), 'direct conversation created for paging', `status ${dm.status}`);

  for (let index = 1; index <= 45; index += 1) {
    const sent = await bob.req(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { body: `page message ${index}` },
    });
    if (sent.status !== 201) {
      check(false, `message ${index} sent`, `status ${sent.status}`);
      break;
    }
  }

  const firstPage = await bob.req(`/api/conversations/${conversationId}/messages?limit=20`);
  const page = firstPage.json?.messages ?? [];
  check(page.length === 20, 'history request is bounded by the limit', `got ${page.length}`);
  check(firstPage.json?.hasMore === true, 'older history is reported as available');
  const pageIds = new Set(page.map((message) => message.id));
  const oldest = page[0];

  const secondPage = await bob.req(
    `/api/conversations/${conversationId}/messages?limit=20&before=${encodeURIComponent(oldest?.createdAt ?? '')}&beforeId=${oldest?.id ?? ''}`,
  );
  const next = secondPage.json?.messages ?? [];
  check(next.length === 20, 'cursor page returns a full page', `got ${next.length}`);
  check(next.every((message) => !pageIds.has(message.id)), 'cursor page does not repeat messages');
  check(
    next.every((message) => new Date(message.createdAt) <= new Date(oldest?.createdAt ?? 0)),
    'cursor page only contains older messages',
  );
  check(
    page.every((message) => message.conversationId === conversationId),
    'paged messages stay inside their conversation',
  );

  // --------------------------------------------------------- rate limiting
  console.log('\nStage 7 — rate limiting');
  let throttled = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const res = await anon.req('/api/auth/forgot-password', { method: 'POST', body: { email: `nobody${attempt}@example.com` } });
    if (res.status === 429) {
      throttled = { attempt, json: res.json };
      break;
    }
  }
  check(Boolean(throttled), 'repeated password-reset abuse is throttled');
  check(throttled?.json?.error?.code === 'rate_limited', 'throttled response reports rate_limited', JSON.stringify(throttled?.json ?? {}));

  console.log(failures === 0 ? '\nStage 7 — PASS\n' : `\nStage 7 — FAIL (${failures} failure(s))\n`);
  if (failures > 0) exitCode = 1;
} catch (error) {
  console.error(`Stage 7 audit crashed: ${error.message}`);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(200);
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_FILE}${suffix}`, { force: true });
}

process.exit(exitCode);
