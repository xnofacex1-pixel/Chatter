import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell, DefaultSidebar } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { IconBell, IconCheck, IconHeadphones, IconLock, IconLogout, IconMic, IconMonitor, IconSettings, IconShield, IconSparkle, IconUser } from '../components/icons';
import { api, type SessionInfo, type Settings as SettingsType } from '../lib/api';
import { DEFAULT_SETTINGS, useAuth } from '../lib/auth';
import { ACCENT_COLOURS, formatDateTime, relativeTime } from '../lib/format';
import { describeError, emailProblem, passwordProblem, usernameProblem } from '../lib/validation';
import { DeviceSettings } from '../components/DeviceSettings';
import { SoundSettingsPanel } from '../components/SoundSettings';

type TabId = 'account' | 'privacy' | 'appearance' | 'notifications' | 'voice' | 'sounds' | 'accessibility' | 'sessions' | 'danger';

const TABS: { id: TabId; label: string; icon: (props: { size?: number }) => React.ReactElement }[] = [
  { id: 'account', label: 'Account', icon: IconUser },
  { id: 'privacy', label: 'Privacy', icon: IconLock },
  { id: 'appearance', label: 'Appearance', icon: IconSparkle },
  { id: 'notifications', label: 'Notifications', icon: IconBell },
  { id: 'voice', label: 'Voice & video', icon: IconMic },
  { id: 'sounds', label: 'Sounds', icon: IconHeadphones },
  { id: 'accessibility', label: 'Accessibility', icon: IconSettings },
  { id: 'sessions', label: 'Devices', icon: IconMonitor },
  { id: 'danger', label: 'Danger zone', icon: IconShield },
];

export default function Settings() {
  const { user, settings, setUser, setSettings, saveSettings, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('account');

  const prefs: SettingsType = settings ?? DEFAULT_SETTINGS;

  if (!user) return null;

  return (
    <AppShell
      title="Settings"
      subtitle="Account, privacy, appearance and security"
      sidebar={<DefaultSidebar active="settings" />}
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Settings sections">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={`btn btn-sm ${tab === entry.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTab(entry.id)}
              >
                <Icon size={14} /> {entry.label}
              </button>
            );
          })}
        </div>

        {tab === 'account' && <AccountSection />}
        {tab === 'privacy' && <PrivacySection prefs={prefs} />}
        {tab === 'appearance' && <AppearanceSection prefs={prefs} />}
        {tab === 'notifications' && <NotificationSection prefs={prefs} />}
        {tab === 'voice' && <DeviceSettings />}
        {tab === 'sounds' && <SoundSettingsPanel />}
        {tab === 'accessibility' && <AccessibilitySection prefs={prefs} />}
        {tab === 'sessions' && <SessionsSection />}
        {tab === 'danger' && <DangerSection />}
      </div>
    </AppShell>
  );

  function AccountSection() {
    const [form, setForm] = useState({
      username: user?.username ?? '',
      displayName: user?.displayName ?? '',
      email: user?.email ?? '',
    });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordBusy, setPasswordBusy] = useState(false);

    const saveAccount = async () => {
      setError(null);
      const usernameIssue = usernameProblem(form.username);
      if (usernameIssue) return setError(usernameIssue);
      const emailIssue = emailProblem(form.email);
      if (emailIssue) return setError(emailIssue);
      if (!form.displayName.trim()) return setError('Add a display name.');
      setBusy(true);
      try {
        const data = await api.updateAccount({
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          email: form.email.trim(),
        });
        setUser(data.user);
        setSettings(data.settings);
        toast.success('Account updated');
      } catch (caught) {
        const described = describeError(caught);
        setError(described.fields.username ?? described.fields.email ?? described.message);
      } finally {
        setBusy(false);
      }
    };

    const changePassword = async () => {
      setPasswordError(null);
      if (!passwords.current) return setPasswordError('Enter your current password.');
      const issue = passwordProblem(passwords.next);
      if (issue) return setPasswordError(issue);
      if (passwords.next !== passwords.confirm) return setPasswordError('The new passwords do not match.');
      setPasswordBusy(true);
      try {
        await api.changePassword(passwords.current, passwords.next);
        setPasswords({ current: '', next: '', confirm: '' });
        toast.success('Password changed', 'Other devices have been signed out.');
      } catch (caught) {
        setPasswordError(describeError(caught).message);
      } finally {
        setPasswordBusy(false);
      }
    };

    return (
      <div className="settings-layout">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card">
            <div className="section-head">Account details</div>
            <div className="card-pad stack" style={{ gap: 12 }}>
              {error && (
                <div className="notice" data-kind="error" role="alert">
                  {error}
                </div>
              )}
              <div className="field">
                <label className="field-label" htmlFor="settingsUsername">
                  Username
                </label>
                <input
                  id="settingsUsername"
                  className="input"
                  value={form.username}
                  maxLength={24}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="settingsDisplayName">
                  Display name
                </label>
                <input
                  id="settingsDisplayName"
                  className="input"
                  value={form.displayName}
                  maxLength={40}
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="settingsEmail">
                  Email address
                </label>
                <input
                  id="settingsEmail"
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
                <div className="field-hint">Changing your email requires verifying the new address.</div>
              </div>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={saveAccount} disabled={busy}>
                  <IconCheck size={15} /> {busy ? 'Saving…' : 'Save changes'}
                </button>
                <Link className="btn btn-ghost" to="/profile">
                  Profile appearance
                </Link>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="section-head">Password</div>
            <div className="card-pad stack" style={{ gap: 12 }}>
              {passwordError && (
                <div className="notice" data-kind="error" role="alert">
                  {passwordError}
                </div>
              )}
              <div className="field">
                <label className="field-label" htmlFor="currentPassword">
                  Current password
                </label>
                <input
                  id="currentPassword"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={passwords.current}
                  onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="nextPassword">
                  New password
                </label>
                <input
                  id="nextPassword"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.next}
                  onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
                />
                <div className="field-hint">At least 10 characters with a letter and a number.</div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="confirmNextPassword">
                  Confirm new password
                </label>
                <input
                  id="confirmNextPassword"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                />
              </div>
              <div>
                <button type="button" className="btn btn-primary" onClick={changePassword} disabled={passwordBusy}>
                  {passwordBusy ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad stack">
            <div style={{ fontWeight: 650 }}>Signed in as</div>
            <div className="row" style={{ gap: 10 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontWeight: 600 }}>{user?.displayName}</div>
                <div className="tiny muted truncate">@{user?.username}</div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                <IconLogout size={15} /> Sign out
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function PrivacySection({ prefs: current }: { prefs: SettingsType }) {
    const update = async (patch: Partial<SettingsType>) => {
      try {
        await saveSettings(patch);
        toast.success('Privacy updated');
      } catch (caught) {
        toast.error('Could not save', describeError(caught).message);
      }
    };
    return (
      <section className="card">
        <div className="section-head">Privacy</div>
        <div className="card-pad stack" style={{ gap: 4 }}>
          <SelectRow
            label="Who can message me"
            description="Direct messages arrive in Stage 2; this preference is already stored."
            value={current.dmPrivacy}
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'friends', label: 'Friends only' },
              { value: 'none', label: 'Nobody' },
            ]}
            onChange={(value) => void update({ dmPrivacy: value as SettingsType['dmPrivacy'] })}
          />
          <div className="divider" />
          <SelectRow
            label="Who can send friend requests"
            value={current.friendRequestPrivacy}
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'friends', label: 'Friends of friends' },
              { value: 'none', label: 'Nobody' },
            ]}
            onChange={(value) => void update({ friendRequestPrivacy: value as SettingsType['friendRequestPrivacy'] })}
          />
          <div className="divider" />
          <SelectRow
            label="Who can see my presence"
            description="Controls whether other members see you as online."
            value={current.presenceVisibility}
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'friends', label: 'Friends only' },
              { value: 'nobody', label: 'Nobody' },
            ]}
            onChange={(value) => void update({ presenceVisibility: value as SettingsType['presenceVisibility'] })}
          />
          <div className="divider" />
          <Toggle
            label="Read receipts"
            description="Show others when you have read their messages."
            checked={current.readReceipts}
            onChange={(checked) => void update({ readReceipts: checked })}
          />
        </div>
      </section>
    );
  }

  function AppearanceSection({ prefs: current }: { prefs: SettingsType }) {
    const update = async (patch: Partial<SettingsType>) => {
      try {
        await saveSettings(patch);
      } catch (caught) {
        toast.error('Could not save appearance', describeError(caught).message);
      }
    };
    return (
      <div className="settings-layout">
        <section className="card">
          <div className="section-head">Theme</div>
          <div className="card-pad stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 8 }}>
              {(['dark', 'light'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`btn ${current.theme === theme ? 'btn-primary' : 'btn-ghost'}`}
                  aria-pressed={current.theme === theme}
                  onClick={() => void update({ theme })}
                >
                  {theme === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
              <span className="tiny muted">Dark is the Chatter default.</span>
            </div>
            <div className="divider" />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Accent colour</div>
              <div className="swatch-grid">
                {ACCENT_COLOURS.map((colour) => (
                  <button
                    key={colour.name}
                    type="button"
                    className="swatch"
                    style={{
                      background: colour.value,
                      outline: current.accent === colour.name ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: 2,
                    }}
                    aria-label={colour.label}
                    aria-pressed={current.accent === colour.name}
                    onClick={() => void update({ accent: colour.name as SettingsType['accent'] })}
                  />
                ))}
              </div>
            </div>
            <div className="divider" />
            <Toggle
              label="Compact layout"
              description="Tighter spacing for denser message lists."
              checked={current.compactMode}
              onChange={(checked) => void update({ compactMode: checked })}
            />
            <div className="divider" />
            <SelectRow
              label="Message display"
              value={current.messageDisplay}
              options={[
                { value: 'cozy', label: 'Cozy — avatars and spacing' },
                { value: 'compact', label: 'Compact — dense lines' },
              ]}
              onChange={(value) => void update({ messageDisplay: value as SettingsType['messageDisplay'] })}
            />
            <div className="divider" />
            <Toggle
              label="Reduce motion"
              description="Disable transitions and animated accents."
              checked={current.reducedMotion}
              onChange={(checked) => void update({ reducedMotion: checked })}
            />
          </div>
        </section>
        <section className="card card-pad stack">
          <div style={{ fontWeight: 650 }}>Live preview</div>
          <div className="card" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="status-dot" data-presence="online" />
              <span style={{ fontWeight: 600 }}>Accent preview</span>
              <span className="badge">Badge</span>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <span className="btn btn-primary btn-sm">Primary</span>
              <span className="btn btn-ghost btn-sm">Secondary</span>
            </div>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            Appearance applies instantly and is stored on your account, so it follows you to other devices.
          </p>
        </section>
      </div>
    );
  }

  function NotificationSection({ prefs: current }: { prefs: SettingsType }) {
    const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    );

    const update = async (notifications: Partial<SettingsType['notifications']>) => {
      try {
        await saveSettings({ notifications: { ...current.notifications, ...notifications } });
      } catch (caught) {
        toast.error('Could not save notifications', describeError(caught).message);
      }
    };

    const requestPermission = async () => {
      if (typeof Notification === 'undefined') return;
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') toast.success('Desktop notifications enabled');
      if (result === 'denied') toast.info('Desktop notifications blocked', 'You can re-enable them in your browser settings.');
    };

    return (
      <div className="settings-layout">
        <section className="card">
          <div className="section-head">Notification preferences</div>
          <div className="card-pad stack" style={{ gap: 4 }}>
            <Toggle
              label="Desktop notifications"
              description="Requires browser permission."
              checked={current.notifications.desktop}
              onChange={(checked) => void update({ desktop: checked })}
            />
            <div className="divider" />
            <Toggle
              label="Notification sounds"
              checked={current.notifications.sounds}
              onChange={(checked) => void update({ sounds: checked })}
            />
            <div className="divider" />
            <Toggle
              label="Direct messages"
              checked={current.notifications.messages}
              onChange={(checked) => void update({ messages: checked })}
            />
            <div className="divider" />
            <Toggle
              label="Mentions and replies"
              checked={current.notifications.mentions}
              onChange={(checked) => void update({ mentions: checked })}
            />
            <div className="divider" />
            <Toggle
              label="Incoming calls"
              checked={current.notifications.calls}
              onChange={(checked) => void update({ calls: checked })}
            />
          </div>
        </section>
        <section className="card card-pad stack">
          <div style={{ fontWeight: 650 }}>Browser permission</div>
          <div className="row-between">
            <span className="muted small">Current status</span>
            <span className="badge" data-kind={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'warning'}>
              {permission === 'unsupported' ? 'Unsupported' : permission}
            </span>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            Notification delivery for new messages, mentions and calls is switched on in Stage 6 together with the
            real-time gateway. Your preferences here are already saved.
          </p>
          <button type="button" className="btn btn-ghost" onClick={requestPermission} disabled={permission === 'granted' || permission === 'unsupported'}>
            {permission === 'granted' ? 'Permission granted' : 'Request permission'}
          </button>
        </section>
      </div>
    );
  }

  function AccessibilitySection({ prefs: current }: { prefs: SettingsType }) {
    const update = async (patch: Partial<SettingsType>) => {
      try {
        await saveSettings(patch);
      } catch (caught) {
        toast.error('Could not save accessibility settings', describeError(caught).message);
      }
    };
    return (
      <div className="settings-layout">
        <section className="card">
          <div className="section-head">Accessibility</div>
          <div className="card-pad stack" style={{ gap: 14 }}>
            <Toggle
              label="Reduced motion"
              description="Removes animated transitions across Chatter."
              checked={current.reducedMotion}
              onChange={(checked) => void update({ reducedMotion: checked })}
            />
            <div className="divider" />
            <div>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>Text scaling</span>
                <span className="badge">{Math.round(current.textScale * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.9}
                max={1.3}
                step={0.05}
                value={current.textScale}
                aria-label="Text scaling"
                style={{ width: '100%', accentColor: 'var(--accent-500)' }}
                onChange={(event) => void update({ textScale: Number(event.target.value) })}
              />
              <div className="tiny muted">Scales interface text without breaking the layout.</div>
            </div>
          </div>
        </section>
        <section className="card card-pad stack">
          <div style={{ fontWeight: 650 }}>Keyboard and screen readers</div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Every control is reachable with Tab and has a visible focus ring.</li>
            <li>Icons used as buttons carry accessible labels.</li>
            <li>Status changes are announced through live regions.</li>
            <li>Colour is never the only way information is conveyed.</li>
          </ul>
        </section>
      </div>
    );
  }

  function SessionsSection() {
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = () => {
      setLoading(true);
      api
        .sessions()
        .then((data) => setSessions(data.sessions))
        .catch(() => setError('Chatter could not load your active devices.'))
        .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const revoke = async (session: SessionInfo) => {
      setBusy(session.id);
      try {
        const result = await api.revokeSession(session.id);
        if (result.signedOut) {
          toast.info('Signed out', 'This device was signed out.');
          navigate('/login');
          return;
        }
        setSessions((current) => current.filter((entry) => entry.id !== session.id));
        toast.success('Device signed out');
      } catch (caught) {
        toast.error('Could not sign out device', describeError(caught).message);
      } finally {
        setBusy(null);
      }
    };

    const revokeOthers = async () => {
      setBusy('others');
      try {
        await api.revokeOtherSessions();
        setSessions((current) => current.filter((entry) => entry.current));
        toast.success('Other devices signed out');
      } catch (caught) {
        toast.error('Could not sign out devices', describeError(caught).message);
      } finally {
        setBusy(null);
      }
    };

    return (
      <section className="card">
        <div className="section-head">
          <span>Active devices</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={revokeOthers} disabled={busy !== null || sessions.length < 2}>
            Sign out all others
          </button>
        </div>
        {error && (
          <div className="card-pad">
            <div className="notice" data-kind="error" role="alert">
              {error}
            </div>
          </div>
        )}
        {loading ? (
          <div className="card-pad stack">
            {[0, 1].map((key) => (
              <div key={key} className="skeleton" style={{ height: 54, borderRadius: 12 }} />
            ))}
          </div>
        ) : (
          <div className="list-card">
            {sessions.map((session) => (
              <div key={session.id} className="list-row">
                <span className="badge">{session.current ? 'This device' : 'Session'}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ display: 'block', fontWeight: 550 }}>{session.device}</span>
                  <span className="tiny muted truncate" style={{ display: 'block' }}>
                    {session.ip} · active {relativeTime(session.lastUsedAt)} · started {formatDateTime(session.createdAt)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void revoke(session)}
                  disabled={busy !== null}
                >
                  {session.current ? 'Sign out' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function DangerSection() {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const remove = async () => {
      setError(null);
      if (!password) return setError('Enter your password to continue.');
      if (confirm !== 'DELETE') return setError('Type DELETE to confirm.');
      setBusy(true);
      try {
        await api.deleteAccount(password);
        toast.info('Account deleted', 'Your Chatter account has been removed.');
        await logout();
        navigate('/register');
      } catch (caught) {
        setError(describeError(caught).message);
      } finally {
        setBusy(false);
      }
    };

    return (
      <section className="card" style={{ borderColor: 'var(--danger-border, rgba(244,63,94,0.35))' }}>
        <div className="section-head">Delete account</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div className="notice" data-kind="warning">
            Deleting your account permanently removes your profile, sessions and uploads. This cannot be undone.
          </div>
          {error && (
            <div className="notice" data-kind="error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="deletePassword">
              Password
            </label>
            <input
              id="deletePassword"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="deleteConfirm">
              Type DELETE to confirm
            </label>
            <input
              id="deleteConfirm"
              className="input"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="DELETE"
            />
          </div>
          <div>
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </div>
      </section>
    );
  }
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="row-between" style={{ gap: 12, padding: '8px 0' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 550 }}>{label}</div>
        {description && <div className="tiny muted">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          width: 46,
          height: 26,
          flex: 'none',
          borderRadius: 999,
          border: '1px solid var(--border-default)',
          background: checked ? 'var(--accent-500)' : 'rgba(148,163,184,0.28)',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.18s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: 999,
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            transition: 'left 0.18s ease',
          }}
        />
      </button>
    </div>
  );
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useMemo(() => `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);
  return (
    <div className="row-between" style={{ gap: 12, padding: '8px 0', alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <label className="field-label" htmlFor={id} style={{ marginBottom: 0 }}>
          {label}
        </label>
        {description && <div className="tiny muted">{description}</div>}
      </div>
      <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
