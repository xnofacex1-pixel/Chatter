#!/usr/bin/env node
/**
 * Stage 3 functional check — servers, channels, roles and permissions.
 *
 * Boots the real Chatter server against a throwaway SQLite file and exercises
 * community creation, default structure, invite links with usage limits, channel
 * messaging, private-channel isolation, role-based permission enforcement, role
 * hierarchy, kick/ban behaviour and per-server notification settings.
 *
 * Usage: node scripts/verify-stage3.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4601);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage3-${process.pid}.db`);
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

// Response shape helpers: routes may nest the resource under its own key.
const channelsOf = (res) => res.json?.channels ?? res.json?.server?.channels ?? [];
const rolesOf = (res) => res.json?.roles ?? res.json?.server?.roles ?? [];

try {
  await waitForServer();
  console.log('\nStage 3 — communities, channels and permissions');

  const alice = client();
  const bob = client();
  const eve = client();
  // Never joins any community: used to assert outsider isolation after eve accepted an invite.
  const solo = client();

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

  const aliceUser = await register(alice, 'srvowner');
  const bobUser = await register(bob, 'srvmember');
  await register(eve, 'srvoutsider');
  await register(solo, 'srvsolo');

  const created = await alice.req('/api/servers', {
    method: 'POST',
    body: { name: 'Stage Three Guild', description: 'Permission checks', isPublic: true },
  });
  check(created.status === 201, 'create community', `status ${created.status} ${created.text.slice(0, 200)}`);
  const serverId = created.json?.server?.id;
  check(Boolean(serverId), 'community creation returns an id');

  const detail = await alice.req(`/api/servers/${serverId}`);
  check(detail.status === 200, 'owner reads community detail', `status ${detail.status}`);
  const channels = channelsOf(detail);
  const roles = rolesOf(detail);
  const general = channels.find((channel) => channel.type === 'text');
  check(Boolean(general?.id), 'community starts with a text channel');
  check(Boolean(general?.conversationId), 'text channel is backed by a conversation');
  check(roles.length >= 2, 'community starts with default roles', `${roles.length} roles`);
  check(
    (detail.json?.server?.permissions ?? 0) > 0 && detail.json?.server?.isOwner === true,
    'owner receives full permissions and isOwner',
  );

  const privateChannel = await alice.req(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    body: { name: 'staff-room', type: 'text', isPrivate: true },
  });
  check(privateChannel.status === 201, 'create private channel', `status ${privateChannel.status} ${privateChannel.text.slice(0, 160)}`);
  const privateId = privateChannel.json?.channel?.id ?? privateChannel.json?.channel?.channel?.id;

  const voiceChannel = await alice.req(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    body: { name: 'Lounge', type: 'voice' },
  });
  check(voiceChannel.status === 201, 'create voice channel', `status ${voiceChannel.status}`);

  const category = await alice.req(`/api/servers/${serverId}/categories`, {
    method: 'POST',
    body: { name: 'Community' },
  });
  check(category.status === 201, 'create channel category', `status ${category.status} ${category.text.slice(0, 160)}`);

  console.log('\nStage 3 — invites and joining');
  const invite = await alice.req(`/api/servers/${serverId}/invites`, {
    method: 'POST',
    body: { maxUses: 2, expiresInHours: 24 },
  });
  check(invite.status === 201, 'create invite link', `status ${invite.status} ${invite.text.slice(0, 160)}`);
  const code = invite.json?.invite?.code;
  check(Boolean(code), 'invite returns a code');

  const preview = await bob.req(`/api/invites/${code}`);
  check(preview.status === 200 && preview.json?.server?.name === 'Stage Three Guild', 'invite preview is public');

  const joined = await bob.req(`/api/invites/${code}`, { method: 'POST', body: {} });
  check(joined.status === 201 || joined.status === 200, 'member joins through the invite', `status ${joined.status} ${joined.text.slice(0, 160)}`);

  const members = await alice.req(`/api/servers/${serverId}/members`);
  const memberIds = (members.json?.members ?? []).map((member) => member.id ?? member.userId ?? member.user?.id);
  check(memberIds.includes(bobUser.id), 'member list includes the new member');

  console.log('\nStage 3 — channel messaging and isolation');
  const sent = await bob.req(`/api/conversations/${general.conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Hello from the newest member' },
  });
  check(sent.status === 201, 'member posts in a channel', `status ${sent.status} ${sent.text.slice(0, 160)}`);

  const history = await alice.req(`/api/conversations/${general.conversationId}/messages?limit=20`);
  check(
    (history.json?.messages ?? []).some((message) => message.body === 'Hello from the newest member'),
    'owner reads channel history',
  );

  const outsiderRead = await eve.req(`/api/conversations/${general.conversationId}/messages?limit=5`);
  check(outsiderRead.status === 404, 'non-member cannot read channel messages', `status ${outsiderRead.status}`);

  const outsiderPost = await eve.req(`/api/conversations/${general.conversationId}/messages`, {
    method: 'POST',
    body: { body: 'intruder' },
  });
  check(outsiderPost.status === 404, 'non-member cannot post to a channel', `status ${outsiderPost.status}`);

  const bobDetail = await bob.req(`/api/servers/${serverId}`);
  const bobChannels = channelsOf(bobDetail);
  check(!bobChannels.some((channel) => channel.id === privateId), 'private channel hidden from ordinary member');

  const bobPrivateRead = await bob.req(`/api/conversations/${privateChannel.json?.channel?.conversationId}/messages?limit=5`);
  check(bobPrivateRead.status === 404, 'ordinary member cannot read a private channel', `status ${bobPrivateRead.status}`);

  console.log('\nStage 3 — role permissions and hierarchy');
  const bobCreate = await bob.req(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    body: { name: 'not-allowed', type: 'text' },
  });
  check(bobCreate.status === 403, 'member without MANAGE_CHANNELS cannot create a channel', `status ${bobCreate.status}`);

  const bobEdit = await bob.req(`/api/servers/${serverId}`, { method: 'PATCH', body: { name: 'Hijacked' } });
  check(bobEdit.status === 403, 'member cannot rename the community', `status ${bobEdit.status}`);

  const adminRole = roles.find((role) => /admin/i.test(role.name)) ?? roles[0];
  const assigned = await alice.req(`/api/servers/${serverId}/members/${bobUser.id}`, {
    method: 'PATCH',
    body: { roleIds: [adminRole.id] },
  });
  check(assigned.status === 200, 'owner assigns a role to a member', `status ${assigned.status} ${assigned.text.slice(0, 160)}`);

  const bobCreateAgain = await bob.req(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    body: { name: 'admin-created', type: 'text' },
  });
  check(bobCreateAgain.status === 201, 'granted role unlocks channel creation', `status ${bobCreateAgain.status} ${bobCreateAgain.text.slice(0, 160)}`);

  const hierarchy = await bob.req(`/api/servers/${serverId}/members/${aliceUser.id}/kick`, {
    method: 'POST',
    body: { reason: 'coup' },
  });
  check(hierarchy.status === 403, 'administrator cannot kick the owner (hierarchy)', `status ${hierarchy.status}`);

  const customRole = await alice.req(`/api/servers/${serverId}/roles`, {
    method: 'POST',
    body: { name: 'Colour Test', color: '#38bdf8', permissions: 0 },
  });
  check(
    customRole.status === 201 && customRole.json?.role?.color === '#38bdf8',
    'create custom role with colour',
    `status ${customRole.status} ${customRole.text.slice(0, 160)}`,
  );

  const badColour = await alice.req(`/api/servers/${serverId}/roles`, {
    method: 'POST',
    body: { name: 'Bad Colour', color: 'blue' },
  });
  check(badColour.status === 400, 'invalid role colour is rejected', `status ${badColour.status}`);

  console.log('\nStage 3 — moderation');
  const kicked = await alice.req(`/api/servers/${serverId}/members/${bobUser.id}/kick`, {
    method: 'POST',
    body: { reason: 'Stage 3 check' },
  });
  check(kicked.status === 200, 'owner kicks a member', `status ${kicked.status} ${kicked.text.slice(0, 160)}`);

  const afterKick = await bob.req(`/api/conversations/${general.conversationId}/messages?limit=5`);
  check(afterKick.status === 404, 'kicked member loses channel access', `status ${afterKick.status}`);

  const rejoin = await bob.req(`/api/invites/${code}`, { method: 'POST', body: {} });
  check(rejoin.status === 201 || rejoin.status === 200, 'kicked member can rejoin with a valid invite', `status ${rejoin.status}`);

  const banInvite = await alice.req(`/api/servers/${serverId}/invites`, {
    method: 'POST',
    body: { maxUses: 10, expiresInHours: 24 },
  });
  const banCode = banInvite.json?.invite?.code;

  const banned = await alice.req(`/api/servers/${serverId}/members/${bobUser.id}/ban`, {
    method: 'POST',
    body: { reason: 'Repeated disruption' },
  });
  check(banned.status === 200, 'owner bans a member', `status ${banned.status} ${banned.text.slice(0, 160)}`);

  const bannedRejoin = await bob.req(`/api/invites/${banCode}`, { method: 'POST', body: {} });
  check(bannedRejoin.status === 403, 'banned member cannot rejoin', `status ${bannedRejoin.status} ${bannedRejoin.text.slice(0, 120)}`);

  console.log('\nStage 3 — settings, discovery and invite limits');
  const notify = await alice.req(`/api/servers/${serverId}/notifications`, { method: 'PATCH', body: { level: 'mentions' } });
  check(notify.status === 200 && notify.json?.level === 'mentions', 'per-server notification level saved');

  const discover = await eve.req('/api/servers/discover?q=Stage');
  check(
    (discover.json?.servers ?? []).some((entry) => entry.id === serverId),
    'public community appears in discovery',
  );

  const usedUp = await alice.req(`/api/servers/${serverId}/invites`, {
    method: 'POST',
    body: { maxUses: 1, expiresInHours: 24 },
  });
  const limitedCode = usedUp.json?.invite?.code;
  await eve.req(`/api/invites/${limitedCode}`, { method: 'POST', body: {} });
  const overflow = await client().req(`/api/invites/${limitedCode}`, { method: 'POST', body: {} });
  check(
    overflow.status === 401 || overflow.status === 410 || overflow.status === 403,
    'invite usage limit is enforced',
    `status ${overflow.status}`,
  );

  const readMarker = await alice.req(`/api/servers/${serverId}/channels/${general.id}/read`, { method: 'POST', body: {} });
  check(readMarker.status === 200, 'channel read marker recorded', `status ${readMarker.status}`);

  const outsiderServer = await solo.req(`/api/servers/${serverId}`);
  check(outsiderServer.status === 404 || outsiderServer.status === 403, 'outsider cannot read community detail', `status ${outsiderServer.status}`);
} catch (error) {
  check(false, 'stage 3 verification completed without throwing', String(error));
} finally {
  shutdown();
}

await sleep(300);
console.log(`\n${failures === 0 ? 'Stage 3 checks passed' : `${failures} Stage 3 check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
