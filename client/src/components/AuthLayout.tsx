import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from './Logo';
import { IconShield, IconSparkle, IconUsers } from './icons';

const features = [
  { icon: IconSparkle, title: 'Built for real conversation', body: 'Live messaging, presence and community spaces that feel instant.' },
  { icon: IconUsers, title: 'Your community, your rules', body: 'Roles, permissions and moderation tools that stay under your control.' },
  { icon: IconShield, title: 'Private by default', body: 'Server-side authorisation on every request. Your data stays yours.' },
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth-shell">
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-art-inner">
          <div className="row" style={{ gap: 12 }}>
            <LogoMark size={44} />
            <div>
              <div style={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: 20 }}>Chatter</div>
              <div className="tiny muted">Your community. Your conversations.</div>
            </div>
          </div>
          <h2 style={{ fontSize: 30, lineHeight: 1.2, margin: '36px 0 10px', letterSpacing: '-0.03em' }}>
            A calmer place for your people.
          </h2>
          <p className="muted" style={{ margin: 0, maxWidth: 360 }}>
            Chatter brings messages, communities and calls together in one polished workspace.
          </p>
          <div className="auth-features">
            {features.map((feature) => (
              <div key={feature.title} className="auth-feature">
                <span className="auth-feature-icon">
                  <feature.icon size={18} />
                </span>
                <div>
                  <div style={{ fontWeight: 650 }}>{feature.title}</div>
                  <div className="small muted">{feature.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="auth-panel-wrap">
        <div className="auth-panel">
          <div className="row" style={{ gap: 10 }}>
            <LogoMark size={34} />
            <span style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Chatter</span>
          </div>
          <h1 style={{ fontSize: 26, margin: '22px 0 6px', letterSpacing: '-0.02em' }}>{title}</h1>
          <p className="muted small" style={{ margin: '0 0 22px' }}>{subtitle}</p>
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
          <div className="auth-meta">
            <Link to="/login">Sign in</Link>
            <span aria-hidden="true">·</span>
            <Link to="/register">Create account</Link>
            <span aria-hidden="true">·</span>
            <span>Chatter v1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
