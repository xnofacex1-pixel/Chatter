#!/usr/bin/env node
/**
 * Stage 4 functional check — calls, permissions and WebRTC signalling.
 *
 * Boots the real Chatter server against a throwaway SQLite file and exercises
 * the complete signalling path across separate accounts: direct-call ringing,
 * accept/join, SDP relay, state broadcasts, leave/end teardown, plus community
 * voice-channel authorisation for members and outsiders.
 *
 * Media itself is produced by the browser; this check proves the server-side
 * contract the browser depends on (authorisation, relay targeting, lifecycle).
 *
 * Usage: node scripts/verify-stage4.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4611);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage4-${process.pid}.db`);
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

/** Minimal SSE reader: collects events and lets checks await a specific one. */
async function openStream(c) {
  const controller = new AbortController();
  const events = [];
  const res = await fetch(`${BASE}/api/realtime/stream`, {
    headers: { cookie: c.cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!res.ok) throw new Error(`stream failed with ${res.status}`);
  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          let name = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) name = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          try {
            events.push({ name, data: JSON.parse(data) });
          } catch {
            events.push({ name, data: null });
          }
        }
      }
    } catch {
      /* aborted on close */
    }
  })();
  return {
    events,
    close: () => controller.abort(),
    async waitFor(name, predicate = () => true, timeout = 5000) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const found = events.find((entry) => entry.name === name && predicate(entry.data));
        if (found) return found.data;
        await sleep(50);
      }
      return null;
    },
  };
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
  console.log('\nStage 4 — voice, video and screen-share signalling\n');

  const alice = client();
  const bob = client();
  const outsider = client();

  const register = async (c, username) => {
    const res = await c.req('/api/auth/register', {
      method: 'POST',
      body: { username, email: `${username}@example.com`, password: PASSWORD },
    });
    check(res.status === 200 || res.status === 201, `register ${username}`, `status ${res.status} ${res.text.slice(0, 120)}`);
    return res.json;
  };

  const aliceUser = await register(alice, 'callalice');
  const bobUser = await register(bob, 'callbob');
  await register(outsider, 'calloutsider');

  // Registration payloads nest the account under `user`; tolerate a flat shape too.
  const aliceId = aliceUser?.user?.id ?? aliceUser?.id;
  const bobId = bobUser?.user?.id ?? bobUser?.id;

  const aliceStream = await openStream(alice);
  const bobStream = await openStream(bob);

  const dm = await alice.req('/api/conversations', {
    method: 'POST',
    body: { kind: 'dm', userIds: [bobId] },
  });
  const conversationId = dm.json?.conversation?.id;
  check(Boolean(conversationId), 'direct conversation created', `status ${dm.status} ${dm.text.slice(0, 120)}`);

  // ── Direct call lifecycle ────────────────────────────────────────────────
  const started = await alice.req('/api/calls/start', {
    method: 'POST',
    body: { conversationId, kind: 'video' },
  });
  const callId = started.json?.call?.id;
  check(started.status === 201, 'start direct video call', `status ${started.status} ${started.text.slice(0, 160)}`);
  check(started.json?.call?.status === 'active', 'call reports active once the caller joined');
  check(started.json?.call?.me?.state === 'joined', 'caller is a joined participant');
  check(started.json?.call?.kind === 'video', 'call kind is preserved');

  const incoming = await bobStream.waitFor('call:incoming', (data) => data?.call?.id === callId);
  check(Boolean(incoming), 'callee receives an incoming-call event');
  check(incoming?.call?.participants?.some((entry) => entry.userId === bobId), 'callee is invited to the call');

  const outsiderRead = await outsider.req(`/api/calls/${callId}`);
  check(outsiderRead.status === 404, 'outsider cannot read the call', `status ${outsiderRead.status}`);

  const outsiderJoin = await outsider.req(`/api/calls/${callId}/join`, { method: 'POST', body: {} });
  check(outsiderJoin.status === 404 || outsiderJoin.status === 403, 'outsider cannot join a private call', `status ${outsiderJoin.status}`);

  const joined = await bob.req(`/api/calls/${callId}/join`, { method: 'POST', body: {} });
  check(joined.status === 200, 'callee joins the call', `status ${joined.status} ${joined.text.slice(0, 160)}`);
  check(joined.json?.call?.joinedCount === 2, 'both participants are connected', `joinedCount ${joined.json?.call?.joinedCount}`);

  const sawJoin = await aliceStream.waitFor('call:updated', (data) => data?.call?.joinedCount === 2);
  check(Boolean(sawJoin), 'caller sees the callee join in real time');

  // ── Signalling relay ─────────────────────────────────────────────────────
  const offer = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' };
  const sentOffer = await bob.req(`/api/calls/${callId}/signal`, {
    method: 'POST',
    body: { to: aliceId, data: offer },
  });
  check(sentOffer.status === 200, 'offer is accepted for relay', `status ${sentOffer.status} ${sentOffer.text.slice(0, 120)}`);

  const relayed = await aliceStream.waitFor('call:signal', (data) => data?.callId === callId);
  check(Boolean(relayed), 'peer receives the relayed offer');
  check(relayed?.data?.sdp === offer.sdp, 'relayed session description is intact');
  check(relayed?.from === bobId, 'relayed signal identifies the sender');

  const iceSent = await alice.req(`/api/calls/${callId}/signal`, {
    method: 'POST',
    body: { to: bobId, data: { type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host' } } },
  });
  check(iceSent.status === 200, 'ICE candidate is accepted');

  const badTarget = await bob.req(`/api/calls/${callId}/signal`, {
    method: 'POST',
    body: { to: 'not-a-participant', data: offer },
  });
  check(badTarget.status === 403, 'signals cannot be sent to a non-participant', `status ${badTarget.status}`);

  const badType = await bob.req(`/api/calls/${callId}/signal`, {
    method: 'POST',
    body: { to: aliceId, data: { type: 'sneaky' } },
  });
  check(badType.status === 400, 'unsupported signal types are rejected', `status ${badType.status}`);

  const badSdp = await bob.req(`/api/calls/${callId}/signal`, {
    method: 'POST',
    body: { to: aliceId, data: { type: 'offer' } },
  });
  check(badSdp.status === 400, 'offer without a session description is rejected', `status ${badSdp.status}`);

  // ── Media state broadcast ────────────────────────────────────────────────
  const stateChange = await alice.req(`/api/calls/${callId}/state`, {
    method: 'PATCH',
    body: { micMuted: true, videoOn: false, screenOn: true },
  });
  check(stateChange.status === 200, 'media state update accepted', `status ${stateChange.status}`);
  const sawState = await bobStream.waitFor('call:updated', (data) => {
    const me = data?.call?.participants?.find((entry) => entry.userId === aliceId);
    return Boolean(me?.micMuted && me?.screenOn);
  });
  check(Boolean(sawState), 'peers see mute and screen-share changes');

  const active = await bob.req('/api/calls/active');
  check(active.json?.calls?.some((entry) => entry.id === callId), 'active call is listed for a participant');
  const activeOutsider = await outsider.req('/api/calls/active');
  check(!activeOutsider.json?.calls?.some((entry) => entry.id === callId), 'active call is hidden from outsiders');

  const unauth = await fetch(`${BASE}/api/calls/active`);
  check(unauth.status === 401, 'call routes require authentication', `status ${unauth.status}`);

  // ── Teardown ─────────────────────────────────────────────────────────────
  const left = await bob.req(`/api/calls/${callId}/leave`, { method: 'POST', body: {} });
  check(left.status === 200 && left.json?.call?.joinedCount === 1, 'leaving decrements the participant count');

  const lastLeft = await alice.req(`/api/calls/${callId}/leave`, { method: 'POST', body: {} });
  check(lastLeft.json?.call?.status === 'ended', 'call ends when the last participant leaves');

  const endedEvent = await bobStream.waitFor('call:ended', (data) => data?.callId === callId);
  check(Boolean(endedEvent), 'participants are told the call ended');

  const afterEnd = await bob.req(`/api/calls/${callId}/join`, { method: 'POST', body: {} });
  check(afterEnd.status === 409, 'an ended call cannot be rejoined', `status ${afterEnd.status}`);

  // ── Community voice channel ──────────────────────────────────────────────
  const created = await alice.req('/api/servers', { method: 'POST', body: { name: 'Voice Hall' } });
  const serverId = created.json?.server?.id;
  check(Boolean(serverId), 'community created for voice test', `status ${created.status}`);

  const detail = await alice.req(`/api/servers/${serverId}`);
  let voiceChannel = (detail.json?.channels ?? []).find((entry) => entry.type === 'voice');
  if (!voiceChannel) {
    const made = await alice.req(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      body: { name: 'Lounge', type: 'voice' },
    });
    voiceChannel = made.json?.channel;
  }
  check(Boolean(voiceChannel?.id), 'community has a voice channel');

  const channelCall = await alice.req('/api/calls/start', {
    method: 'POST',
    body: { channelId: voiceChannel.id, kind: 'voice' },
  });
  const channelCallId = channelCall.json?.call?.id;
  check(channelCall.status === 201, 'voice channel call starts', `status ${channelCall.status} ${channelCall.text.slice(0, 160)}`);
  check(channelCall.json?.call?.channelId === voiceChannel.id, 'call is bound to the voice channel');
  check(channelCall.json?.call?.kind === 'voice', 'voice channel call is voice-only');

  const outsiderChannelJoin = await outsider.req(`/api/calls/${channelCallId}/join`, { method: 'POST', body: {} });
  check(outsiderChannelJoin.status === 404 || outsiderChannelJoin.status === 403, 'non-member cannot join the voice channel', `status ${outsiderChannelJoin.status}`);

  const invite = await alice.req(`/api/servers/${serverId}/invites`, {
    method: 'POST',
    body: { maxUses: 5, expiresInHours: 24 },
  });
  const code = invite.json?.invite?.code;
  const bobJoin = await bob.req(`/api/invites/${code}`, { method: 'POST', body: {} });
  check(bobJoin.status === 201 || bobJoin.status === 200, 'second account joins the community', `status ${bobJoin.status}`);

  const bobChannelJoin = await bob.req(`/api/calls/${channelCallId}/join`, { method: 'POST', body: {} });
  check(bobChannelJoin.status === 200, 'member joins the voice channel call', `status ${bobChannelJoin.status} ${bobChannelJoin.text.slice(0, 160)}`);
  check(bobChannelJoin.json?.call?.joinedCount === 2, 'voice channel shows both connected');

  const bobActive = await bob.req('/api/calls/active');
  const listed = bobActive.json?.calls?.find((entry) => entry.id === channelCallId);
  check(Boolean(listed), 'voice channel call is listed for the member');
  check(listed?.channelName === voiceChannel.name, 'voice channel call carries its channel name');

  const ended = await alice.req(`/api/calls/${channelCallId}/end`, { method: 'POST', body: {} });
  check(ended.json?.call?.status === 'ended', 'community call can be ended by its host');

  const rejoinAfterEnd = await bob.req(`/api/calls/${channelCallId}/join`, { method: 'POST', body: {} });
  check(rejoinAfterEnd.status === 409, 'ended community call is closed to joins', `status ${rejoinAfterEnd.status}`);

  aliceStream.close();
  bobStream.close();
} catch (error) {
  failures += 1;
  console.error('  ERROR', error);
} finally {
  shutdown();
}

console.log('');
if (failures > 0) {
  console.log(`Stage 4 check FAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log('Stage 4 check passed');
process.exit(0);
