import { Link, useParams } from 'react-router-dom';
import { AppShell, DefaultSidebar, MemberList, useDirectory } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { EmptyState, InlineLoader } from '../components/LoadingScreen';
import { IconChevronLeft, IconUser } from '../components/icons';
import { useAuth } from '../lib/auth';
import { useAsyncData } from '../components/profile-shared';
import { api } from '../lib/api';
import { formatDate, presenceLabel } from '../lib/format';

export default function ProfileView() {
  const { username = '' } = useParams();
  const { user: viewer } = useAuth();
  const directory = useDirectory();
  const { data, loading, error } = useAsyncData(() => api.user(username), [username]);

  const user = data?.user;
  const isSelf = Boolean(user && viewer && user.id === viewer.id);

  return (
    <AppShell
      title={user ? user.displayName : 'Profile'}
      subtitle={user ? `@${user.username}` : 'Member profile'}
      sidebar={<DefaultSidebar active="members" />}
      members={<MemberList users={directory.users} loading={directory.loading} />}
      headActions={
        <Link className="btn btn-ghost btn-sm" to="/members">
          <IconChevronLeft size={15} /> Members
        </Link>
      }
    >
      {loading ? (
        <InlineLoader label="Loading profile" />
      ) : error || !user ? (
        <EmptyState
          title="Profile not found"
          description={error ?? 'That account does not exist, or it is no longer available.'}
          icon={<IconUser size={26} />}
          action={
            <Link className="btn btn-primary" to="/members">
              Browse members
            </Link>
          }
        />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <section className="profile-head">
            <div
              className="profile-banner"
              style={
                user.bannerUrl
                  ? { backgroundImage: `url(${user.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: `linear-gradient(120deg, ${user.bannerColor || '#0f2b46'}, #0a1526 70%)` }
              }
            />
            <div className="profile-body">
              <div className="profile-avatar">
                <Avatar user={user} size="xl" showPresence />
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: 22, letterSpacing: '-0.02em' }}>{user.displayName}</h2>
                  {user.isOwner && <OwnerBadge />}
                </div>
                <div className="muted small">
                  @{user.username}
                  {user.pronouns ? ` · ${user.pronouns}` : ''} · {presenceLabel(user.presence)}
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {user.title ? `${user.title} · ` : ''}Member since {formatDate(user.createdAt)}
                </div>
              </div>
              {isSelf && (
                <Link className="btn btn-sm btn-primary" to="/profile">
                  Edit profile
                </Link>
              )}
            </div>
          </section>

          <div className="settings-layout">
            <div className="stack" style={{ gap: 16 }}>
              <section className="card">
                <div className="section-head">About</div>
                <div className="card-pad">
                  {user.aboutMe ? (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{user.aboutMe}</p>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      {user.displayName} has not written an introduction yet.
                    </p>
                  )}
                </div>
              </section>

              <section className="card">
                <div className="section-head">Status</div>
                <div className="card-pad stack" style={{ gap: 10 }}>
                  <div className="row-between">
                    <span className="muted small">Presence</span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="status-dot" data-presence={user.presence} />
                      {presenceLabel(user.presence)}
                    </span>
                  </div>
                  <div className="divider" />
                  <div className="row-between">
                    <span className="muted small">Custom status</span>
                    <span>{user.customStatus || '—'}</span>
                  </div>
                  <div className="divider" />
                  <div className="row-between">
                    <span className="muted small">Last seen</span>
                    <span>{user.lastSeenAt ? formatDate(user.lastSeenAt) : 'Not yet seen'}</span>
                  </div>
                </div>
              </section>
            </div>

            <div className="stack" style={{ gap: 16 }}>
              <section className="card">
                <div className="section-head">Details</div>
                <div className="card-pad stack" style={{ gap: 10 }}>
                  <div className="row-between">
                    <span className="muted small">Joined Chatter</span>
                    <span>{formatDate(user.createdAt)}</span>
                  </div>
                  <div className="divider" />
                  <div className="row-between">
                    <span className="muted small">Account</span>
                    <span className="badge" data-kind={user.emailVerified ? 'success' : 'warning'}>
                      {user.emailVerified ? 'Verified' : 'Unverified'}
                    </span>
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

              <section className="card card-pad stack">
                <div style={{ fontWeight: 650 }}>Connecting with {user.displayName.split(' ')[0]}</div>
                <p className="small muted" style={{ margin: 0 }}>
                  Friend requests, direct messages and voice calls arrive in Stage 2 and Stage 4. For now you can explore
                  the community directory.
                </p>
                <Link className="btn btn-ghost" to="/members">
                  Browse the directory
                </Link>
              </section>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
