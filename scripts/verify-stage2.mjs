#!/usr/bin/env node
/**
 * Stage 2 functional check.
 *
 * Boots the real Chatter server against a throwaway SQLite file and exercises the
 * friend graph, direct messaging, reactions, editing, deletion, live delivery over
 * the authenticated SSE stream, and cross-account privacy isolation.
 *
 * Usage: node scripts/verify-stage2.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4599);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage2-${process.pid}.db`);
const PASSWORD = 'ChatterTest!2026';

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
      if (res.status === 200 || res.status === 401) return;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error('server did not become ready');
}

async function waitForEvent(cookie, predicate, timeoutMs = 8000) {
  const controller = new AbortController();
  const res = await fetch(`${BASE}/api/realtime/stream`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!res.ok) throw new Error(`stream responded ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        if (!event) continue;
        const raw = /^data: (.+)$/m.exec(block)?.[1];
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
        }
        if (predicate(event, data)) return { event, data };
      }
    }
    throw new Error('timed out waiting for realtime event');
  } finally {
    controller.abort();
  }
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
  console.log('\nStage 2 — accounts and friendship');

  const alice = client();
  const bob = client();
  const eve = client();

  const register = async (session, username) => {
    const res = await session.req('/api/auth/register', {
      method: 'POST',
      body: {
        email: `${username}@example.com`,
        username,
        displayName: username[0].toUpperCase() + username.slice(1),
        password: PASSWORD,
      },
    });
    check(res.status === 201, `register ${username}`, `status ${res.status} ${res.text.slice(0, 160)}`);
    return res.json?.user;
  };

  const aliceUser = await register(alice, 'aliceverify');
  const bobUser = await register(bob, 'bobverify');
  await register(eve, 'eveverify');
  check(Boolean(aliceUser?.id && bobUser?.id), 'registration returns user ids');

  const request = await alice.req('/api/friends/requests', {
    method: 'POST',
    body: { username: 'bobverify', message: 'Stage 2 check' },
  });
  check(request.status === 201, 'send friend request', `status ${request.status} ${request.text.slice(0, 160)}`);
  const requestId = request.json?.request?.id;

  const accept = await bob.req(`/api/friends/requests/${requestId}/accept`, { method: 'POST' });
  check(accept.status === 200 && accept.json?.ok === true, 'accept friend request');

  const aliceFriends = await alice.req('/api/friends');
  check(
    (aliceFriends.json?.friends ?? []).some((friend) => friend.id === bobUser.id),
    'accepted friend appears in friend list',
  );

  console.log('\nStage 2 — direct messaging');
  const created = await alice.req('/api/conversations', {
    method: 'POST',
    body: { kind: 'dm', userIds: [bobUser.id] },
  });
  check(created.status === 201, 'create DM conversation', `status ${created.status} ${created.text.slice(0, 160)}`);
  const conversationId = created.json?.conversation?.id;

  const streamPromise = waitForEvent(bob.cookie, (event, data) => event === 'message:new' && data?.message?.body === 'Realtime hello');
  await sleep(400);
  const sent = await alice.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Realtime hello' },
  });
  check(sent.status === 201 && sent.json?.message?.body === 'Realtime hello', 'send message');
  const messageId = sent.json?.message?.id;

  let live = null;
  try {
    live = await streamPromise;
  } catch (error) {
    check(false, 'realtime delivery over SSE', String(error));
  }
  if (live) check(live.data?.message?.id === messageId, 'recipient receives the message live over SSE');

  const history = await bob.req(`/api/conversations/${conversationId}/messages?limit=20`);
  check(
    (history.json?.messages ?? []).some((message) => message.id === messageId),
    'recipient reads the message from history',
  );

  const reaction = await alice.req(`/api/conversations/${conversationId}/messages/${messageId}/reactions`, {
    method: 'POST',
    body: { emoji: '🎉' },
  });
  const reactionEntry = (reaction.json?.message?.reactions ?? []).find((entry) => entry.emoji === '🎉');
  check(reaction.status === 200 && reactionEntry?.count === 1 && reactionEntry?.me === true, 'reaction records on the message');

  const edited = await alice.req(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    body: { body: 'Realtime hello (edited)' },
  });
  check(
    edited.json?.message?.body === 'Realtime hello (edited)' && Boolean(edited.json?.message?.editedAt),
    'author can edit a message',
  );

  const typing = await alice.req(`/api/conversations/${conversationId}/typing`, {
    method: 'POST',
    body: { typing: true },
  });
  check(typing.status === 200, 'typing signal accepted');

  console.log('\nStage 2 — privacy isolation');
  const intruderRead = await eve.req(`/api/conversations/${conversationId}`);
  check(intruderRead.status === 404, 'outsider cannot open the conversation (404)', `status ${intruderRead.status}`);

  const intruderHistory = await eve.req(`/api/conversations/${conversationId}/messages`);
  check(intruderHistory.status === 404, 'outsider cannot read messages (404)', `status ${intruderHistory.status}`);

  const intruderSend = await eve.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'should not land' },
  });
  check(intruderSend.status === 404, 'outsider cannot post into the conversation (404)', `status ${intruderSend.status}`);

  const intruderReact = await eve.req(`/api/conversations/${conversationId}/messages/${messageId}/reactions`, {
    method: 'POST',
    body: { emoji: '😮' },
  });
  check(intruderReact.status === 404, 'outsider cannot react to a private message (404)', `status ${intruderReact.status}`);

  const anonymous = await fetch(`${BASE}/api/conversations/${conversationId}`);
  check(anonymous.status === 401, 'anonymous request is rejected (401)', `status ${anonymous.status}`);

  console.log('\nStage 2 — deletion');
  const removed = await alice.req(`/api/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
  check(removed.status === 200, 'author deletes a message');
  const afterDelete = await bob.req(`/api/conversations/${conversationId}/messages?limit=20`);
  const stillThere = (afterDelete.json?.messages ?? []).find((message) => message.id === messageId);
  check(!stillThere || Boolean(stillThere.deletedAt), 'deleted message is removed or tombstoned for the recipient');
} catch (error) {
  failures += 1;
  console.error('\nVerification aborted:', error);
} finally {
  shutdown();
}

if (failures > 0) {
  console.error(`\nStage 2 verification FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.log('\nStage 2 verification passed.');
process.exit(0);
