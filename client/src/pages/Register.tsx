import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../lib/auth';
import { describeError, emailProblem, passwordProblem, usernameProblem } from '../lib/validation';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const nextFields: Record<string, string> = {};
    const emailIssue = emailProblem(form.email);
    if (emailIssue) nextFields.email = emailIssue;
    const usernameIssue = usernameProblem(form.username);
    if (usernameIssue) nextFields.username = usernameIssue;
    const passwordIssue = passwordProblem(form.password);
    if (passwordIssue) nextFields.password = passwordIssue;
    setFields(nextFields);
    if (Object.keys(nextFields).length > 0) {
      setError('Please fix the highlighted fields.');
      return;
    }

    setBusy(true);
    try {
      await register({
        email: form.email.trim(),
        username: form.username.trim(),
        displayName: form.displayName.trim() || undefined,
        password: form.password,
      });
      navigate('/', { replace: true });
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
      title="Create your Chatter account"
      subtitle="Pick a username, secure your account, and you are in."
      footer={
        <span>
          Already have an account? <Link to="/login">Sign in</Link>
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
          <label className="field-label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => update('email')(event.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(fields.email)}
          />
          {fields.email ? <div className="field-error">{fields.email}</div> : <div className="field-hint">Used to verify your account and recover it.</div>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            autoComplete="username"
            value={form.username}
            onChange={(event) => update('username')(event.target.value)}
            placeholder="mason_dev"
            aria-invalid={Boolean(fields.username)}
          />
          {fields.username ? <div className="field-error">{fields.username}</div> : <div className="field-hint">3–24 characters: letters, numbers, dots or underscores.</div>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="displayName">
            Display name <span className="muted tiny">optional</span>
          </label>
          <input
            id="displayName"
            className="input"
            autoComplete="nickname"
            value={form.displayName}
            onChange={(event) => update('displayName')(event.target.value)}
            placeholder="How your name appears in Chatter"
            aria-invalid={Boolean(fields.displayName)}
          />
          {fields.displayName && <div className="field-error">{fields.displayName}</div>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="newPassword">
            Password
          </label>
          <input
            id="newPassword"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => update('password')(event.target.value)}
            placeholder="At least 10 characters"
            aria-invalid={Boolean(fields.password)}
          />
          {fields.password ? <div className="field-error">{fields.password}</div> : <div className="field-hint">At least 10 characters with a letter and a number.</div>}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
        <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>
          Passwords are hashed with scrypt. Chatter never stores plaintext passwords.
        </p>
      </form>
    </AuthLayout>
  );
}
