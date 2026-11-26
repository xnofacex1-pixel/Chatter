#!/usr/bin/env node
/**
 * Channel types and ordering check.
 *
 * Boots the real Chatter server against a throwaway SQLite file and verifies the
 * extended channel types (announcement, forum, media), announcement read-only
 * enforcement for ordinary members, message channels being backed by
 * conversations, and the drag-and-drop channel reorder endpoint.
 *
 * Usage: node scripts/verify-channels.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4603);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-channels-${process.pid}.db`);
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

const channelsOf = (res) => res.json?.channels ?? res.json?.server?.channels ?? [];

try {
  await waitForServer();
  console.log('\nChannels — types, read-only enforcement and ordering');

  const owner = client();
  const member = client();

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

  await register(owner, 'chanowner');
  await register(member, 'chanmember');

  const created = await owner.req('/api/servers', {
    method: 'POST',
    body: { name: 'Channel Types Guild', description: 'Channel type coverage', isPublic: true },
  });
  check(created.status === 201, 'create community', `status ${created.status} ${created.text.slice(0, 200)}`);
  const serverId = created.json?.server?.id;

  const makeChannel = async (body, label) => {
    const res = await owner.req(`/api/servers/${serverId}/channels`, { method: 'POST', body });
    check(res.status === 201, label, `status ${res.status} ${res.text.slice(0, 160)}`);
    return { id: res.json?.channelId, conversationId: res.json?.conversationId };
  };

  const announcement = await makeChannel({ name: 'announcements', type: 'announcement' }, 'create announcement channel');
  const forum = await makeChannel({ name: 'ideas', type: 'forum' }, 'create forum channel');
  const media = await makeChannel({ name: 'screenshots', type: 'media' }, 'create media channel');
  const voice = await makeChannel({ name: 'Stage', type: 'voice' }, 'create voice channel');

  // Channel creation returns identifiers only; read the serialised rows from server detail.
  const ownerChannels = channelsOf(await owner.req(`/api/servers/${serverId}`));
  const byId = (id) => ownerChannels.find((channel) => channel.id === id);
  const announcementRow = byId(announcement.id);
  const forumRow = byId(forum.id);
  const mediaRow = byId(media.id);

  check(announcementRow?.type === 'announcement', 'announcement channel keeps its type');
  check(forumRow?.type === 'forum', 'forum channel keeps its type');
  check(mediaRow?.type === 'media', 'media channel keeps its type');
  check(Boolean(announcement.conversationId), 'announcement channel is backed by a conversation');
  check(Boolean(forum.conversationId), 'forum channel is backed by a conversation');
  check(Boolean(media.conversationId), 'media channel is backed by a conversation');
  check(!voice.conversationId, 'voice channel has no conversation');
  check(announcementRow?.readOnly === true, 'announcement channel defaults to read-only');

  const invalid = await owner.req(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    body: { name: 'bad', type: 'video' },
  });
  check(invalid.status === 400, 'unknown channel type is rejected', `status ${invalid.status}`);

  const invite = await owner.req(`/api/servers/${serverId}/invites`, {
    method: 'POST',
    body: { maxUses: 5, expiresInHours: 24 },
  });
  const code = invite.json?.invite?.code;
  check(Boolean(code), 'create invite link');
  const joined = await member.req(`/api/invites/${code}`, { method: 'POST', body: {} });
  check(joined.status === 201 || joined.status === 200, 'member joins the community', `status ${joined.status}`);

  const asMember = await member.req(`/api/servers/${serverId}`);
  const memberChannels = channelsOf(asMember);
  const memberAnnouncement = memberChannels.find((channel) => channel.id === announcement?.id);
  const memberForum = memberChannels.find((channel) => channel.id === forum?.id);
  check(memberAnnouncement?.canSend === false, 'ordinary member cannot send in an announcement channel');
  check(memberForum?.canSend === true, 'ordinary member can send in a forum channel');

  check(announcementRow?.canSend === true, 'manager can still post in an announcement channel');

  const blockedPost = await member.req(`/api/conversations/${announcement.conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Announcement attempt' },
  });
  check(blockedPost.status >= 400, 'read-only announcement rejects a member message', `status ${blockedPost.status}`);

  const forumPost = await member.req(`/api/conversations/${forum.conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Forum topic idea' },
  });
  check(forumPost.status === 201 || forumPost.status === 200, 'member can post in a forum channel', `status ${forumPost.status}`);

  const before = channelsOf(await owner.req(`/api/servers/${serverId}`));
  const ordered = [...before].sort((a, b) => a.position - b.position);
  const reversed = [...ordered].reverse().map((channel, index) => ({
    id: channel.id,
    position: index,
    categoryId: channel.categoryId,
  }));
  const reorder = await owner.req(`/api/servers/${serverId}/channels/order`, {
    method: 'PATCH',
    body: { items: reversed },
  });
  check(reorder.status === 200, 'reorder channels accepts the items payload', `status ${reorder.status} ${reorder.text.slice(0, 160)}`);

  const after = channelsOf(await owner.req(`/api/servers/${serverId}`)).sort((a, b) => a.position - b.position);
  check(
    after[0]?.id === ordered[ordered.length - 1]?.id,
    'reordered channel moves to the top',
    `${after[0]?.name} vs ${ordered[ordered.length - 1]?.name}`,
  );
  check(
    after.every((channel, index) => channel.position === index),
    'positions are contiguous after reorder',
    after.map((channel) => channel.position).join(','),
  );
} catch (error) {
  failures += 1;
  console.log(`  FAIL  unexpected error — ${error?.message ?? error}`);
} finally {
  shutdown();
}

if (failures > 0) {
  console.log(`\nFAIL — channel checks: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nChannel type and ordering checks passed');
process.exit(0);
