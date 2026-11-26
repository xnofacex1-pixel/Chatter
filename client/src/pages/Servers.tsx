import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { ChannelChat, type ChatEvent } from '../components/ChannelChat';
import { ServerSettings } from '../components/ServerSettings';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { useCall } from '../lib/call-context';
import { ApiError } from '../lib/api';
import {
  has,
  P,
  serverApi,
  type ChannelType,
  type NotificationLevel,
  type ServerChannel,
  type ServerDetail,
  type ServerMember,
  type ServerSummary,
} from '../lib/servers';
import {
  IconBell,
  IconChevronDown,
  IconClose,
  IconCompass,
  IconForum,
  IconImage,
  IconHeadphones,
  IconHeadphonesOff,
  IconLock,
  IconMegaphone,
  IconMic,
  IconMicOff,
  IconMonitor,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconTrash,
  IconUsers,
  IconWarning,
} from '../components/icons';
import { IconMore } from '../components/icons-extra';

type ModalKind = 'create' | 'join' | 'discover' | 'invite' | 'channel' | 'settings' | null;

const bytes = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;

export default function Servers() {
  const { user } = useAuth();
  const { serverId, channelId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [list, setList] = useState<ServerSummary[]>([]);
  const [detail, setDetail] = useState<ServerDetail | null>(null);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<ChatEvent | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoveries, setDiscoveries] = useState<ServerSummary[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const seq = useRef(0);

  const loadList = useCallback(async () => {
    const data = await serverApi.list();
    setList(data.servers);
    return data.servers;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const [next, memberData] = await Promise.all([serverApi.get(id), serverApi.members(id)]);
    setDetail(next);
    setMembers(memberData.members);
    setError(null);
  }, []);

  useRealtime((name, data) => {
    setEvent({ seq: ++seq.current, name, data });
    if (name.startsWith('server:') || name === 'presence' || name === 'friend:update') {
      const target = typeof data.serverId === 'string' ? data.serverId : null;
      if (serverId && (!target || target === serverId)) {
        void loadDetail(serverId).catch(() => undefined);
      }
      void loadList().catch(() => undefined);
    }
  });

  useEffect(() => {
    let cancelled = false;
    loadList()
      .then((servers) => {
        if (!cancelled && !serverId && servers.length > 0) navigate(`/servers/${servers[0].id}`, { replace: true });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Communities could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!serverId) {
      setDetail(null);
      setMembers([]);
      return;
    }
    let cancelled = false;
    setDetail((prev) => (prev?.server.id === serverId ? prev : null));
    loadDetail(serverId).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof ApiError ? cause.message : 'That community could not be opened.');
      setDetail(null);
    });
    return () => {
      cancelled = true;
    };
  }, [serverId, loadDetail]);

  useEffect(() => {
    if (!detail || channelId) return;
    const first = detail.channels.find((channel) => channel.type !== 'voice');
    if (first) navigate(`/servers/${detail.server.id}/${first.id}`, { replace: true });
  }, [detail, channelId, navigate]);

  const activeChannel = detail?.channels.find((channel) => channel.id === channelId) ?? null;
  const permissions = detail?.permissions ?? 0;
  const canManageChannels = has(permissions, P.MANAGE_CHANNELS) || has(permissions, P.ADMINISTRATOR);
  const canInvite = has(permissions, P.CREATE_INVITES) || has(permissions, P.ADMINISTRATOR);
  const canManageServer = has(permissions, P.MANAGE_SERVER) || has(permissions, P.ADMINISTRATOR);

  const groups = useMemo(() => {
    if (!detail) return [] as { id: string; name: string | null; channels: ServerChannel[] }[];
    const byPosition = (a: ServerChannel, b: ServerChannel) => a.position - b.position;
    const result: { id: string; name: string | null; channels: ServerChannel[] }[] = [];
    const loose = detail.channels.filter((channel) => !channel.categoryId).sort(byPosition);
    if (loose.length > 0) result.push({ id: 'loose', name: null, channels: loose });
    for (const category of [...detail.categories].sort((a, b) => a.position - b.position)) {
      result.push({
        id: category.id,
        name: category.name,
        channels: detail.channels.filter((channel) => channel.categoryId === category.id).sort(byPosition),
      });
    }
    return result;
  }, [detail]);

  const roleGroups = useMemo(() => {
    if (!detail) return [] as { key: string; label: string; color?: string; members: ServerMember[] }[];
    const ordered = [...detail.roles].sort((a, b) => b.position - a.position);
    const groupsMap = new Map<string, { key: string; label: string; color?: string; members: ServerMember[] }>();
    for (const member of members) {
      const top = [...member.roles].sort((a, b) => b.position - a.position)[0];
      const key = top?.id ?? 'everyone';
      const label = top?.name ?? 'Members';
      if (!groupsMap.has(key)) groupsMap.set(key, { key, label, color: top?.color, members: [] });
      groupsMap.get(key)?.members.push(member);
    }
    const rank = new Map(ordered.map((role) => [role.id, role.position]));
    return [...groupsMap.values()].sort((a, b) => (rank.get(b.key) ?? -1) - (rank.get(a.key) ?? -1));
  }, [detail, members]);

  const setLevel = async (level: NotificationLevel) => {
    if (!serverId) return;
    try {
      await serverApi.setNotifications(serverId, level);
      setDetail((prev) => (prev ? { ...prev, notificationLevel: level } : prev));
      toast.success('Notifications updated', `This community is now set to ${level}.`);
    } catch (cause) {
      toast.error('Could not update notifications', cause instanceof ApiError ? cause.message : 'Try again.');
    }
  };

  const leave = async () => {
    if (!serverId) return;
    try {
      await serverApi.leave(serverId);
      toast.info('You left the community', detail?.server.name ?? '');
      setMenuOpen(false);
      const servers = await loadList();
      navigate(servers[0] ? `/servers/${servers[0].id}` : '/servers', { replace: true });
    } catch (cause) {
      toast.error('Could not leave', cause instanceof ApiError ? cause.message : 'Try again.');
    }
  };

  const openDiscover = async () => {
    setModal('discover');
    setDiscovering(true);
    try {
      const data = await serverApi.discover(discoverQuery);
      setDiscoveries(data.servers);
    } catch {
      setDiscoveries([]);
    } finally {
      setDiscovering(false);
    }
  };

  const joinServer = async (id: string) => {
    try {
      await serverApi.join(id);
      await loadList();
      setModal(null);
      navigate(`/servers/${id}`);
      toast.success('Community joined', 'Welcome aboard.');
    } catch (cause) {
      toast.error('Could not join', cause instanceof ApiError ? cause.message : 'Try again.');
    }
  };

  const sidebar = (
    <>
      <div className="server-strip" aria-label="Your communities">
        {list.map((entry) => (
          <NavLink
            key={entry.id}
            to={`/servers/${entry.id}`}
            className="server-pill"
            data-active={entry.id === serverId}
            title={entry.name}
            aria-label={entry.name}
          >
            {entry.iconUrl ? <img src={entry.iconUrl} alt="" /> : <span>{entry.name.slice(0, 2).toUpperCase()}</span>}
          </NavLink>
        ))}
        <button type="button" className="server-pill server-pill-add" aria-label="Create a community" title="Create a community" onClick={() => setModal('create')}>
          <IconPlus size={17} />
        </button>
        <button type="button" className="server-pill server-pill-add" aria-label="Discover communities" title="Discover communities" onClick={() => void openDiscover()}>
          <IconCompass size={17} />
        </button>
      </div>

      {detail ? (
        <>
          <div className="server-head">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="sidebar-subtitle truncate">{detail.server.isPublic ? 'Public community' : 'Private community'}</div>
              <div className="sidebar-title truncate">{detail.server.name}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Community menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <IconMore size={17} />
            </button>
            {menuOpen && (
              <div className="menu-pop" role="menu">
                {canInvite && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setModal('invite'); }}>
                    <IconUsers size={15} /> Invite people
                  </button>
                )}
                {canManageServer && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setModal('settings'); }}>
                    <IconSettings size={15} /> Community settings
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => void setLevel(detail.notificationLevel === 'none' ? 'all' : 'none')}>
                  <IconBell size={15} /> {detail.notificationLevel === 'none' ? 'Unmute community' : 'Mute community'}
                </button>
                <button type="button" role="menuitem" className="danger" onClick={() => void leave()}>
                  <IconTrash size={15} /> Leave community
                </button>
              </div>
            )}
          </div>

          <div className="sidebar-scroll">
            {groups.map((group) => (
              <div key={group.id} className="channel-group">
                <div className="channel-group-head">
                  <IconChevronDown size={12} />
                  <span className="truncate">{group.name ?? 'Channels'}</span>
                  {canManageChannels && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Create a channel in ${group.name ?? 'Channels'}`}
                      onClick={() => setModal('channel')}
                    >
                      <IconPlus size={13} />
                    </button>
                  )}
                </div>
                {group.channels.length === 0 && <div className="muted small" style={{ padding: '2px 10px 6px' }}>No channels yet.</div>}
                {group.channels.map((channel) => (
                  <NavLink
                    key={channel.id}
                    to={`/servers/${detail.server.id}/${channel.id}`}
                    className="channel-row"
                    data-active={channel.id === channelId}
                  >
                    <ChannelGlyph type={channel.type} />
                    <span className="truncate grow">{channel.name}</span>
                    {channel.isPrivate && <IconLock size={12} />}
                    {channel.unreadCount > 0 && <span className="nav-count">{channel.unreadCount}</span>}
                  </NavLink>
                ))}
              </div>
            ))}

            {canManageChannels && (
              <div className="row" style={{ gap: 6, padding: '8px 6px' }}>
                <button type="button" className="btn btn-ghost btn-sm grow" onClick={() => setModal('channel')}>
                  <IconPlus size={14} /> Channel
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="sidebar-scroll">
          <div className="nav-section-label">Communities</div>
          {booting ? (
            <div className="stack" style={{ padding: 8 }}>
              <div className="skeleton" style={{ height: 12 }} />
              <div className="skeleton" style={{ height: 12, width: '70%' }} />
            </div>
          ) : (
            <>
              <p className="muted small" style={{ padding: '4px 8px 10px' }}>
                You are not in a community yet. Create your own space or join one with an invite.
              </p>
              <button type="button" className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => setModal('create')}>
                <IconPlus size={15} /> Create a community
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setModal('join')}>
                Join with an invite
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => void openDiscover()}>
                <IconCompass size={15} /> Discover communities
              </button>
            </>
          )}
        </div>
      )}
    </>
  );

  const membersPanel = detail ? (
    <div className="stack" style={{ gap: 6 }}>
      {roleGroups.map((group) => (
        <div key={group.key}>
          <div className="nav-section-label" style={{ color: group.color || undefined }}>
            {group.label} — {group.members.length}
          </div>
          {group.members.map((member) => (
            <NavLink key={member.user.id} to={`/u/${member.user.username}`} className="member-row">
              <Avatar user={member.user} size="sm" showPresence />
              <span className="grow truncate">
                <span className="member-name truncate" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="truncate" style={{ color: member.roles[0]?.color || undefined }}>
                    {member.nickname || member.user.displayName}
                  </span>
                  {member.user.isOwner && <OwnerBadge compact />}
                  {member.isOwner && <IconShield size={12} />}
                </span>
              </span>
            </NavLink>
          ))}
        </div>
      ))}
      {members.length === 0 && <p className="muted small" style={{ padding: 8 }}>No members yet.</p>}
    </div>
  ) : undefined;

  const headActions = detail ? (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Notification level"
        title={`Notifications: ${detail.notificationLevel}`}
        onClick={() => void setLevel(detail.notificationLevel === 'all' ? 'mentions' : detail.notificationLevel === 'mentions' ? 'none' : 'all')}
      >
        <IconBell size={18} />
      </button>
      {canInvite && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal('invite')}>
          <IconUsers size={15} /> Invite
        </button>
      )}
    </>
  ) : undefined;

  return (
    <>
      <AppShell
        title={detail?.server.name ?? 'Communities'}
        subtitle={detail?.server.description ?? 'Your community. Your conversations.'}
        sidebar={sidebar}
        members={membersPanel}
        headActions={headActions}
      >
        {!detail ? (
          <div className="empty-state">
            <div className="empty-icon"><IconCompass size={26} /></div>
            <h2>Find your people</h2>
            <p className="muted">
              {error ?? 'Create a community, join one with an invite link, or browse public communities to get started.'}
            </p>
            <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => setModal('create')}>
                Create a community
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setModal('join')}>
                Join with invite
              </button>
            </div>
          </div>
        ) : activeChannel && activeChannel.type !== 'voice' ? (
          <ChannelChat
            channel={activeChannel}
            serverId={detail.server.id}
            me={{ id: user?.id ?? '', displayName: user?.displayName ?? '' }}
            permissions={permissions}
            memberRoleName={detail.member.roles[0]?.name}
            event={event}
            onUnreadChange={() => {
              if (serverId) void loadDetail(serverId).catch(() => undefined);
            }}
          />
        ) : activeChannel && activeChannel.type === 'voice' ? (
          <VoiceChannelView channel={activeChannel} />
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><IconUsers size={26} /></div>
            <h2>No channels yet</h2>
            <p className="muted">Create the first channel for {detail.server.name}.</p>
            {canManageChannels && (
              <button type="button" className="btn btn-primary" onClick={() => setModal('channel')}>
                <IconPlus size={15} /> Create a channel
              </button>
            )}
          </div>
        )}
      </AppShell>

      {modal === 'create' && (
        <CreateCommunityModal
          onClose={() => setModal(null)}
          onCreated={async (created) => {
            await loadList();
            setModal(null);
            navigate(`/servers/${created.id}`);
          }}
        />
      )}
      {modal === 'join' && (
        <JoinModal
          onClose={() => setModal(null)}
          onJoined={async (joined) => {
            await loadList();
            setModal(null);
            navigate(`/servers/${joined.id}`);
          }}
        />
      )}
      {modal === 'discover' && (
        <DiscoverModal
          query={discoverQuery}
          onQueryChange={(value) => {
            setDiscoverQuery(value);
            setDiscovering(true);
            void serverApi
              .discover(value)
              .then((data) => setDiscoveries(data.servers))
              .catch(() => setDiscoveries([]))
              .finally(() => setDiscovering(false));
          }}
          servers={discoveries}
          loading={discovering}
          joinedIds={list.map((entry) => entry.id)}
          onJoin={(id) => void joinServer(id)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'invite' && detail && serverId && (
        <InviteModal serverId={serverId} serverName={detail.server.name} onClose={() => setModal(null)} />
      )}
      {modal === 'channel' && detail && serverId && (
        <CreateChannelModal
          serverId={serverId}
          categories={detail.categories}
          onClose={() => setModal(null)}
          onCreated={async (channel) => {
            setModal(null);
            await loadDetail(serverId);
            if (channel.type !== 'voice') navigate(`/servers/${serverId}/${channel.id}`);
          }}
        />
      )}
      {modal === 'settings' && detail && serverId && (
        <ServerSettings
          serverId={serverId}
          detail={detail}
          me={user}
          onClose={() => setModal(null)}
          onChanged={async () => {
            await loadDetail(serverId);
            await loadList();
          }}
          onDeleted={async () => {
            setModal(null);
            const servers = await loadList();
            navigate(servers[0] ? `/servers/${servers[0].id}` : '/servers', { replace: true });
          }}
        />
      )}
    </>
  );
}

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: wide ? 640 : 460 }} role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateCommunityModal({ onClose, onCreated }: { onClose: () => void; onCreated: (server: ServerSummary) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await serverApi.create({ name: name.trim(), description: description.trim() || undefined, isPublic });
      onCreated(data.server);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The community could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Create a community" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">
          <span className="field-label">Community name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Night Shift" maxLength={48} />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea className="input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} placeholder="What is this community about?" />
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
          <span className="small">List this community in discovery (anyone can join)</span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || name.trim().length < 2}>
          {busy ? 'Creating…' : 'Create community'}
        </button>
      </div>
    </ModalShell>
  );
}

function JoinModal({ onClose, onJoined }: { onClose: () => void; onJoined: (server: ServerSummary) => void }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof serverApi.invitePreview>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const data = await serverApi.invitePreview(code.trim().replace(/.*\//, ''));
      if (!data.valid) setError(data.reason || 'That invite is no longer valid.');
      else setPreview(data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That invite could not be found.');
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    setBusy(true);
    try {
      const data = await serverApi.acceptInvite(code.trim().replace(/.*\//, ''));
      onJoined(data.server);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The invite could not be accepted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Join a community" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">
          <span className="field-label">Invite code or link</span>
          <input className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="chatter.gg/abc123 or abc123" />
        </label>
        {error && <p className="form-error">{error}</p>}
        {preview && (
          <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {preview.server.iconUrl ? (
              <img src={preview.server.iconUrl} alt="" style={{ width: 44, height: 44, borderRadius: 14, objectFit: 'cover' }} />
            ) : (
              <div className="server-pill" style={{ width: 44, height: 44 }}>{preview.server.name.slice(0, 2).toUpperCase()}</div>
            )}
            <div className="grow" style={{ minWidth: 0 }}>
              <strong className="truncate" style={{ display: 'block' }}>{preview.server.name}</strong>
              <span className="muted small">{preview.server.memberCount} members · {preview.server.onlineCount} online</span>
            </div>
          </div>
        )}
        {preview ? (
          <button type="button" className="btn btn-primary" onClick={() => void accept()} disabled={busy}>
            {busy ? 'Joining…' : `Join ${preview.server.name}`}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void lookup()} disabled={busy || code.trim().length < 3}>
            {busy ? 'Checking…' : 'Check invite'}
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function DiscoverModal({
  query,
  onQueryChange,
  servers,
  loading,
  joinedIds,
  onJoin,
  onClose,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  servers: ServerSummary[];
  loading: boolean;
  joinedIds: string[];
  onJoin: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title="Discover communities" onClose={onClose} wide>
      <div className="search-field" style={{ marginBottom: 12 }}>
        <IconSearch size={16} />
        <input className="input" value={query} placeholder="Search public communities" aria-label="Search public communities" onChange={(event) => onQueryChange(event.target.value)} />
      </div>
      {loading ? (
        <div className="stack">
          {[0, 1, 2].map((key) => <div key={key} className="skeleton" style={{ height: 56, borderRadius: 12 }} />)}
        </div>
      ) : servers.length === 0 ? (
        <p className="muted small">No public communities matched that search.</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {servers.map((entry) => (
            <div key={entry.id} className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {entry.iconUrl ? (
                <img src={entry.iconUrl} alt="" style={{ width: 42, height: 42, borderRadius: 13, objectFit: 'cover' }} />
              ) : (
                <div className="server-pill" style={{ width: 42, height: 42 }}>{entry.name.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="grow" style={{ minWidth: 0 }}>
                <strong className="truncate" style={{ display: 'block' }}>{entry.name}</strong>
                <span className="muted small truncate" style={{ display: 'block' }}>
                  {entry.memberCount} members · {entry.onlineCount} online
                  {entry.description ? ` · ${entry.description}` : ''}
                </span>
              </div>
              {joinedIds.includes(entry.id) ? (
                <span className="pill">Joined</span>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onJoin(entry.id)}>
                  Join
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function InviteModal({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose: () => void }) {
  const toast = useToast();
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof serverApi.invites>>['invites']>([]);
  const [loading, setLoading] = useState(true);
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('24');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await serverApi.invites(serverId);
      setInvites(data.invites);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      await serverApi.createInvite(serverId, {
        maxUses: maxUses ? Number(maxUses) : null,
        expiresInHours: expires ? Number(expires) : null,
      });
      await load();
      toast.success('Invite created', 'Share the link to bring people in.');
    } catch (cause) {
      toast.error('Could not create invite', cause instanceof ApiError ? cause.message : 'Try again.');
    } finally {
      setCreating(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite copied', 'Send it to whoever you want to invite.');
    } catch {
      toast.info('Copy failed', url);
    }
  };

  return (
    <ModalShell title={`Invite people to ${serverName}`} onClose={onClose} wide>
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '1 1 120px' }}>
          <span className="field-label">Max uses</span>
          <input className="input" type="number" min={1} value={maxUses} placeholder="Unlimited" onChange={(event) => setMaxUses(event.target.value)} />
        </label>
        <label className="field" style={{ flex: '1 1 120px' }}>
          <span className="field-label">Expires (hours)</span>
          <input className="input" type="number" min={1} value={expires} placeholder="Never" onChange={(event) => setExpires(event.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={() => void create()} disabled={creating}>
          {creating ? 'Creating…' : 'Create invite'}
        </button>
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 40 }} />
      ) : invites.length === 0 ? (
        <p className="muted small">No active invites. Create one above.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {invites.map((invite) => (
            <div key={invite.id} className="row card" style={{ padding: 10, gap: 8 }}>
              <code className="grow truncate small">{invite.url || `/invite/${invite.code}`}</code>
              <span className="muted small">{invite.uses}{invite.maxUses ? `/${invite.maxUses}` : ''} uses</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(invite.url || `${window.location.origin}/invite/${invite.code}`)}>
                Copy
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Revoke invite"
                onClick={async () => {
                  try {
                    await serverApi.revokeInvite(serverId, invite.id);
                    await load();
                  } catch {
                    toast.error('Could not revoke invite', 'Try again.');
                  }
                }}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function CreateChannelModal({
  serverId,
  categories,
  onClose,
  onCreated,
}: {
  serverId: string;
  categories: { id: string; name: string | null }[];
  onClose: () => void;
  onCreated: (channel: ServerChannel) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('text');
  const [categoryId, setCategoryId] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [slowmode, setSlowmode] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await serverApi.createChannel(serverId, {
        name: name.trim().toLowerCase().replace(/\s+/g, '-'),
        type,
        categoryId: categoryId || null,
        topic: topic.trim() || null,
        isPrivate,
        readOnly,
        slowmodeSeconds: Number(slowmode) || 0,
      });
      onCreated(data.channel);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The channel could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Create a channel" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          {(
            [
              ['text', 'Text'],
              ['announcement', 'Announcement'],
              ['forum', 'Forum'],
              ['media', 'Media'],
              ['voice', 'Voice'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm ${type === value ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">Channel name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={type === 'voice' ? 'Lounge' : type === 'announcement' ? 'announcements' : type === 'forum' ? 'ideas' : type === 'media' ? 'screenshots' : 'general'} maxLength={40} />
        </label>
        {type !== 'voice' && (
          <label className="field">
            <span className="field-label">Topic</span>
            <input className="input" value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={160} placeholder="What is this channel for?" />
          </label>
        )}
        <label className="field">
          <span className="field-label">Category</span>
          <select className="input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name ?? 'Category'}</option>
            ))}
          </select>
        </label>
        {type !== 'voice' && (
          <label className="field">
            <span className="field-label">Slowmode (seconds)</span>
            <input className="input" type="number" min={0} max={21600} value={slowmode} onChange={(event) => setSlowmode(event.target.value)} />
          </label>
        )}
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
          <span className="small">Private — only visible to members with access</span>
        </label>
        {type !== 'voice' && type !== 'announcement' && (
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
            <span className="small">Read-only for ordinary members</span>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || name.trim().length < 2}>
          {busy ? 'Creating…' : 'Create channel'}
        </button>
      </div>
    </ModalShell>
  );
}

function ChannelGlyph({ type }: { type: ChannelType }) {
  if (type === 'voice') return <IconHeadphones size={15} />;
  if (type === 'announcement') return <IconMegaphone size={15} />;
  if (type === 'forum') return <IconForum size={15} />;
  if (type === 'media') return <IconImage size={15} />;
  return <span className="channel-hash-sm">#</span>;
}

export { bytes };

function VoiceChannelView({ channel }: { channel: ServerChannel }) {
  const calls = useCall();
  const active =
    calls.call && calls.call.channelId === channel.id && calls.call.status !== 'ended' ? calls.call : null;
  const joined = active?.me?.state === 'joined';
  const participants = active ? active.participants.filter((entry) => entry.state === 'joined') : [];

  return (
    <div className="voice-room">
      <div className="voice-room-head">
        <div className="empty-icon"><IconHeadphones size={26} /></div>
        <div>
          <h2 style={{ margin: 0 }}>{channel.name}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {active
              ? `${participants.length} connected · ${active.kind === 'video' ? 'video' : 'voice'} room`
              : 'Nobody is in this room yet.'}
          </p>
        </div>
      </div>
      {calls.error && (
        <div className="call-error-inline" role="alert">
          <IconWarning size={15} /> <span className="grow">{calls.error}</span>
        </div>
      )}
      <div className="voice-room-people">
        {participants.map((entry) => (
          <div key={entry.userId} className={`voice-chip ${entry.micMuted ? 'muted' : ''}`}>
            <span className="voice-chip-dot" />
            <span className="truncate">{entry.user?.displayName ?? 'Member'}</span>
            {entry.micMuted ? <IconMicOff size={13} /> : <IconMic size={13} />}
            {entry.screenOn && <IconMonitor size={13} />}
          </div>
        ))}
        {participants.length === 0 && <p className="muted small">Join to open this room for the community.</p>}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!joined && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={calls.phase === 'connecting'}
            onClick={() => {
              if (active) void calls.join(active.id);
              else void calls.start({ channelId: channel.id, kind: 'voice' });
            }}
          >
            <IconHeadphones size={15} />{' '}
            {calls.phase === 'connecting' ? 'Connecting…' : active ? 'Join voice room' : 'Open voice room'}
          </button>
        )}
        {joined && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => void calls.toggleMic()}>
              {calls.micMuted ? <IconMicOff size={15} /> : <IconMic size={15} />} {calls.micMuted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void calls.toggleDeafen()}>
              {calls.deafened ? <IconHeadphonesOff size={15} /> : <IconHeadphones size={15} />}{' '}
              {calls.deafened ? 'Undeafen' : 'Deafen'}
            </button>
            <button type="button" className="btn btn-ghost call-danger" onClick={() => void calls.leave()}>
              Leave room
            </button>
          </>
        )}
      </div>
      <p className="muted small">
        Chatter connects this room peer-to-peer over WebRTC using its own signalling server — no third-party RTC service and no
        paid provider.
      </p>
    </div>
  );
}
