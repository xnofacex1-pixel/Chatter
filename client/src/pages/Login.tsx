import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../lib/auth';
import { describeError } from '../lib/validation';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFields({});
    if (!identifier.trim() || !password) {
      setError('Enter your email or username and your password.');
      return;
    }
    setBusy(true);
    try {
      await login(identifier.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      setFields(described.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to pick up where your conversations left off."
      footer={
        <span>
          New to Chatter? <Link to="/register">Create an account</Link>
        </span>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && (
          <div className="notice" data-kind="error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="identifier">
            Email or username
          </label>
          <input
            id="identifier"
            name="identifier"
            className="input"
            autoComplete="username"
            autoFocus
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(fields.identifier)}
          />
          {fields.identifier && <div className="field-error">{fields.identifier}</div>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
            aria-invalid={Boolean(fields.password)}
          />
          {fields.password && <div className="field-error">{fields.password}</div>}
          <div className="field-hint">
            <Link to="/forgot-password">Forgot your password?</Link>
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
