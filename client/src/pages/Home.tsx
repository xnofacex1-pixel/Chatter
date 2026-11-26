import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, DefaultSidebar } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { EmptyState } from '../components/LoadingScreen';
import {
  IconCompass,
  IconMessage,
  IconPlus,
  IconShield,
  IconSparkle,
  IconUsers,
} from '../components/icons';
import { useAuth } from '../lib/auth';
import { api, type Conversation, type PlatformStats } from '../lib/api';
import { serverApi, type ServerSummary } from '../lib/servers';
import { relativeTime } from '../lib/format';

function serverInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function conversationTitle(conversation: Conversation) {
  if (conversation.kind === 'group') return conversation.title || 'Group conversation';
  return conversation.partner?.displayName ?? conversation.title ?? 'Direct message';
}

export default function Home() {
  const { user } = useAuth();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [onlineFriends, setOnlineFriends] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.stats(), serverApi.list(), api.conversations(), api.friends()])
      .then(([statsResult, serversResult, conversationsResult, friendsResult]) => {
        if (cancelled) return;
        if (statsResult.status === 'fulfilled') setStats(statsResult.value.stats);
        if (serversResult.status === 'fulfilled') setServers(serversResult.value.servers);
        if (conversationsResult.status === 'fulfilled') setConversations(conversationsResult.value.conversations);
        if (friendsResult.status === 'fulfilled') {
          setOnlineFriends(friendsResult.value.friends.filter((friend) => friend.presence !== 'offline').length);
        }
        if (
          statsResult.status === 'rejected' &&
          serversResult.status === 'rejected' &&
          conversationsResult.status === 'rejected'
        ) {
          setError('Chatter could not load your workspace right now. Reload to try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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

  const unreadConversations = useMemo(
    () => conversations.filter((conversation) => conversation.unreadCount > 0),
    [conversations],
  );
  const totalUnread = useMemo(
    () => conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
    [conversations],
  );
  const recentConversations = useMemo(
    () =>
      [...conversations]
        .filter((conversation) => !conversation.archived)
        .sort((a, b) => (b.lastMessageAt ?? b.updatedAt).localeCompare(a.lastMessageAt ?? a.updatedAt))
        .slice(0, 6),
    [conversations],
  );

  if (!user) return null;

  return (
    <AppShell title="Home" subtitle="Your community. Your conversations. Your Chatter." sidebar={<DefaultSidebar active="home" />}>
      <div className="stack" style={{ gap: 18 }}>
        <section className="hero">
          <div className="hero-content">
            <div className="row" style={{ gap: 8 }}>
              <span className="badge">
                <IconSparkle size={12} /> Chatter home
              </span>
              {totalUnread > 0 && <span className="badge" data-kind="warning">{totalUnread} unread</span>}
            </div>
            <h2 style={{ margin: 0, fontSize: 30, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
              {greeting}, {user.displayName.split(' ')[0]}
            </h2>
            <p className="muted" style={{ margin: 0, maxWidth: 560 }}>
              Jump back into your servers, catch up on unread conversations or start something new.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/messages">
                <IconMessage size={16} /> Open messages
              </Link>
              <Link className="btn btn-ghost" to="/friends">
                <IconUsers size={16} /> Add friends
              </Link>
              <Link className="btn btn-ghost" to="/ai">
                <IconSparkle size={16} /> Chatter AI
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
          <StatCard label="Your servers" value={loading ? null : servers.length} meta="Communities you belong to" />
          <StatCard label="Conversations" value={loading ? null : conversations.length} meta="Direct and group chats" />
          <StatCard label="Unread" value={loading ? null : totalUnread} meta="Messages waiting for you" />
          <StatCard label="Friends online" value={loading ? null : onlineFriends} meta="Available right now" />
        </div>

        <section className="card">
          <div className="section-head">
            <span>Your servers</span>
            <Link className="tiny" to="/servers">
              Browse all
            </Link>
          </div>
          {servers.length === 0 ? (
            <EmptyState
              title="No communities yet"
              description="Create your own server or discover a public community to join."
              icon={<IconCompass size={26} />}
            />
          ) : (
            <div className="home-server-grid">
              {servers.slice(0, 8).map((server) => (
                <Link key={server.id} to={`/servers/${server.id}`} className="home-server-card">
                  <span className="home-server-icon" aria-hidden="true">
                    {server.iconUrl ? <img src={server.iconUrl} alt="" /> : serverInitials(server.name)}
                  </span>
                  <span className="grow truncate">
                    <span className="home-server-name truncate">{server.name}</span>
                    <span className="tiny muted truncate">
                      {server.memberCount} member{server.memberCount === 1 ? '' : 's'} · {server.onlineCount} online
                    </span>
                  </span>
                  {server.isOwner && <span className="badge">Owner</span>}
                </Link>
              ))}
              <Link to="/servers" className="home-server-card home-server-create">
                <span className="home-server-icon" aria-hidden="true">
                  <IconPlus size={16} />
                </span>
                <span className="grow">
                  <span className="home-server-name">Create or join</span>
                  <span className="tiny muted">Start a new community</span>
                </span>
              </Link>
            </div>
          )}
        </section>

        <div className="home-columns">
          <section className="card">
            <div className="section-head">
              <span>Recent conversations</span>
              <Link className="tiny" to="/messages">
                All messages
              </Link>
            </div>
            {recentConversations.length === 0 ? (
              <EmptyState
                title="No conversations yet"
                description="Add a friend and send your first direct message."
                icon={<IconMessage size={26} />}
              />
            ) : (
              <div className="list-card">
                {recentConversations.map((conversation) => {
                  const partner = conversation.partner;
                  const label = conversationTitle(conversation);
                  return (
                    <Link key={conversation.id} to={`/messages/${conversation.id}`} className="list-row">
                      {partner ? (
                        <Avatar user={partner} size="sm" showPresence />
                      ) : (
                        <span className="avatar avatar-sm" aria-hidden="true">
                          {label.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="grow truncate">
                        <span className="row" style={{ gap: 6 }}>
                          <span className="truncate">{label}</span>
                          {conversation.kind === 'group' && <span className="badge">Group</span>}
                        </span>
                        <span className="tiny muted truncate">
                          {conversation.lastMessage?.deleted
                            ? 'Message deleted'
                            : conversation.lastMessage?.body || 'No messages yet'}
                        </span>
                      </span>
                      <span className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
                        <span className="tiny muted">{relativeTime(conversation.lastMessageAt ?? conversation.updatedAt)}</span>
                        {conversation.unreadCount > 0 && <span className="badge" data-kind="warning">{conversation.unreadCount}</span>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <div className="section-head">
                <span>Unread</span>
                <Link className="tiny" to="/messages">
                  Open inbox
                </Link>
              </div>
              {unreadConversations.length === 0 ? (
                <div className="card-pad">
                  <p className="small muted" style={{ margin: 0 }}>
                    You are all caught up. New messages will show up here.
                  </p>
                </div>
              ) : (
                <div className="list-card">
                  {unreadConversations.slice(0, 4).map((conversation) => (
                    <Link key={conversation.id} to={`/messages/${conversation.id}`} className="list-row">
                      <span className="grow truncate">
                        <span className="truncate">{conversationTitle(conversation)}</span>
                        <span className="tiny muted truncate">{conversation.lastMessage?.authorName ?? 'New activity'}</span>
                      </span>
                      <span className="badge" data-kind="warning">
                        {conversation.unreadCount}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {user.isOwner ? (
              <section className="card card-pad stack">
                <div className="row" style={{ gap: 8 }}>
                  <IconShield size={18} />
                  <span style={{ fontWeight: 650 }}>Owner console</span>
                  <OwnerBadge compact />
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  {stats ? `${stats.totalUsers.toLocaleString()} accounts · ${stats.onlineUsers} online now.` : 'Platform health and moderation tools.'}
                </p>
                <Link className="btn btn-primary" to="/owner">
                  Open owner console
                </Link>
              </section>
            ) : (
              <section className="card card-pad stack">
                <div className="row" style={{ gap: 8 }}>
                  <IconSparkle size={18} />
                  <span style={{ fontWeight: 650 }}>Chatter AI</span>
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  Ask questions in a private AI chat. Only what you type there is sent to the AI provider.
                </p>
                <Link className="btn btn-ghost" to="/ai">
                  Start an AI chat
                </Link>
              </section>
            )}
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
