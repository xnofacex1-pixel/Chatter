import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, DefaultSidebar } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { IconCheck, IconClose, IconLock, IconMessage, IconPlus, IconSearch, IconShield, IconUsers } from '../components/icons';
import { api, ApiError, type FriendsPayload, type User } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { presenceLabel, relativeTime } from '../lib/format';

type Tab = 'all' | 'pending' | 'blocked' | 'add';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All friends' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'add', label: 'Add friend' },
];

export default function Friends() {
  const navigate = useNavigate();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('all');
  const [data, setData] = useState<FriendsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.friends());
      setError(null);
    } catch {
      setError('Chatter could not load your friends right now. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime((event) => {
    if (event === 'friend:update' || event === 'presence') void load();
  });

  const act = async (key: string, run: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await run();
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'That action did not complete. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const openDm = async (user: User) => {
    setBusy(user.id);
    try {
      const { conversation } = await api.createConversation({ kind: 'dm', userIds: [user.id] });
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not open that conversation.');
    } finally {
      setBusy(null);
    }
  };

  const sendRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = handle.trim();
    if (!target) {
      toast.error('Enter a Chatter username, for example @mason.');
      return;
    }
    setBusy('add');
    try {
      const result = await api.sendFriendRequest({
        username: target.replace(/^@/, ''),
        message: note.trim() || undefined,
      });
      toast.success(
        result.autoAccepted
          ? `You and ${result.friend?.displayName ?? target} are now friends.`
          : 'Friend request sent. You will see a notification when it is accepted.',
      );
      setHandle('');
      setNote('');
      setTab('pending');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'That friend request could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  const friends = useMemo(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return data.friends;
    return data.friends.filter(
      (friend) =>
        friend.displayName.toLowerCase().includes(needle) || friend.username.toLowerCase().includes(needle),
    );
  }, [data, filter]);

  const pendingCount = (data?.incoming.length ?? 0) + (data?.outgoing.length ?? 0);

  return (
    <AppShell
      title="Friends"
      subtitle="Your people, your conversations"
      sidebar={<DefaultSidebar active="friends" />}
      headActions={
        <button type="button" className="btn btn-primary" onClick={() => setTab('add')} data-testid="add-friend-open">
          <IconPlus size={16} /> Add friend
        </button>
      }
    >
      <div className="page">
        <div className="segmented" role="tablist" aria-label="Friend views">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className="segmented-item"
              data-active={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.id === 'pending' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
            </button>
          ))}
        </div>

        {error && <div className="notice notice-error">{error}</div>}

        {tab === 'add' && (
          <div className="card-pad" style={{ maxWidth: 560 }}>
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Add a friend</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Send a request by username. They will see it in their pending list straight away.
            </p>
            <form onSubmit={sendRequest} className="stack" style={{ gap: 12 }}>
              <label className="field">
                <span className="field-label">Username</span>
                <input
                  className="input"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="@username"
                  autoComplete="off"
                  data-testid="friend-handle"
                />
              </label>
              <label className="field">
                <span className="field-label">Note (optional)</span>
                <input
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Say hello"
                  maxLength={200}
                />
              </label>
              <div className="row" style={{ gap: 10 }}>
                <button type="submit" className="btn btn-primary" disabled={busy === 'add'} data-testid="friend-send-request">
                  {busy === 'add' ? 'Sending…' : 'Send friend request'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setTab('all')}>
                  Back to friends
                </button>
              </div>
            </form>
          </div>
        )}

        {tab === 'all' && (
          <>
            <div className="row" style={{ gap: 10 }}>
              <label className="search-field grow">
                <IconSearch size={16} />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Search your friends"
                  aria-label="Search your friends"
                />
              </label>
            </div>

            {loading ? (
              <div className="list-card">
                {[0, 1, 2].map((key) => (
                  <div key={key} className="list-row">
                    <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
                    <div className="skeleton" style={{ height: 12, width: '40%' }} />
                  </div>
                ))}
              </div>
            ) : friends.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <IconUsers size={26} />
                </div>
                <h3>{data && data.friends.length > 0 ? 'No friends match that search' : 'Your friend list is waiting'}</h3>
                <p className="muted">
                  {data && data.friends.length > 0
                    ? 'Try a different name or clear the search field.'
                    : 'Add someone by username and your private conversations will show up here.'}
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setTab('add')}>
                  <IconPlus size={16} /> Add your first friend
                </button>
              </div>
            ) : (
              <div className="list-card" data-testid="friend-list">
                {friends.map((friend) => (
                  <div key={friend.id} className="friend-row">
                    <Avatar user={friend} size="md" showPresence />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="truncate" style={{ fontWeight: 600 }}>{friend.displayName}</span>
                        {friend.isOwner && <OwnerBadge compact />}
                      </div>
                      <div className="muted small truncate">
                        @{friend.username} · {presenceLabel(friend.presence)}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void openDm(friend)}
                        disabled={busy === friend.id}
                      >
                        <IconMessage size={15} /> Message
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Remove ${friend.displayName}`}
                        aria-label={`Remove ${friend.displayName}`}
                        onClick={() => void act(`remove-${friend.id}`, () => api.removeFriend(friend.id), 'Friend removed.')}
                        disabled={busy === `remove-${friend.id}`}
                      >
                        <IconClose size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Block ${friend.displayName}`}
                        aria-label={`Block ${friend.displayName}`}
                        onClick={() => {
                          if (!window.confirm(`Block ${friend.displayName}? They will not be able to message you.`)) return;
                          void act(`block-${friend.id}`, () => api.blockUser(friend.id), 'Member blocked.');
                        }}
                        disabled={busy === `block-${friend.id}`}
                      >
                        <IconShield size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'pending' && (
          <>
            <div className="section-head">
              <h2>Incoming requests</h2>
              <span className="muted small">{data?.incoming.length ?? 0}</span>
            </div>
            {loading ? (
              <div className="list-card">
                <div className="list-row"><div className="skeleton" style={{ height: 12, width: '50%' }} /></div>
              </div>
            ) : (data?.incoming.length ?? 0) === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><IconCheck size={26} /></div>
                <h3>No incoming requests</h3>
                <p className="muted">When someone adds you, their request lands here.</p>
              </div>
            ) : (
              <div className="list-card" data-testid="incoming-requests">
                {data?.incoming.map((request) => (
                  <div key={request.id} className="friend-row">
                    {request.user && <Avatar user={request.user} size="md" showPresence />}
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>
                        {request.user?.displayName ?? 'Member'}
                      </div>
                      <div className="muted small truncate">
                        @{request.user?.username ?? 'unknown'} · {relativeTime(request.createdAt)}
                      </div>
                      {request.message && <div className="muted small">“{request.message}”</div>}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        data-testid={`accept-request-${request.user?.username ?? request.id}`}
                        onClick={() =>
                          void act(
                            `accept-${request.id}`,
                            () => api.acceptFriendRequest(request.id),
                            `${request.user?.displayName ?? 'Member'} is now your friend.`,
                          )
                        }
                        disabled={busy === `accept-${request.id}`}
                      >
                        <IconCheck size={15} /> Accept
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void act(`decline-${request.id}`, () => api.declineFriendRequest(request.id), 'Request declined.')}
                        disabled={busy === `decline-${request.id}`}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="section-head" style={{ marginTop: 22 }}>
              <h2>Sent requests</h2>
              <span className="muted small">{data?.outgoing.length ?? 0}</span>
            </div>
            {(data?.outgoing.length ?? 0) === 0 ? (
              <p className="muted small">You have no requests waiting for a reply.</p>
            ) : (
              <div className="list-card">
                {data?.outgoing.map((request) => (
                  <div key={request.id} className="friend-row">
                    {request.user && <Avatar user={request.user} size="sm" />}
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>{request.user?.displayName ?? 'Member'}</div>
                      <div className="muted small">Sent {relativeTime(request.createdAt)}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void act(`cancel-${request.id}`, () => api.cancelFriendRequest(request.id), 'Request cancelled.')}
                      disabled={busy === `cancel-${request.id}`}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'blocked' && (
          <>
            <div className="section-head">
              <h2>Blocked members</h2>
              <span className="muted small">{data?.blocked.length ?? 0}</span>
            </div>
            {(data?.blocked.length ?? 0) === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><IconLock size={26} /></div>
                <h3>Nobody is blocked</h3>
                <p className="muted">Blocked members cannot send you friend requests or messages.</p>
              </div>
            ) : (
              <div className="list-card">
                {data?.blocked.map((entry) => (
                  <div key={entry.user.id} className="friend-row">
                    <Avatar user={entry.user} size="sm" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>{entry.user.displayName}</div>
                      <div className="muted small">Blocked {relativeTime(entry.createdAt)}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void act(`unblock-${entry.user.id}`, () => api.unblockUser(entry.user.id), 'Member unblocked.')}
                      disabled={busy === `unblock-${entry.user.id}`}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
