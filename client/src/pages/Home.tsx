import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, DefaultSidebar, MemberList, useDirectory } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { EmptyState } from '../components/LoadingScreen';
import { IconCompass, IconSettings, IconShield, IconSparkle, IconUsers } from '../components/icons';
import { useAuth } from '../lib/auth';
import { api, type PlatformStats, type User } from '../lib/api';
import { formatDate, presenceLabel } from '../lib/format';

export default function Home() {
  const { user } = useAuth();
  const directory = useDirectory();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [recent, setRecent] = useState<User[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .stats()
      .then((data) => {
        if (cancelled) return;
        setStats(data.stats);
        setRecent(data.recentMembers);
      })
      .catch(() => {
        if (!cancelled) setError('Chatter could not load community statistics right now.');
      })
      .finally(() => {
        if (!cancelled) setLoadingStats(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return 'Still up';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  if (!user) return null;

  return (
    <AppShell
      title="Home"
      subtitle="Your community at a glance"
      sidebar={<DefaultSidebar active="home" />}
      members={<MemberList users={directory.users} loading={directory.loading} />}
    >
      <div className="stack" style={{ gap: 18 }}>
        <section className="hero">
          <div className="hero-content">
            <div className="row" style={{ gap: 8 }}>
              <span className="badge">
                <IconSparkle size={12} /> Stage 1 · Foundation
              </span>
              <span className="badge">{presenceLabel(user.presence)}</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 30, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
              {greeting}, {user.displayName.split(' ')[0]}
            </h2>
            <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
              Your community. Your conversations. Your Chatter. Accounts, profiles, presence and the full workspace are
              live — direct messages arrive in Stage 2.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/members">
                <IconUsers size={16} /> Browse members
              </Link>
              <Link className="btn btn-ghost" to="/profile">
                Edit my profile
              </Link>
              <Link className="btn btn-ghost" to="/settings">
                <IconSettings size={16} /> Settings
              </Link>
            </div>
          </div>
          <div className="hero-mark" aria-hidden="true">
            <Avatar user={user} size="xxl" showPresence />
          </div>
        </section>

        {error && (
          <div className="notice" data-kind="error" role="alert">
            {error}
          </div>
        )}

        <div className="stat-grid">
          <StatCard label="Members" value={loadingStats ? null : stats?.totalUsers} meta="Registered accounts" />
          <StatCard label="Online now" value={loadingStats ? null : stats?.onlineUsers} meta="Active in the last 2 minutes" />
          <StatCard label="Verified" value={loadingStats ? null : stats?.verifiedUsers} meta="Confirmed email addresses" />
          <StatCard label="New this week" value={loadingStats ? null : stats?.newThisWeek} meta="Fresh Chatter accounts" />
        </div>

        <div className="settings-layout">
          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <div className="section-head">
                <span>Your account</span>
                <Link className="tiny" to="/settings">
                  Manage
                </Link>
              </div>
              <div className="card-pad stack" style={{ gap: 12 }}>
                <div className="row-between">
                  <span className="muted small">Display name</span>
                  <span className="row" style={{ gap: 6 }}>
                    {user.displayName}
                    {user.isOwner && <OwnerBadge compact />}
                  </span>
                </div>
                <div className="divider" />
                <div className="row-between">
                  <span className="muted small">Username</span>
                  <span className="mono">@{user.username}</span>
                </div>
                <div className="divider" />
                <div className="row-between">
                  <span className="muted small">Email</span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="truncate" style={{ maxWidth: 220 }}>{user.email ?? '—'}</span>
                    <span className="badge" data-kind={user.emailVerified ? 'success' : 'warning'}>
                      {user.emailVerified ? 'Verified' : 'Unverified'}
                    </span>
                  </span>
                </div>
                <div className="divider" />
                <div className="row-between">
                  <span className="muted small">Member since</span>
                  <span>{formatDate(user.createdAt)}</span>
                </div>
                {user.title && (
                  <>
                    <div className="divider" />
                    <div className="row-between">
                      <span className="muted small">Title</span>
                      <span>{user.title}</span>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="card">
              <div className="section-head">
                <span>Newest members</span>
                <Link className="tiny" to="/members">
                  See all
                </Link>
              </div>
              {recent.length === 0 ? (
                <EmptyState title="No other members yet" description="Invite someone to Chatter and they will appear here." icon={<IconUsers size={26} />} />
              ) : (
                <div className="list-card">
                  {recent.map((member) => (
                    <Link key={member.id} to={`/u/${member.username}`} className="list-row">
                      <Avatar user={member} size="sm" showPresence />
                      <span className="grow truncate">
                        <span className="row" style={{ gap: 6 }}>
                          <span className="truncate">{member.displayName}</span>
                          {member.isOwner && <OwnerBadge compact />}
                        </span>
                        <span className="tiny muted truncate">@{member.username}</span>
                      </span>
                      <span className="tiny muted">{formatDate(member.createdAt, { month: 'short', day: 'numeric' })}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="stack" style={{ gap: 16 }}>
            <section className="card card-pad stack">
              <div className="row" style={{ gap: 8 }}>
                <IconShield size={18} />
                <span style={{ fontWeight: 650 }}>Built on real security</span>
              </div>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Passwords hashed with scrypt, never stored in plaintext.</li>
                <li>Opaque session cookies, hashed at rest and revocable per device.</li>
                <li>Every profile and directory request is authorised on the server.</li>
                <li>Rate limits on login, registration and password reset.</li>
              </ul>
            </section>

            <section className="card card-pad stack">
              <div className="row" style={{ gap: 8 }}>
                <IconCompass size={18} />
                <span style={{ fontWeight: 650 }}>What is coming next</span>
              </div>
              <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                <li>Stage 2 — friends, direct messages, groups, real-time messaging.</li>
                <li>Stage 3 — servers, channels, invitations, roles and permissions.</li>
                <li>Stage 4 — voice, video and screen sharing.</li>
                <li>Stage 5 — owner console, staff tools, moderation, audit logs.</li>
                <li>Stage 6 — notifications, PWA, tablet and mobile polish.</li>
              </ol>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, meta }: { label: string; value: number | null | undefined; meta: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value === null || value === undefined ? '—' : value.toLocaleString()}</span>
      <span className="stat-meta">{meta}</span>
    </div>
  );
}
