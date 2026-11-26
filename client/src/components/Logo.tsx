type LogoProps = { size?: number; withWordmark?: boolean; subtitle?: string };

/** Chatter mark: a stylised speech bubble with a cyan spark. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Chatter logo">
      <defs>
        <linearGradient id="chatter-mark" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="0.5" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="chatter-spark" x1="30" y1="20" x2="46" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c7f9ff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#chatter-mark)" />
      <path
        d="M18 20.5h28a5.5 5.5 0 0 1 5.5 5.5v13a5.5 5.5 0 0 1-5.5 5.5H31.5L21 52.5V44.5h-3a5.5 5.5 0 0 1-5.5-5.5V26a5.5 5.5 0 0 1 5.5-5.5Z"
        fill="rgba(4, 20, 34, 0.34)"
      />
      <path d="M24 30h16M24 36h10" stroke="url(#chatter-spark)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="43.5" cy="35.5" r="3.4" fill="url(#chatter-spark)" />
    </svg>
  );
}

export function Logo({ size = 40, withWordmark = true, subtitle }: LogoProps) {
  return (
    <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <LogoMark size={size} />
      {withWordmark && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span
            style={{
              fontSize: size * 0.46,
              fontWeight: 800,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              background: 'linear-gradient(100deg, #e8fbff, #67e8f9 45%, #a5b4fc)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Chatter
          </span>
          {subtitle && <span style={{ fontSize: size * 0.24, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{subtitle}</span>}
        </div>
      )}
    </div>
  );
}
