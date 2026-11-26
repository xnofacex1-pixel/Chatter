import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, DefaultSidebar, MemberList } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { EmptyState, InlineLoader } from '../components/LoadingScreen';
import { IconSearch, IconUsers } from '../components/icons';
import { api, type User } from '../lib/api';
import { formatDate, presenceLabel } from '../lib/format';

type Filter = 'all' | 'online' | 'offline' | 'owner';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'owner', label: 'Owner' },
];

export default function Members() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .users(query.trim(), 60)
        .then((data) => {
          if (cancelled) return;
          setUsers(data.users);
          setTotal(data.total);
        })
        .catch(() => {
          if (!cancelled) setError('Chatter could not load the member directory.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const visible = useMemo(() => {
    if (filter === 'all') return users;
    if (filter === 'owner') return users.filter((entry) => entry.isOwner);
    if (filter === 'online') return users.filter((entry) => entry.presence !== 'offline');
    return users.filter((entry) => entry.presence === 'offline');
  }, [users, filter]);

  return (
    <AppShell
      title="Members"
      subtitle={`${total.toLocaleString()} ${total === 1 ? 'account' : 'accounts'} in this Chatter workspace`}
      sidebar={<DefaultSidebar active="members" />}
      members={<MemberList users={users} loading={loading} />}
      search={{ value: query, onChange: setQuery, placeholder: 'Search members by name or username' }}
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {filters.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`btn btn-sm ${filter === entry.id ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          <span className="grow" />
          <span className="tiny muted">
            {visible.length} shown{query ? ` for “${query}”` : ''}
          </span>
        </div>

        {error && (
          <div className="notice" data-kind="error" role="alert">
            {error}
          </div>
        )}

        {loading && users.length === 0 ? (
          <InlineLoader label="Loading members" />
        ) : visible.length === 0 ? (
          <EmptyState
            title={query ? 'No members match that search' : 'Nobody here yet'}
            description={query ? 'Try a different name or username.' : 'Once people join this Chatter workspace they will appear here.'}
            icon={<IconSearch size={26} />}
          />
        ) : (
          <div className="list-card">
            {visible.map((member) => (
              <Link key={member.id} to={`/u/${member.username}`} className="list-row">
                <Avatar user={member} size="md" showPresence />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="truncate" style={{ fontWeight: 600 }}>{member.displayName}</span>
                    {member.isOwner && <OwnerBadge />}
                  </span>
                  <span className="tiny muted truncate">
                    @{member.username} · {presenceLabel(member.presence)}
                    {member.customStatus ? ` · ${member.customStatus}` : ''}
                  </span>
                </span>
                <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  Joined {formatDate(member.createdAt, { month: 'short', year: 'numeric' })}
                </span>
              </Link>
            ))}
          </div>
        )}

        <p className="tiny muted row" style={{ gap: 6, margin: 0 }}>
          <IconUsers size={13} /> Member emails are private and never included in directory responses.
        </p>
      </div>
    </AppShell>
  );
}
