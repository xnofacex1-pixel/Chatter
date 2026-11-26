import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, DefaultSidebar, MemberList, useDirectory } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { ImageInput, useImageUpload, useProfileSave } from '../components/profile-shared';
import { useToast } from '../components/Toast';
import { IconCamera, IconCheck, IconUser } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PROFILE_COLOURS, formatDate, presenceLabel } from '../lib/format';
import { describeError, usernameProblem } from '../lib/validation';

export default function Profile() {
  const { user, setUser } = useAuth();
  const directory = useDirectory();
  const toast = useToast();
  const avatar = useImageUpload('avatar');
  const banner = useImageUpload('banner');
  const { save, saving } = useProfileSave();

  const [identity, setIdentity] = useState({ username: '', displayName: '' });
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identitySaving, setIdentitySaving] = useState(false);

  const [profile, setProfile] = useState({
    pronouns: '',
    customStatus: '',
    aboutMe: '',
    accentColor: '#22d3ee',
    bannerColor: '#0f2b46',
  });

  useEffect(() => {
    if (!user) return;
    setIdentity({ username: user.username, displayName: user.displayName });
    setProfile({
      pronouns: user.pronouns ?? '',
      customStatus: user.customStatus ?? '',
      aboutMe: user.aboutMe ?? '',
      accentColor: user.accentColor || '#22d3ee',
      bannerColor: user.bannerColor || '#0f2b46',
    });
  }, [user]);

  if (!user) return null;

  const saveIdentity = async () => {
    setIdentityError(null);
    const usernameIssue = usernameProblem(identity.username);
    if (usernameIssue) {
      setIdentityError(usernameIssue);
      return;
    }
    if (!identity.displayName.trim()) {
      setIdentityError('Add a display name.');
      return;
    }
    setIdentitySaving(true);
    try {
      const data = await api.updateAccount({
        username: identity.username.trim(),
        displayName: identity.displayName.trim(),
      });
      setUser(data.user);
      toast.success('Account updated', 'Your username and display name are live.');
    } catch (error) {
      const described = describeError(error);
      setIdentityError(described.fields.username ?? described.message);
    } finally {
      setIdentitySaving(false);
    }
  };

  const saveProfile = async () => {
    await save(
      {
        pronouns: profile.pronouns.trim() || null,
        customStatus: profile.customStatus.trim() || null,
        aboutMe: profile.aboutMe.trim() || null,
        accentColor: profile.accentColor,
        bannerColor: profile.bannerColor,
      },
      'Profile saved',
    );
  };

  return (
    <AppShell
      title="My profile"
      subtitle="How you appear across Chatter"
      sidebar={<DefaultSidebar active="profile" />}
      members={<MemberList users={directory.users} loading={directory.loading} />}
      headActions={
        <Link className="btn btn-ghost btn-sm" to={`/u/${user.username}`}>
          <IconUser size={15} /> Public view
        </Link>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <section className="profile-head">
          <div
            className="profile-banner"
            style={
              user.bannerUrl
                ? { backgroundImage: `url(${user.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : { background: `linear-gradient(120deg, ${profile.bannerColor}, #0a1526 70%)` }
            }
          >
            <div className="profile-banner-actions">
              <ImageInput inputRef={banner.inputRef} onFile={banner.onFile} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={banner.pick} disabled={banner.busy}>
                <IconCamera size={15} /> {banner.busy ? 'Uploading…' : 'Change banner'}
              </button>
              {user.bannerUrl && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={banner.remove} disabled={banner.busy}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="profile-body">
            <div className="profile-avatar">
              <Avatar user={user} size="xl" showPresence />
              <ImageInput inputRef={avatar.inputRef} onFile={avatar.onFile} />
              <button type="button" className="avatar-edit" aria-label="Change avatar" onClick={avatar.pick} disabled={avatar.busy}>
                <IconCamera size={15} />
              </button>
            </div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 22, letterSpacing: '-0.02em' }}>{user.displayName}</h2>
                {user.isOwner && <OwnerBadge />}
              </div>
              <div className="muted small">
                @{user.username}
                {user.pronouns ? ` · ${user.pronouns}` : ''} · {presenceLabel(user.presence)}
              </div>
              <div className="tiny muted" style={{ marginTop: 4 }}>
                Member since {formatDate(user.createdAt)} · {user.emailVerified ? 'Email verified' : 'Email not verified'}
              </div>
            </div>
            {user.avatarUrl && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={avatar.remove} disabled={avatar.busy}>
                Remove avatar
              </button>
            )}
          </div>
        </section>

        <div className="settings-layout">
          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <div className="section-head">Account identity</div>
              <div className="card-pad stack" style={{ gap: 12 }}>
                {identityError && (
                  <div className="notice" data-kind="error" role="alert">
                    {identityError}
                  </div>
                )}
                <div className="field">
                  <label className="field-label" htmlFor="displayName">
                    Display name
                  </label>
                  <input
                    id="displayName"
                    className="input"
                    value={identity.displayName}
                    maxLength={40}
                    onChange={(event) => setIdentity({ ...identity, displayName: event.target.value })}
                  />
                  <div className="field-hint">Shown in chats, member lists and profiles.</div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="username">
                    Username
                  </label>
                  <input
                    id="username"
                    className="input"
                    value={identity.username}
                    maxLength={24}
                    onChange={(event) => setIdentity({ ...identity, username: event.target.value })}
                  />
                  <div className="field-hint">3–24 characters: letters, numbers, dots or underscores. Unique across Chatter.</div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={saveIdentity} disabled={identitySaving}>
                    {identitySaving ? 'Saving…' : 'Save identity'}
                  </button>
                  <span className="tiny muted">Your public profile URL updates when your username changes.</span>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="section-head">About you</div>
              <div className="card-pad stack" style={{ gap: 12 }}>
                <div className="field">
                  <label className="field-label" htmlFor="customStatus">
                    Custom status
                  </label>
                  <input
                    id="customStatus"
                    className="input"
                    value={profile.customStatus}
                    maxLength={60}
                    placeholder="Building something great"
                    onChange={(event) => setProfile({ ...profile, customStatus: event.target.value })}
                  />
                  <div className="field-hint">{60 - profile.customStatus.length} characters left</div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="pronouns">
                    Pronouns
                  </label>
                  <input
                    id="pronouns"
                    className="input"
                    value={profile.pronouns}
                    maxLength={24}
                    placeholder="they/them"
                    onChange={(event) => setProfile({ ...profile, pronouns: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="aboutMe">
                    About me
                  </label>
                  <textarea
                    id="aboutMe"
                    className="input"
                    rows={4}
                    maxLength={400}
                    value={profile.aboutMe}
                    placeholder="A short introduction for your profile."
                    onChange={(event) => setProfile({ ...profile, aboutMe: event.target.value })}
                  />
                  <div className="field-hint">{400 - profile.aboutMe.length} characters left</div>
                </div>
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={saveProfile} disabled={saving}>
                    <IconCheck size={15} /> {saving ? 'Saving…' : 'Save profile'}
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <div className="section-head">Profile accent</div>
              <div className="card-pad">
                <div className="swatch-grid">
                  {PROFILE_COLOURS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      className="swatch"
                      style={{ background: colour, outline: profile.accentColor === colour ? '2px solid var(--text-primary)' : 'none', outlineOffset: 2 }}
                      aria-label={`Accent ${colour}`}
                      aria-pressed={profile.accentColor === colour}
                      onClick={() => setProfile({ ...profile, accentColor: colour })}
                    />
                  ))}
                </div>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  The accent tints your avatar fallback and profile highlights.
                </p>
              </div>
            </section>

            <section className="card">
              <div className="section-head">Banner colour</div>
              <div className="card-pad">
                <div className="swatch-grid">
                  {PROFILE_COLOURS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      className="swatch"
                      style={{ background: colour, outline: profile.bannerColor === colour ? '2px solid var(--text-primary)' : 'none', outlineOffset: 2 }}
                      aria-label={`Banner ${colour}`}
                      aria-pressed={profile.bannerColor === colour}
                      onClick={() => setProfile({ ...profile, bannerColor: colour })}
                    />
                  ))}
                </div>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  Used when you have not uploaded a banner image.
                </p>
              </div>
            </section>

            <section className="card card-pad stack">
              <div style={{ fontWeight: 650 }}>Live preview</div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div
                  style={{
                    height: 64,
                    background: user.bannerUrl
                      ? `url(${user.bannerUrl}) center/cover`
                      : `linear-gradient(120deg, ${profile.bannerColor}, #0a1526 75%)`,
                  }}
                />
                <div className="card-pad row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <Avatar user={{ ...user, accentColor: profile.accentColor }} size="lg" showPresence />
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="truncate" style={{ fontWeight: 650 }}>{identity.displayName || user.displayName}</span>
                      {user.isOwner && <OwnerBadge compact />}
                    </div>
                    <div className="tiny muted">@{identity.username || user.username}{profile.pronouns ? ` · ${profile.pronouns}` : ''}</div>
                    {profile.customStatus && <div className="small" style={{ marginTop: 4 }}>{profile.customStatus}</div>}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
