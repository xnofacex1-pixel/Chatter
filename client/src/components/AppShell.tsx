import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { notificationsApi } from '../lib/notifications';
import { useRealtime } from '../lib/realtime';
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
  IconPanelRight,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkle,
  IconUser,
  IconUsers,
  IconClose,
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
  { to: '/servers', label: 'Communities', icon: IconCompass },
  { to: '/messages', label: 'Messages', icon: IconMessage },
  { to: '/friends', label: 'Friends', icon: IconUsers },
  { to: '/ai', label: 'Chatter AI', icon: IconSparkle },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

const tabItems = [
  { to: '/', label: 'Home', icon: IconHome, end: true },
  { to: '/messages', label: 'Messages', icon: IconMessage, badge: true },
  { to: '/friends', label: 'Friends', icon: IconUsers },
  { to: '/servers', label: 'Servers', icon: IconCompass },
  { to: '/ai', label: 'AI', icon: IconSparkle },
  { to: '/profile', label: 'You', icon: IconUser },
];

const RAIL_KEY = 'chatter.railCollapsed';
const WIDTH_KEY = 'chatter.sidebarWidth';
const MIN_WIDTH = 232;
const MAX_WIDTH = 420;

function matches(pathname: string, to: string, end?: boolean) {
  if (end || to === '/') return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell({ children, title, subtitle, sidebar, members, headActions, search }: ShellProps) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [unread, setUnread] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : 288;
    } catch {
      return 288;
    }
  });
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setSidebarOpen(false);
    setMembersOpen(false);
  }, [title, pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railCollapsed ? '1' : '0');
      localStorage.setItem(WIDTH_KEY, String(Math.round(sidebarWidth)));
    } catch {
      // Private browsing can block storage; the layout still works for this session.
    }
  }, [railCollapsed, sidebarWidth]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        setMembersOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setMembersOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b' && !event.shiftKey) {
        event.preventDefault();
        setRailCollapsed((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      notificationsApi
        .unread()
        .then((result) => {
          if (!cancelled) setUnread(result.unread);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useRealtime((event) => {
    if (event !== 'notification') return;
    notificationsApi
      .unread()
      .then((result) => setUnread(result.unread))
      .catch(() => undefined);
  });

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
      const onMove = (move: PointerEvent) => {
        if (!dragRef.current) return;
        const delta = move.clientX - dragRef.current.startX;
        setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta)));
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [sidebarWidth],
  );

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

  const classes = [
    'shell',
    sidebar ? '' : 'no-sidebar',
    members ? '' : 'no-members',
    sidebarOpen ? 'sidebar-open' : '',
    membersOpen ? 'members-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-rail={railCollapsed ? 'collapsed' : 'expanded'}
      style={sidebar ? ({ ['--sidebar-channels' as string]: `${sidebarWidth}px` } as React.CSSProperties) : undefined}
    >
      <nav className="rail" aria-label="Primary">
        <NavLink to="/" className="rail-logo" aria-label="Chatter home">
          <LogoMark size={24} />
        </NavLink>
        <div className="rail-sep" />
        {railLinks.map((link) => {
          const active = matches(pathname, link.to, link.to === '/');
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className="rail-btn"
              data-active={active}
              aria-label={link.label}
              aria-current={active ? 'page' : undefined}
            >
              <link.icon size={20} />
              <span className="rail-tip">{link.label}</span>
            </NavLink>
          );
        })}
        <div className="rail-spacer" />
        {user.isOwner && (
          <NavLink
            to="/owner"
            className="rail-btn"
            data-active={matches(pathname, '/owner')}
            aria-label="Owner console"
          >
            <IconShield size={19} />
            <span className="rail-tip">Owner console</span>
          </NavLink>
        )}
        <button type="button" className="rail-btn" aria-label="Sign out" onClick={handleLogout}>
          <IconLogout size={19} />
          <span className="rail-tip">Sign out</span>
        </button>
      </nav>

      {railCollapsed && (
        <button
          type="button"
          className="rail-restore"
          aria-label="Show navigation rail"
          onClick={() => setRailCollapsed(false)}
        >
          <IconMenu size={17} />
        </button>
      )}

      {sidebar && (
        <aside className="sidebar" aria-label="Section navigation">
          <div className="sidebar-sheet-head">
            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
              <LogoMark size={22} />
              <span className="sidebar-title">Chatter</span>
            </span>
            <button type="button" className="icon-btn" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>
              <IconClose size={18} />
            </button>
          </div>
          {sidebar}
          <UserPanel
            user={user}
            muted={muted}
            deafened={deafened}
            onToggleMute={() => {
              setMuted((value) => !value);
              toast.info(muted ? 'Microphone unmuted' : 'Microphone muted', 'Applies to calls you join next.');
            }}
            onToggleDeafen={() => {
              setDeafened((value) => !value);
              toast.info(deafened ? 'Undeafened' : 'Deafened', 'Applies to calls you join next.');
            }}
            onSettings={() => navigate('/settings')}
            onLogout={handleLogout}
          />
          <div className="resizer" role="separator" aria-orientation="vertical" onPointerDown={onResizeStart} />
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
            <div className="row desktop-only" style={{ flex: '0 1 300px', minWidth: 150 }}>
              <div className="search-field" style={{ width: '100%' }}>
                <IconSearch size={15} />
                <input
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
              className="icon-btn members-toggle"
              aria-label={membersOpen ? 'Hide members' : 'Show members'}
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen((open) => !open)}
            >
              <IconPanelRight size={19} />
            </button>
          )}
        </header>
        <div className="main-scroll">{children}</div>
      </main>

      {members && (
        <aside className="members" aria-label="Members">
          <div className="sidebar-head">
            <span className="sidebar-title">Members</span>
            <button
              type="button"
              className="icon-btn"
              style={{ marginLeft: 'auto' }}
              aria-label="Hide members"
              onClick={() => setMembersOpen(false)}
            >
              <IconClose size={17} />
            </button>
          </div>
          <div className="members-scroll">{members}</div>
        </aside>
      )}

      {(sidebarOpen || membersOpen) && <div className="scrim" onClick={closeOverlays} aria-hidden="true" />}

      <nav className="tabbar" aria-label="Mobile navigation">
        {tabItems.map((item) => {
          const active = matches(pathname, item.to, item.end);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="tabbar-item"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {item.badge && unread > 0 && <span className="tabbar-badge">{unread > 9 ? '9+' : unread}</span>}
            </NavLink>
          );
        })}
      </nav>
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
  onLogout,
}: {
  user: User;
  muted: boolean;
  deafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <div className="user-panel">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        style={{ background: 'none', border: 0, padding: 0, display: 'flex' }}
        aria-label="Open account menu"
        aria-expanded={menuOpen}
      >
        <Avatar user={user} size="sm" showPresence />
      </button>
      <button
        type="button"
        className="user-panel-info"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Open account menu"
        aria-expanded={menuOpen}
      >
        <span className="user-panel-name truncate">
          <span className="truncate">{user.displayName}</span>
          {user.isOwner && (
            <span style={{ marginLeft: 6 }}>
              <OwnerBadge compact />
            </span>
          )}
        </span>
        <span className="user-panel-status truncate">
          <span className="dot" data-presence={user.presence} />
          {user.customStatus || presenceLabel(user.presence)}
        </span>
      </button>
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
        <button type="button" className="icon-btn desktop-only" aria-label="User settings" onClick={onSettings}>
          <IconSettings size={17} />
        </button>
      </div>

      {menuOpen && (
        <>
          <div className="user-menu-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="user-menu" role="menu" aria-label="Account menu">
            <div className="user-menu-head">
              <div className="user-menu-name truncate">{user.displayName}</div>
              <div className="tiny muted truncate">@{user.username}</div>
            </div>
            <button type="button" role="menuitem" className="user-menu-item" onClick={() => go('/profile')}>
              <IconUser size={15} /> My profile
            </button>
            <button type="button" role="menuitem" className="user-menu-item" onClick={() => go('/ai')}>
              <IconSparkle size={15} /> Chatter AI
            </button>
            <button type="button" role="menuitem" className="user-menu-item" onClick={() => go('/settings')}>
              <IconSettings size={15} /> Settings
            </button>
            {user.isOwner && (
              <button type="button" role="menuitem" className="user-menu-item owner-item" onClick={() => go('/owner')}>
                <IconShield size={15} /> Owner Console
              </button>
            )}
            <div className="user-menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="user-menu-item danger"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              <IconLogout size={15} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Sidebar used across the Stage 1 screens. */
export function DefaultSidebar({
  active,
}: {
  active: 'home' | 'messages' | 'friends' | 'profile' | 'settings' | 'owner' | 'ai';
}) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      notificationsApi
        .unread()
        .then((result) => {
          if (!cancelled) setUnread(result.unread);
        })
        .catch(() => {
          // A failed badge refresh is cosmetic; the notification page reports errors.
        });
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useRealtime((event) => {
    if (event !== 'notification') return;
    notificationsApi
      .unread()
      .then((result) => setUnread(result.unread))
      .catch(() => undefined);
  });
  return (
    <>
      <div className="sidebar-head">
        <div style={{ minWidth: 0 }}>
          <div className="sidebar-subtitle">Chatter</div>
          <div className="sidebar-title truncate">Community hub</div>
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
        <NavLink to="/ai" className="nav-item" data-active={active === 'ai'}>
          <IconSparkle size={17} /> Chatter AI
        </NavLink>
        <NavLink to="/profile" className="nav-item" data-active={active === 'profile'}>
          <IconUser size={17} /> My profile
        </NavLink>

        <div className="nav-section-label">Account</div>
        <NavLink to="/settings" className="nav-item" data-active={active === 'settings'}>
          <IconSettings size={17} /> Settings
        </NavLink>
        {user?.isOwner && (
          <NavLink to="/owner" className="nav-item" data-active={active === 'owner'}>
            <IconShield size={17} /> Owner console
          </NavLink>
        )}

        <div className="nav-section-label">Platform</div>
        <NavLink to="/servers" className="nav-item">
          <IconCompass size={17} /> Discover servers
        </NavLink>
        <NavLink to="/notifications" className="nav-item">
          <IconBell size={17} /> Notifications
          {unread > 0 && <span className="nav-count">{unread > 99 ? '99+' : unread}</span>}
        </NavLink>
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
    return (
      <p className="muted small" style={{ padding: 8 }}>
        No members to show yet.
      </p>
    );
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
            <span className="member-name">
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
