import { Link } from 'react-router-dom';
import { LogoMark } from '../components/Logo';

export default function NotFound() {
  return (
    <div className="error-page">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 460 }}>
        <LogoMark size={64} />
        <div className="error-code">404</div>
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: '-0.02em' }}>This page drifted out of orbit</h1>
        <p className="muted" style={{ margin: 0 }}>
          The page you were looking for does not exist, or it moved somewhere else in Chatter.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 6 }}>
          <Link className="btn btn-primary" to="/">
            Back to Chatter
          </Link>
          <Link className="btn btn-ghost" to="/members">
            Browse members
          </Link>
        </div>
      </div>
    </div>
  );
}
