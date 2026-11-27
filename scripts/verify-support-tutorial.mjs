#!/usr/bin/env node
/**
 * Stage 7 functional check — no-email registration, support tickets and tutorial progress.
 *
 * Boots the real Chatter server against a throwaway SQLite file and exercises:
 *  - registration and login without any email delivery or verification step,
 *  - ticket creation, replies, attachments, close/reopen,
 *  - ticket privacy (other members cannot read a ticket or its files),
 *  - staff tooling gated behind the owner/staff permission,
 *  - internal notes never reaching the ticket owner,
 *  - tutorial progress persistence per account.
 *
 * Usage: node scripts/verify-support-tutorial.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECK_PORT || 4619);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage7-${process.pid}.db`);
const PASSWORD = 'ChatterTest!2026';
const OWNER_EMAIL = 'masongiacoppo@outlook.com';
const OWNER_CODE = 'stage7-owner-code';

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
    async req(path, { method = 'GET', body, formData } = {}) {
      const headers = {};
      if (body) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: formData ?? (body ? JSON.stringify(body) : undefined),
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
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_FILE: DB_FILE,
    NODE_ENV: 'test',
    OWNER_SETUP_CODE: OWNER_CODE,
  },
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
  console.log('\nStage 7 — registration without email, support tickets and tutorial\n');

  const member = client();
  const other = client();
  const owner = client();
  const anonymous = client();
  const reloginClient = client();

  const register = async (c, username, email) => {
    const res = await c.req('/api/auth/register', {
      method: 'POST',
      body: { username, email, password: PASSWORD },
    });
    check(res.status === 201, `register ${username}`, `status ${res.status} ${res.text.slice(0, 160)}`);
    return res.json?.user ?? res.json;
  };

  // --- Registration needs no email verification -----------------------------
  const memberAccount = await register(member, 'ticketmember', 'ticketmember@example.com');
  await register(other, 'ticketother', 'ticketother@example.com');
  const ownerAccount = await register(owner, 'ticketowner', OWNER_EMAIL);
  check(Boolean(memberAccount?.id), 'registration returns the created account');

  const memberMe = await member.req('/api/me');
  check(memberMe.status === 200, 'a brand new account can use the API immediately', `status ${memberMe.status}`);
  check(
    JSON.stringify(memberMe.json ?? {}).toLowerCase().indexOf('verify') === -1 ||
      memberMe.json?.user?.emailVerified === undefined,
    'account payload carries no verification gate',
    memberMe.text.slice(0, 200),
  );
  check(!memberMe.json?.user?.verificationRequired, 'no verification-required flag on the session');

  const relogin = await reloginClient.req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'ticketmember@example.com', password: PASSWORD },
  });
  check(relogin.status === 200, 'login works straight after registration', `status ${relogin.status}`);

  // --- Support metadata and ticket lifecycle --------------------------------
  const meta = await member.req('/api/support/meta');
  check(meta.status === 200, 'support metadata loads');
  check((meta.json?.categories ?? []).length === 8, 'all eight ticket categories are offered', JSON.stringify(meta.json?.categories?.length));
  check((meta.json?.statuses ?? []).length === 5, 'five ticket statuses are offered');
  check((meta.json?.priorities ?? []).length >= 3, 'priorities are offered');

  const created = await member.req('/api/support', {
    method: 'POST',
    body: {
      subject: 'Cannot upload a profile picture',
      description: 'Every upload fails with a generic error.',
      category: 'bugs',
      priority: 'high',
    },
  });
  check(created.status === 201, 'a member can open a ticket', `status ${created.status} ${created.text.slice(0, 160)}`);
  const ticketId = created.json?.ticket?.id;
  check(Boolean(ticketId), 'the created ticket returns an id');
  check(created.json?.ticket?.status === 'open', 'new tickets start as open');
  check(created.json?.ticket?.priority === 'high', 'the requested priority is stored');
  check(typeof created.json?.ticket?.categoryLabel === 'string', 'the ticket carries a readable category label');

  const list = await member.req('/api/support');
  check(list.status === 200 && list.json?.tickets?.some((entry) => entry.id === ticketId), 'the ticket appears in the member list');

  const reply = await member.req(`/api/support/${ticketId}/messages`, {
    method: 'POST',
    body: { body: 'Adding a screenshot of the error dialog.' },
  });
  check(reply.status === 201 || reply.status === 200, 'a member can reply to their ticket', `status ${reply.status}`);
  check(reply.json?.message?.body?.includes('screenshot'), 'the reply body round-trips');

  // --- Ticket privacy -------------------------------------------------------
  const otherList = await other.req('/api/support');
  check(
    !(otherList.json?.tickets ?? []).some((entry) => entry.id === ticketId),
    'other members do not see the ticket in their list',
  );
  const otherRead = await other.req(`/api/support/${ticketId}`);
  check([403, 404].includes(otherRead.status), 'other members cannot read the ticket', `status ${otherRead.status}`);
  const otherReply = await other.req(`/api/support/${ticketId}/messages`, {
    method: 'POST',
    body: { body: 'injected' },
  });
  check([403, 404].includes(otherReply.status), 'other members cannot post into the ticket', `status ${otherReply.status}`);

  const anonRead = await anonymous.req('/api/support');
  check(anonRead.status === 401, 'anonymous requests are rejected', `status ${anonRead.status}`);
  const anonStaff = await anonymous.req('/api/support/staff/tickets');
  check(anonStaff.status === 401, 'anonymous staff requests are rejected', `status ${anonStaff.status}`);

  // --- Staff tooling is permission gated ------------------------------------
  const memberStaff = await member.req('/api/support/staff/tickets');
  check(memberStaff.status === 403, 'ordinary members cannot open the staff queue', `status ${memberStaff.status}`);
  const memberStats = await member.req('/api/support/staff/stats');
  check(memberStats.status === 403, 'ordinary members cannot read staff ticket stats', `status ${memberStats.status}`);
  const memberPatch = await member.req(`/api/support/staff/tickets/${ticketId}`, {
    method: 'PATCH',
    body: { status: 'closed' },
  });
  check([403, 404].includes(memberPatch.status), 'ordinary members cannot change ticket status', `status ${memberPatch.status}`);

  // --- Owner claim and staff actions ---------------------------------------
  const claim = await owner.req('/api/auth/owner-claim', { method: 'POST', body: { code: OWNER_CODE } });
  check(claim.status === 200, 'the verified owner can claim ownership with the setup code', `status ${claim.status} ${claim.text.slice(0, 160)}`);
  check(claim.json?.user?.isOwner === true, 'owner status is applied server-side');
  check(claim.json?.user?.title === 'Founder & Owner', 'owner receives the Founder & Owner title');
  check(ownerAccount?.isOwner !== true, 'ownership is not granted at registration');

  const staffQueue = await owner.req('/api/support/staff/tickets');
  check(staffQueue.status === 200, 'the owner can open the staff queue', `status ${staffQueue.status}`);
  check(
    (staffQueue.json?.tickets ?? []).some((entry) => entry.id === ticketId),
    'the staff queue lists member tickets',
  );

  const staffStats = await owner.req('/api/support/staff/stats');
  check(staffStats.status === 200, 'staff statistics load');
  check(typeof staffStats.json?.total === 'number', 'staff statistics report a total');

  const staffReply = await owner.req(`/api/support/staff/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { body: 'Thanks — we are looking into it.', internal: false },
  });
  check(staffReply.status === 201 || staffReply.status === 200, 'staff can reply to a ticket', `status ${staffReply.status}`);

  const internalNote = await owner.req(`/api/support/staff/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { body: 'Internal: storage bucket misconfigured.', internal: true },
  });
  check(internalNote.status === 201 || internalNote.status === 200, 'staff can add an internal note');
  check(internalNote.json?.message?.internal === true, 'internal notes are flagged as internal');

  const memberThread = await member.req(`/api/support/${ticketId}`);
  check(memberThread.status === 200, 'the ticket owner can read the thread');
  check(
    (memberThread.json?.messages ?? []).some((entry) => entry.body?.includes('looking into it')),
    'the member sees the staff reply',
  );
  check(
    !(memberThread.json?.messages ?? []).some((entry) => entry.body?.includes('Internal:')),
    'internal notes never reach the member',
  );

  const resolved = await owner.req(`/api/support/staff/tickets/${ticketId}`, {
    method: 'PATCH',
    body: { status: 'resolved', priority: 'normal' },
  });
  check(resolved.status === 200, 'staff can change status and priority', `status ${resolved.status}`);
  check(resolved.json?.ticket?.status === 'resolved', 'the ticket is resolved');
  check(resolved.json?.ticket?.priority === 'normal', 'the priority is updated');

  const memberAfterResolve = await member.req(`/api/support/${ticketId}`);
  check(memberAfterResolve.json?.ticket?.status === 'resolved', 'the member sees the resolved status');

  const reopen = await member.req(`/api/support/${ticketId}/reopen`, { method: 'POST', body: {} });
  check(reopen.status === 200, 'the member can reopen a resolved ticket', `status ${reopen.status}`);
  check(reopen.json?.ticket?.status === 'open', 'the reopened ticket returns to open');

  const memberClose = await member.req(`/api/support/${ticketId}/close`, { method: 'POST', body: {} });
  check(memberClose.status === 200, 'the member can close their own ticket', `status ${memberClose.status}`);

  // --- Attachments ----------------------------------------------------------
  const form = new FormData();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  form.append('file', new Blob([png], { type: 'image/png' }), 'error.png');
  const upload = await member.req('/api/support/attachments', { method: 'POST', formData: form });
  check(upload.status === 201 || upload.status === 200, 'members can upload a ticket attachment', `status ${upload.status} ${upload.text.slice(0, 160)}`);
  const attachmentId = upload.json?.attachment?.id;
  check(Boolean(attachmentId), 'the upload returns an attachment id');

  const withAttachment = await member.req('/api/support', {
    method: 'POST',
    body: {
      subject: 'Screenshot attached',
      description: 'The error dialog is attached.',
      category: 'other',
      priority: 'low',
      attachments: [{ id: attachmentId, name: 'error.png', mime: 'image/png' }],
    },
  });
  check(withAttachment.status === 201, 'a ticket can be created with an attachment', `status ${withAttachment.status}`);
  const attachedTicket = withAttachment.json?.ticket?.id;
  const attachmentThread = await member.req(`/api/support/${attachedTicket}`);
  check(
    (attachmentThread.json?.messages ?? []).some((entry) => (entry.attachments ?? []).some((file) => file.id === attachmentId)),
    'the attachment is linked to the ticket message',
  );

  const attachmentFetch = await member.req(`/api/support/attachments/${attachmentId}`);
  check(attachmentFetch.status === 200, 'the owner can download their attachment', `status ${attachmentFetch.status}`);
  const foreignFetch = await other.req(`/api/support/attachments/${attachmentId}`);
  check([403, 404].includes(foreignFetch.status), 'other members cannot download the attachment', `status ${foreignFetch.status}`);

  // --- Tutorial progress ----------------------------------------------------
  const initialProgress = await member.req('/api/me/tutorial');
  check(initialProgress.status === 200, 'tutorial progress loads');
  check(initialProgress.json?.progress?.totalLessons === 11, 'eleven tutorial lessons are tracked');
  check(initialProgress.json?.progress?.completed === false, 'a new account has not completed the tutorial');

  const partial = await member.req('/api/me/tutorial', {
    method: 'PATCH',
    body: { completedLessons: ['dashboard', 'profile'], lastLesson: 'profile' },
  });
  check(partial.status === 200, 'tutorial progress can be saved');
  check((partial.json?.progress?.completedLessons ?? []).length === 2, 'completed lessons are stored');
  check(partial.json?.progress?.lastLesson === 'profile', 'the last lesson is stored');

  const reloaded = await member.req('/api/me/tutorial');
  check((reloaded.json?.progress?.completedLessons ?? []).length === 2, 'tutorial progress persists across requests');

  const bogus = await member.req('/api/me/tutorial', {
    method: 'PATCH',
    body: { completedLessons: ['dashboard', 'not-a-lesson'] },
  });
  check(
    (bogus.json?.progress?.completedLessons ?? []).includes('not-a-lesson') === false,
    'unknown lesson ids are discarded',
  );

  const finished = await member.req('/api/me/tutorial', { method: 'PATCH', body: { completed: true } });
  check(finished.json?.progress?.completed === true, 'the tutorial can be marked complete');
  check(typeof finished.json?.progress?.completedAt === 'string', 'completion records a timestamp');

  const otherProgress = await other.req('/api/me/tutorial');
  check(otherProgress.json?.progress?.completed === false, 'tutorial progress is per account');

  const reset = await member.req('/api/me/tutorial', {
    method: 'PATCH',
    body: { completed: false, completedLessons: [], lastLesson: null },
  });
  check(reset.json?.progress?.completed === false, 'progress can be reset for a replay');
  check((reset.json?.progress?.completedLessons ?? []).length === 0, 'a reset clears completed lessons');

  const anonProgress = await anonymous.req('/api/me/tutorial');
  check(anonProgress.status === 401, 'tutorial progress requires a session', `status ${anonProgress.status}`);
} catch (error) {
  failures += 1;
  console.error('\nUnexpected failure:', error);
} finally {
  shutdown();
}

console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
