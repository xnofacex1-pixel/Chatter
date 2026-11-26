import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { api } from '../lib/api';
import { describeError, emailProblem } from '../lib/validation';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ emailSent: boolean; resetUrl?: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const issue = emailProblem(email);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    try {
      const result = await api.forgotPassword(email.trim());
      setSent({ emailSent: result.emailSent, resetUrl: result.resetUrl });
    } catch (caught) {
      setError(describeError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will send a secure, single-use reset link to your email address."
      footer={
        <span>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </span>
      }
    >
      {sent ? (
        <div className="stack">
          <div className="notice" data-kind="success" role="status">
            If an account exists for that address, a reset link is on its way. The link expires in 60 minutes.
          </div>
          {!sent.emailSent && (
            <div className="notice" data-kind="warning">
              Email delivery is not configured on this deployment yet. Ask the owner to set <span className="mono">RESEND_API_KEY</span>.
            </div>
          )}
          {sent.resetUrl && (
            <div className="card card-pad stack">
              <div className="section-head">Development reset link</div>
              <p className="small muted" style={{ margin: 0 }}>
                Mail delivery is not configured, so the link is shown here for this environment only.
              </p>
              <Link className="btn btn-primary" to={sent.resetUrl.replace(/^https?:\/\/[^/]+/, '')}>
                Open reset link
              </Link>
            </div>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setSent(null)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          {error && (
            <div className="notice" data-kind="error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="resetEmail">
              Email address
            </label>
            <input
              id="resetEmail"
              className="input"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
