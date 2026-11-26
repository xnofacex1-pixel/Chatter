import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { InlineLoader } from '../components/LoadingScreen';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { describeError } from '../lib/validation';

type LocationState = { emailSent?: boolean; verificationUrl?: string; email?: string } | null;

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, setUser, setSettings, refresh } = useAuth();
  const state = (location.state as LocationState) ?? null;
  const token = params.get('token') ?? '';

  const [status, setStatus] = useState<'idle' | 'verifying' | 'verified' | 'failed'>(token ? 'verifying' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState<{ emailSent: boolean; verificationUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setStatus('verifying');
    api
      .verifyEmail(token)
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setSettings(data.settings);
        setStatus('verified');
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(describeError(caught).message);
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token, setUser, setSettings]);

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.resendVerification();
      setResent({ emailSent: result.emailSent, verificationUrl: result.verificationUrl });
      await refresh();
    } catch (caught) {
      setError(describeError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const verified = status === 'verified' || (user?.emailVerified && !token);

  return (
    <AuthLayout
      title={verified ? 'Email verified' : 'Verify your email'}
      subtitle={
        verified
          ? 'Your account is fully activated. Welcome to Chatter.'
          : 'Confirm your address to unlock password recovery and account security features.'
      }
      footer={
        <span>
          Wrong account? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <div className="stack">
        {status === 'verifying' && <InlineLoader label="Checking your verification link" />}

        {verified && (
          <>
            <div className="notice" data-kind="success" role="status">
              Your email address is confirmed.
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/', { replace: true })}>
              Enter Chatter
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="notice" data-kind="error" role="alert">
              {error ?? 'That verification link is invalid or has expired.'}
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={resend} disabled={busy}>
              {busy ? 'Sending…' : 'Send a new link'}
            </button>
          </>
        )}

        {status === 'idle' && !verified && (
          <>
            {state?.emailSent ? (
              <div className="notice" data-kind="info" role="status">
                We sent a verification link to {state.email ?? 'your email address'}. It expires in 24 hours.
              </div>
            ) : (
              <div className="notice" data-kind="warning">
                Email delivery is not configured on this deployment, so no verification mail was sent. Use the link below
                to verify this account in development.
              </div>
            )}

            {(state?.verificationUrl || resent?.verificationUrl) && (
              <div className="card card-pad stack">
                <div className="section-head">Development verification link</div>
                <Link
                  className="btn btn-primary"
                  to={(state?.verificationUrl ?? resent?.verificationUrl ?? '').replace(/^https?:\/\/[^/]+/, '')}
                >
                  Verify my email now
                </Link>
              </div>
            )}

            {resent?.emailSent && (
              <div className="notice" data-kind="success" role="status">
                A new verification link is on its way.
              </div>
            )}

            {error && (
              <div className="notice" data-kind="error" role="alert">
                {error}
              </div>
            )}

            <button type="button" className="btn btn-ghost btn-block" onClick={resend} disabled={busy}>
              {busy ? 'Sending…' : 'Resend verification email'}
            </button>
            <Link className="btn btn-ghost btn-block" to="/">
              Continue to Chatter
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
