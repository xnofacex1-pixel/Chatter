#!/usr/bin/env node
/**
 * Polls and threads check.
 *
 * Boots the real Chatter server against a throwaway SQLite file and verifies:
 * poll creation and validation, single-choice vote toggling, multi-choice votes,
 * per-viewer vote state, thread replies staying out of the channel flow, thread
 * reply counts, and that non-members cannot read a thread.
 *
 * Usage: node scripts/verify-polls-threads.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4605);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-polls-${process.pid}.db`);
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

try {
  await waitForServer();
  console.log('\nPolls and threads — creation, voting, isolation and access control');

  const owner = client();
  const member = client();
  const outsider = client();

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

  const ownerUser = await register(owner, 'pollowner');
  const memberUser = await register(member, 'pollmember');
  await register(outsider, 'polloutsider');

  const created = await owner.req('/api/servers', {
    method: 'POST',
    body: { name: 'Poll Guild', description: 'Poll and thread coverage', isPublic: true },
  });
  check(created.status === 201, 'create community', `status ${created.status} ${created.text.slice(0, 160)}`);
  const serverId = created.json?.server?.id;

  const channel = await owner.req(`/api/servers/${serverId}/channels`, {
    method: 'POST',
    body: { name: 'polls', type: 'text' },
  });
  check(channel.status === 201, 'create text channel', `status ${channel.status} ${channel.text.slice(0, 160)}`);
  const conversationId = channel.json?.conversationId;
  check(Boolean(conversationId), 'text channel is backed by a conversation');

  const invite = await owner.req(`/api/servers/${serverId}/invites`, {
    method: 'POST',
    body: { maxUses: 5, expiresInHours: 24 },
  });
  const code = invite.json?.invite?.code;
  check(Boolean(code), 'create invite link');
  const joined = await member.req(`/api/invites/${code}`, { method: 'POST', body: {} });
  check(joined.status === 201 || joined.status === 200, 'member joins the community', `status ${joined.status}`);

  // --- Poll creation -------------------------------------------------------
  const pollPost = await owner.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { poll: { question: 'Deploy on Friday?', options: ['Yes', 'No'], multiple: false } },
  });
  check(pollPost.status === 201, 'post a poll message', `status ${pollPost.status} ${pollPost.text.slice(0, 200)}`);
  const pollMessage = pollPost.json?.message;
  check(Boolean(pollMessage?.poll), 'poll payload returned with the message');
  check(pollMessage?.poll?.question === 'Deploy on Friday?', 'poll keeps its question');
  check(pollMessage?.poll?.options?.length === 2, 'poll keeps both options');
  check(pollMessage?.poll?.totalVotes === 0, 'new poll starts with zero votes');
  check(pollMessage?.poll?.options?.[0]?.percent === 0, 'new poll options show 0%');

  const tooFewOptions = await owner.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { poll: { question: 'Only one?', options: ['Solo'] } },
  });
  check(tooFewOptions.status === 400, 'poll with a single option is rejected', `status ${tooFewOptions.status}`);

  const emptyQuestion = await owner.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { poll: { question: '   ', options: ['A', 'B'] } },
  });
  check(emptyQuestion.status === 400, 'poll with a blank question is rejected', `status ${emptyQuestion.status}`);

  const pollId = pollMessage?.id;
  const firstOption = pollMessage?.poll?.options?.[0]?.id;
  const secondOption = pollMessage?.poll?.options?.[1]?.id;

  // --- Single-choice voting ------------------------------------------------
  const vote = await member.req(`/api/conversations/${conversationId}/messages/${pollId}/vote`, {
    method: 'POST',
    body: { optionIds: [firstOption] },
  });
  check(vote.status === 200, 'member votes on the poll', `status ${vote.status} ${vote.text.slice(0, 160)}`);
  check(vote.json?.message?.poll?.totalVotes === 1, 'vote count increments to 1');
  check(
    vote.json?.message?.poll?.myOptionIds?.includes(firstOption),
    'voter sees their own selection',
  );
  check(vote.json?.message?.poll?.options?.[0]?.percent === 100, 'leading option shows 100%');

  const ownerView = await owner.req(`/api/conversations/${conversationId}/messages?limit=20`);
  const ownerCopy = (ownerView.json?.messages ?? []).find((entry) => entry.id === pollId);
  check(ownerCopy?.poll?.totalVotes === 1, 'other members see the same vote total');
  check((ownerCopy?.poll?.myOptionIds ?? []).length === 0, 'vote state is per viewer');

  const revote = await member.req(`/api/conversations/${conversationId}/messages/${pollId}/vote`, {
    method: 'POST',
    body: { optionIds: [firstOption] },
  });
  check(revote.status === 200, 'voter can change their mind', `status ${revote.status}`);
  check(revote.json?.message?.poll?.totalVotes === 0, 'clicking the same option removes the vote');

  const twoOptions = await member.req(`/api/conversations/${conversationId}/messages/${pollId}/vote`, {
    method: 'POST',
    body: { optionIds: [firstOption, secondOption] },
  });
  check(twoOptions.status === 400, 'single-choice poll rejects two options at once', `status ${twoOptions.status}`);

  // --- Multi-choice voting -------------------------------------------------
  const multiPost = await owner.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { poll: { question: 'Pick your tools', options: ['React', 'Node', 'SQLite'], multiple: true } },
  });
  const multiMessage = multiPost.json?.message;
  check(multiMessage?.poll?.multiple === true, 'multi-choice poll records its mode');
  const multiIds = (multiMessage?.poll?.options ?? []).map((option) => option.id);
  const multiVote = await member.req(`/api/conversations/${conversationId}/messages/${multiMessage.id}/vote`, {
    method: 'POST',
    body: { optionIds: [multiIds[0], multiIds[2]] },
  });
  check(multiVote.status === 200, 'member selects two options in a multi-choice poll', `status ${multiVote.status}`);
  check(multiVote.json?.message?.poll?.myOptionIds?.length === 2, 'both selections are stored');
  check(multiVote.json?.message?.poll?.totalVotes === 2, 'multi-choice vote total counts both');

  const foreignOption = await member.req(`/api/conversations/${conversationId}/messages/${multiMessage.id}/vote`, {
    method: 'POST',
    body: { optionIds: ['not-a-real-option'] },
  });
  check(foreignOption.status === 400, 'unknown poll option is rejected', `status ${foreignOption.status}`);

  const outsiderVote = await outsider.req(`/api/conversations/${conversationId}/messages/${pollId}/vote`, {
    method: 'POST',
    body: { optionIds: [firstOption] },
  });
  check(outsiderVote.status >= 400, 'non-member cannot vote in a private channel', `status ${outsiderVote.status}`);

  // --- Threads -------------------------------------------------------------
  const rootPost = await owner.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Release checklist for v2' },
  });
  const rootMessage = rootPost.json?.message;
  check(rootPost.status === 201, 'post a thread root message', `status ${rootPost.status}`);
  check(rootMessage?.threadReplyCount === 0, 'new message has no thread replies');

  const reply = await member.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Signing off on the changelog', threadRootId: rootMessage.id },
  });
  check(reply.status === 201, 'member replies in the thread', `status ${reply.status} ${reply.text.slice(0, 160)}`);
  check(reply.json?.message?.threadRootId === rootMessage.id, 'reply records its thread root');

  const mainFlow = await owner.req(`/api/conversations/${conversationId}/messages?limit=50`);
  const mainIds = (mainFlow.json?.messages ?? []).map((entry) => entry.id);
  check(!mainIds.includes(reply.json?.message?.id), 'thread replies stay out of the channel flow');
  const rootInFlow = (mainFlow.json?.messages ?? []).find((entry) => entry.id === rootMessage.id);
  check(rootInFlow?.threadReplyCount === 1, 'root message reports one thread reply');

  const thread = await owner.req(`/api/conversations/${conversationId}/messages/${rootMessage.id}/thread`);
  check(thread.status === 200, 'thread can be loaded', `status ${thread.status}`);
  check(thread.json?.root?.id === rootMessage.id, 'thread returns its root message');
  check((thread.json?.replies ?? []).length === 1, 'thread returns its replies');
  check(thread.json?.replies?.[0]?.body === 'Signing off on the changelog', 'thread reply body matches');

  const outsiderThread = await outsider.req(
    `/api/conversations/${conversationId}/messages/${rootMessage.id}/thread`,
  );
  check(outsiderThread.status >= 400, 'non-member cannot read a thread', `status ${outsiderThread.status}`);

  const missingThread = await owner.req(`/api/conversations/${conversationId}/messages/missing-id/thread`);
  check(missingThread.status === 404, 'unknown thread returns 404', `status ${missingThread.status}`);

  const deepReply = await member.req(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body: 'Nested reply attempt', threadRootId: reply.json?.message?.id },
  });
  check(deepReply.status === 201 || deepReply.status === 400, 'reply to a thread reply is handled', `status ${deepReply.status}`);
  if (deepReply.status === 201) {
    check(
      deepReply.json?.message?.threadRootId === rootMessage.id,
      'a reply to a reply stays in the same thread',
      `threadRootId ${deepReply.json?.message?.threadRootId}`,
    );
  }
} catch (error) {
  failures += 1;
  console.error('  FAIL  unexpected error —', error?.message ?? error);
} finally {
  shutdown();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
