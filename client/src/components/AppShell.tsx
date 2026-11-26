import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, type User } from '../lib/api';
import { presenceLabel } from '../lib/format';
import { Avatar, OwnerBadge } from './Avatar';
import { LogoMark } from './Logo';
import {
  IconBell,
  IconCompass,
  IconHeadphones,
  IconHeadphonesOff,
  IconHome,
  IconLogout,
  IconMenu,
  IconMessage,
  IconMic,
  IconMicOff,
  IconSearch,
  IconSettings,
  IconShield,
  IconUser,
  IconUsers,
} from './icons';
import { useToast } from './Toast';

type ShellProps = {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  sidebar?: React.ReactNode;
  members?: React.ReactNode;
  headActions?: React.ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
};

const railLinks = [
  { to: '/', label: 'Home', icon: IconHome },
  { to: '/messages', label: 'Messages', icon: IconMessage },
  { to: '/friends', label: 'Friends', icon: IconUsers },
  { to: '/members', label: 'Members', icon: IconUsers },
  { to: '/profile', label: 'My profile', icon: IconUser },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

export function AppShell({ children, title, subtitle, sidebar, members, headActions, search }: ShellProps) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
    setMembersOpen(false);
  }, [title]);

  if (!user) return null;

  const closeOverlays = () => {
    setSidebarOpen(false);
    setMembersOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    toast.info('Signed out', 'See you soon.');
    navigate('/login');
  };

  return (
    <div
      className={`shell ${sidebar ? '' : 'no-sidebar'} ${members ? '' : 'no-members'} ${sidebarOpen ? 'sidebar-open' : ''} ${membersOpen ? 'members-open' : ''}`}
    >
      <nav className="rail" aria-label="Primary">
        <NavLink to="/" className="rail-logo" aria-label="Chatter home">
          <LogoMark size={40} />
        </NavLink>
        <div className="rail-sep" />
        {railLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) => `rail-btn${isActive ? ' rail-btn-active' : ''}`}
            aria-label={link.label}
            title={link.label}
          >
            <link.icon size={20} />
            <span className="rail-tip">{link.label}</span>
          </NavLink>
        ))}
        <div className="rail-spacer" />
        <button type="button" className="rail-btn" aria-label="Sign out" onClick={handleLogout}>
          <IconLogout size={19} />
          <span className="rail-tip">Sign out</span>
        </button>
      </nav>

      {sidebar && (
        <aside className="sidebar" aria-label="Section navigation">
          {sidebar}
          <UserPanel
            user={user}
            muted={muted}
            deafened={deafened}
            onToggleMute={() => {
              setMuted((value) => !value);
              toast.info(muted ? 'Microphone unmuted' : 'Microphone muted', 'Microphone state is applied to calls in Stage 4.');
            }}
            onToggleDeafen={() => {
              setDeafened((value) => !value);
              toast.info(deafened ? 'Undeafened' : 'Deafened', 'Audio routing is applied to calls in Stage 4.');
            }}
            onSettings={() => navigate('/settings')}
          />
        </aside>
      )}

      <main className="main">
        <header className="main-head">
          {sidebar && (
            <button
              type="button"
              className="icon-btn mobile-only"
              aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <IconMenu size={20} />
            </button>
          )}
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 className="truncate">{title}</h1>
            {subtitle && <div className="head-sub truncate">{subtitle}</div>}
          </div>
          {search && (
            <div className="row" style={{ flex: '0 1 320px', minWidth: 140 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                  <IconSearch size={16} />
                </span>
                <input
                  className="input"
                  style={{ paddingLeft: 34, minHeight: 38 }}
                  type="search"
                  value={search.value}
                  placeholder={search.placeholder}
                  aria-label={search.placeholder}
                  onChange={(event) => search.onChange(event.target.value)}
                />
              </div>
            </div>
          )}
          {headActions}
          {members && (
            <button
              type="button"
              className="icon-btn mobile-only"
              aria-label={membersOpen ? 'Hide members' : 'Show members'}
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen((open) => !open)}
            >
              <IconUsers size={20} />
            </button>
          )}
        </header>
        <div className="main-scroll">{children}</div>
      </main>

      {members && (
        <aside className="members" aria-label="Members">
          <div className="sidebar-head">
            <span className="sidebar-title">Members</span>
          </div>
          <div className="members-scroll">{members}</div>
        </aside>
      )}

      {(sidebarOpen || membersOpen) && <div className="scrim" onClick={closeOverlays} aria-hidden="true" />}
    </div>
  );
}

function UserPanel({
  user,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onSettings,
}: {
  user: User;
  muted: boolean;
  deafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onSettings: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="user-panel">
      <button
        type="button"
        onClick={() => navigate('/profile')}
        style={{ background: 'none', border: 0, padding: 0, display: 'flex' }}
        aria-label="Open my profile"
      >
        <Avatar user={user} size="sm" showPresence />
      </button>
      <div className="user-panel-info">
        <div className="user-panel-name truncate">
          {user.displayName}
          {user.isOwner && (
            <span style={{ marginLeft: 6 }}>
              <OwnerBadge compact />
            </span>
          )}
        </div>
        <div className="user-panel-status truncate">{user.customStatus || presenceLabel(user.presence)}</div>
      </div>
      <div className="user-panel-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={muted}
          onClick={onToggleMute}
        >
          {muted ? <IconMicOff size={17} /> : <IconMic size={17} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={deafened ? 'Undeafen' : 'Deafen'}
          aria-pressed={deafened}
          onClick={onToggleDeafen}
        >
          {deafened ? <IconHeadphonesOff size={17} /> : <IconHeadphones size={17} />}
        </button>
        <button type="button" className="icon-btn" aria-label="User settings" onClick={onSettings}>
          <IconSettings size={17} />
        </button>
      </div>
    </div>
  );
}

/** Sidebar used across the Stage 1 screens. */
export function DefaultSidebar({ active }: { active: 'home' | 'messages' | 'friends' | 'members' | 'profile' | 'settings' | 'owner' }) {
  const { user } = useAuth();
  return (
    <>
      <div className="sidebar-head">
        <div>
          <div className="sidebar-subtitle">Chatter</div>
          <div className="sidebar-title">Community hub</div>
        </div>
      </div>
      <div className="sidebar-scroll">
        <div className="nav-section-label">Workspace</div>
        <NavLink to="/" className="nav-item" data-active={active === 'home'}>
          <IconHome size={17} /> Home
        </NavLink>
        <NavLink to="/messages" className="nav-item" data-active={active === 'messages'}>
          <IconMessage size={17} /> Direct messages
        </NavLink>
        <NavLink to="/friends" className="nav-item" data-active={active === 'friends'}>
          <IconUsers size={17} /> Friends
        </NavLink>
        <NavLink to="/members" className="nav-item" data-active={active === 'members'}>
          <IconUsers size={17} /> Members
        </NavLink>
        <NavLink to="/profile" className="nav-item" data-active={active === 'profile'}>
          <IconUser size={17} /> My profile
        </NavLink>

        <div className="nav-section-label">Account</div>
        <NavLink to="/settings" className="nav-item" data-active={active === 'settings'}>
          <IconSettings size={17} /> Settings
        </NavLink>
        {user?.isOwner && (
          <div className="nav-item" style={{ color: 'var(--gold)', cursor: 'default' }} title="The owner console arrives in Stage 5">
            <IconShield size={17} /> Owner console
            <span className="nav-count">Stage 5</span>
          </div>
        )}

        <div className="nav-section-label">Roadmap</div>
        <div className="nav-item" style={{ opacity: 0.55, cursor: 'default' }} title="Servers and channels arrive in Stage 3">
          <IconCompass size={17} /> Discover servers
          <span className="nav-count">Stage 3</span>
        </div>
        <div className="nav-item" style={{ opacity: 0.55, cursor: 'default' }} title="Notifications arrive in Stage 6">
          <IconBell size={17} /> Notifications
          <span className="nav-count">Stage 6</span>
        </div>
      </div>
    </>
  );
}

/** Member list used in the right sidebar. */
export function MemberList({ users, loading }: { users: User[]; loading?: boolean }) {
  const online = users.filter((entry) => entry.presence !== 'offline');
  const offline = users.filter((entry) => entry.presence === 'offline');

  if (loading) {
    return (
      <div className="stack">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="row" style={{ padding: '7px 8px' }}>
            <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 10 }} />
            <div className="skeleton" style={{ height: 10, flex: 1 }} />
          </div>
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return <p className="muted small" style={{ padding: 8 }}>No members to show yet.</p>;
  }

  return (
    <div className="stack" style={{ gap: 4 }}>
      <MemberGroup label={`Online — ${online.length}`} users={online} />
      {offline.length > 0 && <MemberGroup label={`Offline — ${offline.length}`} users={offline} />}
    </div>
  );
}

function MemberGroup({ label, users }: { label: string; users: User[] }) {
  if (users.length === 0) return null;
  return (
    <div>
      <div className="nav-section-label">{label}</div>
      {users.map((member) => (
        <NavLink key={member.id} to={`/u/${member.username}`} className="member-row">
          <Avatar user={member} size="sm" showPresence />
          <span className="grow truncate">
            <span className="member-name truncate" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="truncate">{member.displayName}</span>
              {member.isOwner && <OwnerBadge compact />}
            </span>
          </span>
        </NavLink>
      ))}
    </div>
  );
}

export function useDirectory() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api
      .users('', 40)
      .then((data) => {
        if (!cancelled) setUsers(data.users);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { users, loading };
}
