import { LogoMark } from './Logo';

export function LoadingScreen({ label = 'Connecting to Chatter' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div className="loading-inner">
        <div className="loading-mark">
          <LogoMark size={76} />
        </div>
        <h1 className="loading-title">Chatter</h1>
        <p className="loading-tagline">Your community. Your conversations. Your Chatter.</p>
        <div className="loading-bar" role="progressbar" aria-label={label}>
          <span />
        </div>
        <p className="loading-label">{label}…</p>
      </div>
    </div>
  );
}

export function InlineLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="inline-loader" role="status" aria-live="polite">
      <span className="spinner" />
      <span className="muted small">{label}…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon ?? <LogoMark size={40} />}
      </div>
      <h3>{title}</h3>
      <p className="muted small">{description}</p>
      {action}
    </div>
  );
}
