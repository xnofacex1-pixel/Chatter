#!/usr/bin/env node
/**
 * Stage 5 functional check — owner console, staff, moderation and audit.
 *
 * Boots the real Chatter server against a throwaway SQLite file and exercises
 * the platform administration contract end to end: verified owner promotion,
 * owner-only endpoint protection, privilege-escalation attempts from ordinary
 * accounts, suspend/ban lifecycle, staff grants, report resolution, platform
 * settings and the audit trail.
 *
 * Usage: node scripts/verify-stage5.mjs
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const PORT = Number(process.env.CHECK_PORT || 4615);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(tmpdir(), `chatter-stage5-${process.pid}.db`);
const PASSWORD = 'ChatterTest!2026';
const OWNER_EMAIL = 'masongiacoppo@outlook.com';

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

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_FILE: DB_FILE, NODE_ENV: 'test', OWNER_SETUP_CODE: 'stage5-owner-code' },
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
  console.log('\nStage 5 — owner console, staff, moderation and audit\n');

  const owner = client();
  const member = client();
  const staff = client();
  const doomed = client();

  const register = async (c, username, email) => {
    const res = await c.req('/api/auth/register', {
      method: 'POST',
      body: { username, email, password: PASSWORD },
    });
    check(res.status === 201, `register ${username}`, `status ${res.status} ${res.text.slice(0, 140)}`);
    return res.json?.user ?? res.json;
  };

  const claimOwner = async (c, code) => c.req('/api/auth/owner-claim', { method: 'POST', body: { code } });

  const ownerAccount = await register(owner, 'chatterowner', OWNER_EMAIL);
  const memberAccount = await register(member, 'stage5member', 'stage5member@example.com');
  const staffAccount = await register(staff, 'stage5staff', 'stage5staff@example.com');
  const doomedAccount = await register(doomed, 'stage5doomed', 'stage5doomed@example.com');

  const ownerId = ownerAccount?.id;
  const memberId = memberAccount?.id;
  const staffId = staffAccount?.id;
  const doomedId = doomedAccount?.id;

  check(Boolean(ownerId && memberId && staffId && doomedId), 'all test accounts created');

  // --- Owner access is granted server-side through the setup code -------------
  check(ownerAccount?.isOwner !== true, 'owner status is not granted at registration');
  check(ownerAccount?.email === OWNER_EMAIL, 'owner account registered with the configured email');
  const wrongCode = await claimOwner(owner, 'definitely-wrong');
  check(wrongCode.status === 403, 'incorrect owner setup code is rejected', `status ${wrongCode.status}`);
  const memberClaim = await claimOwner(member, 'stage5-owner-code');
  check(memberClaim.status === 403, 'non-owner account cannot claim owner access', `status ${memberClaim.status}`);
  const claimed = await claimOwner(owner, 'stage5-owner-code');
  check(claimed.status === 200 && claimed.json?.user?.isOwner === true, 'owner setup code promotes the configured account', `status ${claimed.status}`);
  check(claimed.json?.user?.title === 'Founder & Owner', 'owner receives the Founder & Owner title', claimed.json?.user?.title);
  const memberAfterClaim = await member.req('/api/auth/session');
  check(memberAfterClaim.json?.user?.isOwner !== true, 'ordinary account stays non-owner');

  const ownerSession = await owner.req('/api/auth/session');
  check(ownerSession.json?.user?.isOwner === true, 'session payload exposes the owner flag');

  // --- Owner-only protection -------------------------------------------------
  for (const path of ['/api/admin/overview', '/api/admin/users', '/api/admin/servers', '/api/admin/staff', '/api/admin/reports', '/api/admin/settings', '/api/admin/audit']) {
    const res = await member.req(path);
    check(res.status === 403, `non-owner blocked from ${path}`, `status ${res.status}`);
  }

  // The access probe is intentionally readable so the console can render its denial screen.
  const memberAccess = await member.req('/api/admin/access');
  check(memberAccess.status === 200 && memberAccess.json?.owner === false, 'non-owner access probe reports no owner rights');
  check(
    Array.isArray(memberAccess.json?.permissions) && memberAccess.json.permissions.length === 0,
    'non-owner access probe grants no staff permissions',
  );

  const escalation = await member.req('/api/admin/staff', {
    method: 'POST',
    body: { userId: memberId, role: 'administrator', permissions: ['moderate.users'] },
  });
  check(escalation.status === 403, 'member cannot grant themselves staff permissions', `status ${escalation.status}`);

  const memberSettings = await member.req('/api/admin/settings', { method: 'PATCH', body: { maintenanceMode: true } });
  check(memberSettings.status === 403, 'member cannot change platform settings');

  const access = await owner.req('/api/admin/access');
  check(access.json?.owner === true, 'owner console access reports owner');
  check(Array.isArray(access.json?.available) && access.json.available.length >= 4, 'staff permission catalogue exposed');

  // --- Dashboard -------------------------------------------------------------
  const overview = await owner.req('/api/admin/overview');
  check(overview.status === 200, 'owner dashboard responds');
  const stats = overview.json?.stats;
  check(stats?.totalUsers >= 4, 'dashboard counts registered accounts', String(stats?.totalUsers));
  check(typeof stats?.totalMessages === 'number' && typeof stats?.totalServers === 'number', 'dashboard reports messages and communities');
  check(overview.json?.health?.status === 'ok', 'system health reported', JSON.stringify(overview.json?.health));
  check(overview.json?.health?.database === 'connected', 'database health reported');
  check(Array.isArray(overview.json?.recentActivity) && overview.json.recentActivity.length > 0, 'recent administrative activity present');
  check(
    overview.json?.recentActivity?.some((entry) => entry.action === 'owner.granted'),
    'owner grant recorded in recent activity',
  );

  const userSearch = await owner.req('/api/admin/users?query=stage5member');
  const foundMember = userSearch.json?.users?.find((entry) => entry.id === memberId);
  check(Boolean(foundMember), 'owner can search accounts');
  check(foundMember?.email === 'stage5member@example.com', 'owner sees account email');
  check(typeof foundMember?.serverCount === 'number' && typeof foundMember?.messageCount === 'number', 'owner sees account activity counts');

  // --- Suspension ------------------------------------------------------------
  const suspend = await owner.req(`/api/admin/users/${memberId}/suspend`, {
    method: 'POST',
    body: { hours: 24, reason: 'Stage 5 check' },
  });
  check(suspend.status === 200, 'owner can suspend an account', `status ${suspend.status} ${suspend.text.slice(0, 140)}`);

  const memberBlocked = await member.req('/api/me');
  check([401, 403].includes(memberBlocked.status), 'suspended session is rejected', `status ${memberBlocked.status}`);

  const suspendedLogin = await client().req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'stage5member@example.com', password: PASSWORD },
  });
  check(suspendedLogin.status === 403, 'suspended account cannot log in', `status ${suspendedLogin.status}`);
  check(suspendedLogin.json?.error?.code === 'account_suspended', 'suspension error code returned', JSON.stringify(suspendedLogin.json?.error));

  const unsuspend = await owner.req(`/api/admin/users/${memberId}/unsuspend`, { method: 'POST', body: {} });
  check(unsuspend.status === 200, 'owner can lift a suspension');
  const recovered = await client().req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'stage5member@example.com', password: PASSWORD },
  });
  check(recovered.status === 200, 'unsuspended account can log in again', `status ${recovered.status}`);

  // --- Ban / unban -----------------------------------------------------------
  const ban = await owner.req(`/api/admin/users/${memberId}/ban`, { method: 'POST', body: { reason: 'Stage 5 check' } });
  check(ban.status === 200, 'owner can ban an account');
  const bannedLogin = await client().req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'stage5member@example.com', password: PASSWORD },
  });
  check(bannedLogin.status === 403 && bannedLogin.json?.error?.code === 'account_banned', 'banned account cannot log in', JSON.stringify(bannedLogin.json?.error));
  const unban = await owner.req(`/api/admin/users/${memberId}/unban`, { method: 'POST', body: {} });
  check(unban.status === 200, 'owner can unban an account');

  // Banning revokes sessions, so re-authenticate before any further member action.
  const memberRelogin = await member.req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'stage5member@example.com', password: PASSWORD },
  });
  check(memberRelogin.status === 200, 'unbanned account can authenticate again', `status ${memberRelogin.status}`);

  // --- Owner account is protected -------------------------------------------
  const selfSuspend = await owner.req(`/api/admin/users/${ownerId}/suspend`, {
    method: 'POST',
    body: { hours: 1, reason: 'should fail' },
  });
  check(selfSuspend.status === 400 || selfSuspend.status === 403, 'owner account cannot be suspended', `status ${selfSuspend.status}`);
  const selfDelete = await owner.req(`/api/admin/users/${ownerId}`, {
    method: 'DELETE',
    body: { confirm: 'chatterowner' },
  });
  check(selfDelete.status === 400 || selfDelete.status === 403, 'owner account cannot be deleted', `status ${selfDelete.status}`);

  // --- Staff management ------------------------------------------------------
  const grant = await owner.req('/api/admin/staff', {
    method: 'POST',
    body: { userId: staffId, role: 'moderator', permissions: ['moderate.users', 'view.reports'] },
  });
  check(grant.status === 200, 'owner can grant a staff role', `status ${grant.status} ${grant.text.slice(0, 140)}`);

  const staffList = await owner.req('/api/admin/staff');
  const staffEntry = staffList.json?.staff?.find((entry) => entry.userId === staffId);
  check(Boolean(staffEntry), 'granted staff member listed');
  check(staffEntry?.role === 'moderator', 'staff role stored', staffEntry?.role);
  check(staffEntry?.permissions?.includes('view.reports'), 'staff permissions stored', JSON.stringify(staffEntry?.permissions));

  const staffDenied = await staff.req('/api/admin/overview');
  check(staffDenied.status === 403, 'staff without owner rights cannot open the owner dashboard', `status ${staffDenied.status}`);

  const revoke = await owner.req(`/api/admin/staff/${staffEntry?.id}`, { method: 'DELETE' });
  check(revoke.status === 200, 'owner can revoke staff access');
  const afterRevoke = await owner.req('/api/admin/staff');
  check(!afterRevoke.json?.staff?.some((entry) => entry.userId === staffId), 'revoked staff access removed');

  // --- Reports ---------------------------------------------------------------
  {
    const db = new Database(DB_FILE);
    try {
      db.prepare(
        `INSERT INTO reports (id, reporter_id, target_type, target_id, reported_user_id, reason, details, status, created_at)
         VALUES (?, ?, 'user', ?, ?, 'Harassment', 'Stage 5 verification report', 'open', ?)`,
      ).run(randomUUID(), staffId, memberId, memberId, new Date().toISOString());
    } finally {
      db.close();
    }
  }
  const reports = await owner.req('/api/admin/reports?status=open');
  const openReport = reports.json?.reports?.find((entry) => entry.reason === 'Harassment');
  check(Boolean(openReport), 'owner sees open reports');
  check(openReport?.reported?.username === 'stage5member', 'report identifies the reported account', JSON.stringify(openReport?.reported));

  const resolve = await owner.req(`/api/admin/reports/${openReport?.id}/resolve`, {
    method: 'POST',
    body: { status: 'resolved', note: 'Handled in Stage 5 verification' },
  });
  check(resolve.status === 200, 'owner can resolve a report', `status ${resolve.status}`);
  const resolved = await owner.req('/api/admin/reports?status=resolved');
  check(
    resolved.json?.reports?.some((entry) => entry.id === openReport?.id && entry.resolutionNote === 'Handled in Stage 5 verification'),
    'resolved report stores the resolution note',
  );

  // --- Communities -----------------------------------------------------------
  const created = await member.req('/api/servers', { method: 'POST', body: { name: 'Stage 5 Community' } });
  const serverId = created.json?.server?.id ?? created.json?.id;
  check(created.status === 201 || created.status === 200, 'member creates a community for review', `status ${created.status}`);

  const adminServers = await owner.req('/api/admin/servers?query=Stage%205');
  const adminServer = adminServers.json?.servers?.find((entry) => entry.id === serverId);
  check(Boolean(adminServer), 'owner can search communities');
  check(adminServer?.owner_username === 'stage5member', 'community owner resolved', adminServer?.owner_username);

  const suspendServer = await owner.req(`/api/admin/servers/${serverId}/suspend`, {
    method: 'POST',
    body: { reason: 'Stage 5 check' },
  });
  check(suspendServer.status === 200, 'owner can suspend a community');
  const suspendedList = await owner.req('/api/admin/servers?query=Stage%205');
  check(
    suspendedList.json?.servers?.some((entry) => entry.id === serverId && entry.is_suspended === 1),
    'suspended community flagged',
  );
  const restoreServer = await owner.req(`/api/admin/servers/${serverId}/unsuspend`, { method: 'POST', body: {} });
  check(restoreServer.status === 200, 'owner can restore a community');

  // --- Platform settings -----------------------------------------------------
  const settingsPatch = await owner.req('/api/admin/settings', {
    method: 'PATCH',
    body: { announcement: 'Stage 5 verification announcement', uploadLimitMb: 42, registrationOpen: true },
  });
  check(settingsPatch.status === 200, 'owner can update platform settings', `status ${settingsPatch.status}`);
  const settingsRead = await owner.req('/api/admin/settings');
  check(settingsRead.json?.settings?.announcement === 'Stage 5 verification announcement', 'announcement persisted');
  check(settingsRead.json?.settings?.uploadLimitMb === 42, 'upload limit persisted', String(settingsRead.json?.settings?.uploadLimitMb));

  // --- Deletion guards -------------------------------------------------------
  const wrongConfirm = await owner.req(`/api/admin/users/${doomedId}`, { method: 'DELETE', body: { confirm: 'not-the-name' } });
  check(wrongConfirm.status === 400, 'account deletion requires the exact username', `status ${wrongConfirm.status}`);
  const deleted = await owner.req(`/api/admin/users/${doomedId}`, { method: 'DELETE', body: { confirm: 'stage5doomed' } });
  check(deleted.status === 200, 'owner can delete an account after confirmation', `status ${deleted.status}`);
  const goneLogin = await client().req('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'stage5doomed@example.com', password: PASSWORD },
  });
  check(goneLogin.status === 401, 'deleted account can no longer log in', `status ${goneLogin.status}`);

  const serverConfirm = await owner.req(`/api/admin/servers/${serverId}`, { method: 'DELETE', body: { confirm: 'nope' } });
  check(serverConfirm.status === 400, 'community removal requires the exact name', `status ${serverConfirm.status}`);
  const serverDeleted = await owner.req(`/api/admin/servers/${serverId}`, {
    method: 'DELETE',
    body: { confirm: 'Stage 5 Community' },
  });
  check(serverDeleted.status === 200, 'owner can remove a community after confirmation', `status ${serverDeleted.status}`);

  // --- Audit trail -----------------------------------------------------------
  const audit = await owner.req('/api/admin/audit?limit=200');
  const actions = new Set((audit.json?.entries ?? []).map((entry) => entry.action));
  for (const expected of [
    'owner.granted',
    'admin.user_suspended',
    'admin.user_unsuspended',
    'admin.user_banned',
    'admin.user_unbanned',
    'admin.user_deleted',
    'admin.server_suspended',
    'admin.server_unsuspended',
    'admin.server_removed',
    'admin.staff_granted',
    'admin.staff_revoked',
    'admin.report_resolved',
    'admin.settings_updated',
  ]) {
    check(actions.has(expected), `audit log records ${expected}`);
  }
  check(
    (audit.json?.entries ?? [])
      .filter((entry) => entry.action.startsWith('admin.'))
      .every((entry) => entry.actorName || entry.actorUsername),
    'administrative audit entries name the acting administrator',
  );
  const auditSearch = await owner.req('/api/admin/audit?query=staff');
  check((auditSearch.json?.entries ?? []).length > 0, 'audit log is searchable');

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — Stage 5 checks: ${failures} failure(s)\n`);
} catch (error) {
  failures += 1;
  console.error('\nStage 5 check crashed:', error);
} finally {
  shutdown();
}

process.exit(failures === 0 ? 0 : 1);
