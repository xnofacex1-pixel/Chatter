import type { User } from '../lib/api';

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

const sizeMap = { xs: 24, sm: 32, md: 40, lg: 56, xl: 88, xxl: 120 } as const;

type AvatarProps = {
  user: Pick<User, 'username' | 'displayName' | 'avatarUrl' | 'accentColor' | 'presence' | 'isOwner'>;
  size?: keyof typeof sizeMap;
  showPresence?: boolean;
  className?: string;
};

export function Avatar({ user, size = 'md', showPresence = false, className = '' }: AvatarProps) {
  const px = sizeMap[size];
  const ring = user.isOwner ? '2px solid var(--gold)' : '1px solid var(--border-default)';
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: px,
        height: px,
        borderRadius: size === 'xs' ? 8 : Math.round(px * 0.3),
        position: 'relative',
        flex: 'none',
        display: 'inline-grid',
        placeItems: 'center',
        overflow: 'visible',
      }}
    >
      <span
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 'inherit',
          overflow: 'hidden',
          border: ring,
          background: user.accentColor || 'var(--accent-500)',
          display: 'grid',
          placeItems: 'center',
          boxShadow: user.isOwner ? '0 0 12px rgba(245, 196, 81, 0.4)' : 'none',
        }}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={`${user.displayName}'s avatar`}
            width={px}
            height={px}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              fontSize: Math.max(11, Math.round(px * 0.36)),
              fontWeight: 800,
              color: '#04121f',
              letterSpacing: '0.02em',
              textShadow: '0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            {initials(user.displayName || user.username)}
          </span>
        )}
      </span>
      {showPresence && (
        <span
          className="status-dot"
          data-presence={user.presence}
          title={user.presence}
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: Math.max(10, Math.round(px * 0.28)),
            height: Math.max(10, Math.round(px * 0.28)),
          }}
        />
      )}
    </span>
  );
}

export function OwnerBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="badge badge-owner" title="Chatter Founder & Owner">
      <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M3.4 8.2 7.6 11 12 5l4.4 6 4.2-2.8-1.7 9.3H5.1L3.4 8.2Z" />
      </svg>
      {compact ? 'Owner' : 'Owner'}
    </span>
  );
}
