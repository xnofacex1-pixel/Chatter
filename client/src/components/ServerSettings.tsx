import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type User } from '../lib/api';
import {
  has,
  P,
  serverApi,
  type ChannelType,
  type ModerationEntry,
  type ServerChannel,
  type ServerDetail,
  type ServerInvite,
  type ServerMember,
  type ServerRole,
} from '../lib/servers';
import { useToast } from './Toast';
import { Avatar } from './Avatar';
import { IconCheck, IconClose, IconLock, IconPlus, IconTrash, IconUpload } from './icons';

/**
 * Community settings. Every mutation goes through the server permission engine;
 * this panel only hides controls the current account cannot use.
 */
type TabKey = 'overview' | 'roles' | 'channels' | 'members' | 'invites' | 'moderation' | 'danger';

type Props = {
  serverId: string;
  detail: ServerDetail;
  me: User | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
};

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof ApiError ? cause.message : fallback;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function ServerSettings({ serverId, detail, me, onClose, onChanged, onDeleted }: Props) {
  const toast = useToast();
  const perms = detail.permissions;

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string }[] = [];
    if (has(perms, P.MANAGE_SERVER)) list.push({ key: 'overview', label: 'Overview' });
    if (has(perms, P.MANAGE_ROLES)) list.push({ key: 'roles', label: 'Roles' });
    if (has(perms, P.MANAGE_CHANNELS)) list.push({ key: 'channels', label: 'Channels' });
    if (
      has(perms, P.MANAGE_ROLES) ||
      has(perms, P.KICK_MEMBERS) ||
      has(perms, P.BAN_MEMBERS) ||
      has(perms, P.TIMEOUT_MEMBERS)
    )
      list.push({ key: 'members', label: 'Members' });
    if (has(perms, P.MANAGE_INVITES) || has(perms, P.CREATE_INVITES))
      list.push({ key: 'invites', label: 'Invites' });
    if (has(perms, P.VIEW_AUDIT_LOG) || has(perms, P.MANAGE_MESSAGES))
      list.push({ key: 'moderation', label: 'Moderation' });
    if (detail.server.isOwner) list.push({ key: 'danger', label: 'Danger zone' });
    return list;
  }, [perms, detail.server.isOwner]);

  const [tab, setTab] = useState<TabKey>(tabs[0]?.key ?? 'overview');

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Community settings" onClick={onClose}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <header className="settings-modal-head">
          <div>
            <h2>{detail.server.name}</h2>
            <p className="muted-sm">Community settings</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </header>

        <div className="settings-modal-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`settings-nav-item ${tab === entry.key ? 'is-active' : ''}`}
                aria-current={tab === entry.key ? 'page' : undefined}
                onClick={() => setTab(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="settings-panel">
            {tab === 'overview' && (
              <OverviewPanel serverId={serverId} detail={detail} onChanged={onChanged} />
            )}
            {tab === 'roles' && (
              <RolesPanel serverId={serverId} detail={detail} onChanged={onChanged} />
            )}
            {tab === 'channels' && (
              <ChannelsPanel serverId={serverId} detail={detail} onChanged={onChanged} />
            )}
            {tab === 'members' && (
              <MembersPanel
                serverId={serverId}
                detail={detail}
                me={me}
                toast={toast}
                onChanged={onChanged}
              />
            )}
            {tab === 'invites' && <InvitesPanel serverId={serverId} toast={toast} />}
            {tab === 'moderation' && <ModerationPanel serverId={serverId} />}
            {tab === 'danger' && (
              <DangerPanel
                serverId={serverId}
                detail={detail}
                onDeleted={onDeleted}
                onChanged={onChanged}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type ToastApi = ReturnType<typeof useToast>;

function OverviewPanel({
  serverId,
  detail,
  onChanged,
}: {
  serverId: string;
  detail: ServerDetail;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [name, setName] = useState(detail.server.name);
  const [description, setDescription] = useState(detail.server.description ?? '');
  const [isPublic, setIsPublic] = useState(detail.server.isPublic);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'icon' | 'banner' | null>(null);

  const save = async () => {
    setSaving(true);
    try {
      await serverApi.update(serverId, { name: name.trim(), description: description.trim() || null, isPublic });
      await onChanged();
      toast.success('Community updated', 'Your changes are live.');
    } catch (cause) {
      toast.error('Could not save', errorText(cause, 'Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'icon' | 'banner', file: File | null) => {
    if (!file) return;
    setUploading(kind);
    try {
      await serverApi.uploadImage(serverId, kind, file);
      await onChanged();
      toast.success(kind === 'icon' ? 'Icon updated' : 'Banner updated', '');
    } catch (cause) {
      toast.error('Upload failed', errorText(cause, 'Use a PNG, JPG or WebP image.'));
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="stack">
      <section className="field-group">
        <label className="field">
          <span>Community name</span>
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            value={description}
            maxLength={300}
            rows={3}
            placeholder="What is this community about?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="toggle-row">
          <span>
            <strong>Public community</strong>
            <span className="muted-sm">Listed in Discover so anyone can join.</span>
          </span>
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
        </label>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>

      <section className="field-group">
        <h3>Community icon</h3>
        <div className="media-row">
          <Avatar
            user={{
              username: detail.server.name,
              displayName: detail.server.name,
              avatarUrl: detail.server.iconUrl,
              accentColor: '',
              presence: 'offline',
              isOwner: false,
            }}
            size="lg"
          />
          <label className="btn btn-ghost btn-sm">
            <IconUpload size={15} /> {uploading === 'icon' ? 'Uploading…' : 'Upload icon'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => void upload('icon', event.target.files?.[0] ?? null)}
            />
          </label>
          {detail.server.iconUrl && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await serverApi.removeImage(serverId, 'icon');
                  await onChanged();
                } catch (cause) {
                  toast.error('Could not remove icon', errorText(cause, 'Try again.'));
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
      </section>

      <section className="field-group">
        <h3>Community banner</h3>
        {detail.server.bannerUrl ? (
          <img className="banner-preview" src={detail.server.bannerUrl} alt="Community banner" />
        ) : (
          <p className="muted-sm">No banner yet. A wide image (1500×500) looks best.</p>
        )}
        <div className="row-actions">
          <label className="btn btn-ghost btn-sm">
            <IconUpload size={15} /> {uploading === 'banner' ? 'Uploading…' : 'Upload banner'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => void upload('banner', event.target.files?.[0] ?? null)}
            />
          </label>
          {detail.server.bannerUrl && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await serverApi.removeImage(serverId, 'banner');
                  await onChanged();
                } catch (cause) {
                  toast.error('Could not remove banner', errorText(cause, 'Try again.'));
                }
              }}
            >
              Remove
            </button>
          )}
        </div>
      </section>

      <section className="field-group">
        <h3>Server details</h3>
        <dl className="kv">
          <div>
            <dt>Created</dt>
            <dd>{formatDate(detail.server.createdAt)}</dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd>{detail.server.memberCount}</dd>
          </div>
          <div>
            <dt>Your top role</dt>
            <dd>Position {detail.myTopPosition}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function RolesPanel({
  serverId,
  detail,
  onChanged,
}: {
  serverId: string;
  detail: ServerDetail;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [roles, setRoles] = useState<ServerRole[]>(detail.roles);
  const [selectedId, setSelectedId] = useState<string | null>(detail.roles[0]?.id ?? null);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState('#4cc9f0');
  const [draftPerms, setDraftPerms] = useState(0);
  const [busy, setBusy] = useState(false);

  const selected = roles.find((role) => role.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      setDraftName('');
      setDraftColor('#4cc9f0');
      setDraftPerms(0);
      return;
    }
    setDraftName(selected.name);
    setDraftColor(selected.color || '#4cc9f0');
    setDraftPerms(selected.permissions);
  }, [selected]);

  const reload = useCallback(async () => {
    const { roles: fresh } = await serverApi.roles(serverId);
    setRoles(fresh);
    await onChanged();
  }, [serverId, onChanged]);

  const createRole = async () => {
    setBusy(true);
    try {
      const { role } = await serverApi.createRole(serverId, { name: 'New role', color: '#4cc9f0', permissions: 0 });
      await reload();
      setSelectedId(role.id);
      toast.success('Role created', 'Assign permissions next.');
    } catch (cause) {
      toast.error('Could not create role', errorText(cause, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const saveRole = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await serverApi.updateRole(serverId, selected.id, {
        name: draftName.trim(),
        color: draftColor,
        permissions: draftPerms,
      });
      await reload();
      toast.success('Role saved', draftName.trim());
    } catch (cause) {
      toast.error('Could not save role', errorText(cause, 'Check the name and colour.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteRole = async () => {
    if (!selected || selected.isSystem) return;
    if (!window.confirm(`Delete the role "${selected.name}"? Members lose its permissions.`)) return;
    setBusy(true);
    try {
      await serverApi.deleteRole(serverId, selected.id);
      setSelectedId(null);
      await reload();
      toast.success('Role deleted', selected.name);
    } catch (cause) {
      toast.error('Could not delete role', errorText(cause, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const togglePerm = (bit: number) => {
    setDraftPerms((current) => (current & bit ? current & ~bit : current | bit));
  };

  return (
    <div className="settings-split">
      <div className="settings-list">
        <div className="settings-list-head">
          <h3>Roles</h3>
          <button type="button" className="icon-btn" aria-label="Create role" onClick={() => void createRole()} disabled={busy}>
            <IconPlus size={16} />
          </button>
        </div>
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            className={`settings-list-item ${role.id === selectedId ? 'is-active' : ''}`}
            onClick={() => setSelectedId(role.id)}
          >
            <span className="role-dot" style={{ background: role.color || 'var(--text-muted)' }} />
            <span>{role.name}</span>
            {role.isDefault && <span className="chip">default</span>}
          </button>
        ))}
      </div>

      <div className="settings-detail">
        {!selected && <p className="muted-sm">Select a role to edit its name, colour and permissions.</p>}
        {selected && (
          <>
            <label className="field">
              <span>Role name</span>
              <input
                value={draftName}
                maxLength={40}
                onChange={(event) => setDraftName(event.target.value)}
                disabled={selected.isSystem && !has(detail.permissions, P.ADMINISTRATOR) && selected.isDefault}
              />
            </label>
            <label className="field">
              <span>Role colour</span>
              <span className="color-row">
                <input type="color" value={draftColor || '#4cc9f0'} onChange={(event) => setDraftColor(event.target.value)} />
                <code>{draftColor}</code>
              </span>
            </label>

            <h4 className="section-title">Permissions</h4>
            <div className="perm-grid">
              {detail.permissionList.map((permission) => (
                <label key={permission.key} className="perm-item">
                  <input
                    type="checkbox"
                    checked={has(draftPerms, permission.bit)}
                    onChange={() => togglePerm(permission.bit)}
                  />
                  <span>{permission.label}</span>
                </label>
              ))}
            </div>

            <div className="row-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveRole()} disabled={busy || !draftName.trim()}>
                <IconCheck size={15} /> Save role
              </button>
              {!selected.isSystem && (
                <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => void deleteRole()} disabled={busy}>
                  <IconTrash size={15} /> Delete role
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChannelsPanel({
  serverId,
  detail,
  onChanged,
}: {
  serverId: string;
  detail: ServerDetail;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [channels, setChannels] = useState<ServerChannel[]>(detail.channels);
  const [categoryName, setCategoryName] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ChannelType>('text');
  const [newCategory, setNewCategory] = useState<string>('');
  const [newPrivate, setNewPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const fresh = await serverApi.get(serverId);
    setChannels(fresh.channels);
    await onChanged();
  }, [serverId, onChanged]);

  const addCategory = async () => {
    if (!categoryName.trim()) return;
    setBusy(true);
    try {
      await serverApi.createCategory(serverId, categoryName.trim());
      setCategoryName('');
      await refresh();
      toast.success('Category created', '');
    } catch (cause) {
      toast.error('Could not create category', errorText(cause, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const addChannel = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await serverApi.createChannel(serverId, {
        name: newName.trim(),
        type: newType,
        categoryId: newCategory || null,
        isPrivate: newPrivate,
      });
      setNewName('');
      await refresh();
      toast.success('Channel created', newName.trim());
    } catch (cause) {
      toast.error('Could not create channel', errorText(cause, 'Try another name.'));
    } finally {
      setBusy(false);
    }
  };

  const patchChannel = async (channel: ServerChannel, input: { name?: string; isPrivate?: boolean; readOnly?: boolean }) => {
    try {
      await serverApi.updateChannel(serverId, channel.id, input);
      await refresh();
    } catch (cause) {
      toast.error('Could not update channel', errorText(cause, 'Try again.'));
    }
  };

  const removeChannel = async (channel: ServerChannel) => {
    if (!window.confirm(`Delete #${channel.name}? Its messages are removed for everyone.`)) return;
    try {
      await serverApi.deleteChannel(serverId, channel.id);
      await refresh();
      toast.success('Channel deleted', channel.name);
    } catch (cause) {
      toast.error('Could not delete channel', errorText(cause, 'Try again.'));
    }
  };

  return (
    <div className="stack">
      <section className="field-group">
        <h3>Create channel</h3>
        <div className="inline-form">
          <input
            value={newName}
            placeholder="channel-name"
            maxLength={40}
            onChange={(event) => setNewName(event.target.value)}
          />
          <select value={newType} onChange={(event) => setNewType(event.target.value as ChannelType)}>
            <option value="text">Text</option>
            <option value="voice">Voice</option>
          </select>
          <select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>
            <option value="">No category</option>
            {detail.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name ?? 'Unnamed'}
              </option>
            ))}
          </select>
          <label className="toggle-inline">
            <input type="checkbox" checked={newPrivate} onChange={(event) => setNewPrivate(event.target.checked)} />
            Private
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void addChannel()} disabled={busy || !newName.trim()}>
            <IconPlus size={15} /> Add
          </button>
        </div>
      </section>

      <section className="field-group">
        <h3>Create category</h3>
        <div className="inline-form">
          <input
            value={categoryName}
            placeholder="Category name"
            maxLength={40}
            onChange={(event) => setCategoryName(event.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void addCategory()} disabled={busy || !categoryName.trim()}>
            Add category
          </button>
        </div>
      </section>

      <section className="field-group">
        <h3>Channels</h3>
        <ul className="channel-admin-list">
          {channels.map((channel) => (
            <li key={channel.id}>
              <span className="channel-admin-name">
                {channel.type === 'voice' ? '🔊' : '#'} {channel.name}
                {channel.isPrivate && <IconLock size={13} />}
              </span>
              <span className="channel-admin-actions">
                <label className="toggle-inline">
                  <input
                    type="checkbox"
                    checked={channel.isPrivate}
                    onChange={(event) => void patchChannel(channel, { isPrivate: event.target.checked })}
                  />
                  Private
                </label>
                <label className="toggle-inline">
                  <input
                    type="checkbox"
                    checked={channel.readOnly}
                    onChange={(event) => void patchChannel(channel, { readOnly: event.target.checked })}
                  />
                  Read-only
                </label>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`Rename ${channel.name}`}
                  onClick={() => {
                    const name = window.prompt('New channel name', channel.name);
                    if (name && name.trim() && name.trim() !== channel.name) void patchChannel(channel, { name: name.trim() });
                  }}
                >
                  <IconUpload size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`Delete ${channel.name}`}
                  onClick={() => void removeChannel(channel)}
                >
                  <IconTrash size={15} />
                </button>
              </span>
            </li>
          ))}
          {channels.length === 0 && <li className="muted-sm">No channels yet.</li>}
        </ul>
      </section>
    </div>
  );
}

function MembersPanel({
  serverId,
  detail,
  me,
  toast,
  onChanged,
}: {
  serverId: string;
  detail: ServerDetail;
  me: User | null;
  toast: ToastApi;
  onChanged: () => Promise<void> | void;
}) {
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { members: rows } = await serverApi.members(serverId);
      setMembers(rows);
    } catch (cause) {
      toast.error('Could not load members', errorText(cause, 'Try again.'));
    } finally {
      setLoading(false);
    }
  }, [serverId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = members.filter((member) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
      member.user.username.toLowerCase().includes(needle) ||
      (member.user.displayName ?? '').toLowerCase().includes(needle) ||
      (member.nickname ?? '').toLowerCase().includes(needle)
    );
  });

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      await load();
      await onChanged();
      toast.success(label, '');
    } catch (cause) {
      toast.error(`Could not ${label.toLowerCase()}`, errorText(cause, 'Check your permissions.'));
    } finally {
      setBusy(false);
    }
  };

  const timeoutMember = async (member: ServerMember) => {
    const minutes = Number(window.prompt('Timeout length in minutes', '10') ?? '');
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    await act('Member timed out', () =>
      serverApi.timeout(serverId, member.user.id, minutes, window.prompt('Reason (optional)') ?? undefined),
    );
  };

  return (
    <div className="stack">
      <input
        className="search-field"
        value={query}
        placeholder="Search members"
        onChange={(event) => setQuery(event.target.value)}
      />
      {loading && <p className="muted-sm">Loading members…</p>}
      <ul className="member-admin-list">
        {filtered.map((member) => (
          <li key={member.user.id} className="member-admin-row">
            <button type="button" className="member-admin-main" onClick={() => setOpenId(openId === member.user.id ? null : member.user.id)}>
              <Avatar user={member.user} size="sm" showPresence />
              <span>
                <strong style={{ color: member.roles[0]?.color || undefined }}>
                  {member.nickname || member.user.displayName || member.user.username}
                </strong>
                <span className="muted-sm"> @{member.user.username}{member.isOwner ? ' · owner' : ''}</span>
              </span>
            </button>
            <span className="member-admin-roles">
              {member.roles.map((role) => (
                <span key={role.id} className="chip" style={{ borderColor: role.color || undefined, color: role.color || undefined }}>
                  {role.name}
                </span>
              ))}
              {member.timeoutUntil && <span className="chip warn">timed out</span>}
            </span>

            {openId === member.user.id && (
              <div className="member-admin-panel">
                <label className="field">
                  <span>Nickname</span>
                  <input
                    defaultValue={member.nickname ?? ''}
                    maxLength={32}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (member.nickname ?? '')) {
                        void act('Nickname updated', () =>
                          serverApi.updateMember(serverId, member.user.id, { nickname: value || null }),
                        );
                      }
                    }}
                  />
                </label>

                <fieldset className="role-picker">
                  <legend>Roles</legend>
                  {detail.roles.map((role) => {
                    const checked = member.roles.some((entry) => entry.id === role.id);
                    return (
                      <label key={role.id} className="perm-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || role.isDefault}
                          onChange={() => {
                            const ids = new Set(member.roles.map((entry) => entry.id));
                            if (checked) ids.delete(role.id);
                            else ids.add(role.id);
                            void act('Roles updated', () =>
                              serverApi.updateMember(serverId, member.user.id, { roleIds: [...ids] }),
                            );
                          }}
                        />
                        <span style={{ color: role.color || undefined }}>{role.name}</span>
                      </label>
                    );
                  })}
                </fieldset>

                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Kick ${member.user.username}? They can rejoin with an invite.`)) return;
                      void act('Member kicked', () =>
                        serverApi.kick(serverId, member.user.id, window.prompt('Reason (optional)') ?? undefined),
                      );
                    }}
                  >
                    Kick
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void timeoutMember(member)}
                  >
                    Timeout
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm danger"
                    disabled={busy || member.isOwner}
                    onClick={() => {
                      if (!window.confirm(`Ban ${member.user.username}? They will not be able to rejoin.`)) return;
                      void act('Member banned', () =>
                        serverApi.ban(serverId, member.user.id, window.prompt('Reason (optional)') ?? undefined),
                      );
                    }}
                  >
                    Ban
                  </button>
                  {detail.server.isOwner && me?.id !== member.user.id && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Transfer ownership to ${member.user.username}? You become an administrator.`)) return;
                        void act('Ownership transferred', () => serverApi.transfer(serverId, member.user.id));
                      }}
                    >
                      Make owner
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!loading && filtered.length === 0 && <p className="muted-sm">No members match that search.</p>}
    </div>
  );
}

function InvitesPanel({ serverId, toast }: { serverId: string; toast: ToastApi }) {
  const [invites, setInvites] = useState<ServerInvite[]>([]);
  const [maxUses, setMaxUses] = useState('0');
  const [expires, setExpires] = useState('24');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { invites: rows } = await serverApi.invites(serverId);
      setInvites(rows);
    } catch (cause) {
      toast.error('Could not load invites', errorText(cause, 'Try again.'));
    }
  }, [serverId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const uses = Number(maxUses) || 0;
      const hours = Number(expires) || 0;
      await serverApi.createInvite(serverId, {
        maxUses: uses > 0 ? uses : null,
        expiresInHours: hours > 0 ? hours : null,
      });
      await load();
      toast.success('Invite created', 'Share the link to bring people in.');
    } catch (cause) {
      toast.error('Could not create invite', errorText(cause, 'Check your permissions.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="field-group">
        <h3>Create invite</h3>
        <div className="inline-form">
          <label className="field-inline">
            <span>Max uses</span>
            <input type="number" min={0} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          </label>
          <label className="field-inline">
            <span>Expires (hours)</span>
            <input type="number" min={0} value={expires} onChange={(event) => setExpires(event.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void create()} disabled={busy}>
            <IconPlus size={15} /> Create
          </button>
        </div>
        <p className="muted-sm">0 means unlimited. Invites can be revoked at any time.</p>
      </section>

      <section className="field-group">
        <h3>Active invites</h3>
        <ul className="invite-admin-list">
          {invites.map((invite) => (
            <li key={invite.id}>
              <code>{invite.url}</code>
              <span className="muted-sm">
                {invite.uses}
                {invite.maxUses ? `/${invite.maxUses}` : ''} uses · expires {formatDate(invite.expiresAt)}
              </span>
              <span className="row-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(invite.url);
                      toast.success('Invite copied', invite.url);
                    } catch {
                      toast.info('Copy failed', invite.url);
                    }
                  }}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm danger"
                  onClick={async () => {
                    try {
                      await serverApi.revokeInvite(serverId, invite.id);
                      await load();
                      toast.success('Invite revoked', '');
                    } catch (cause) {
                      toast.error('Could not revoke', errorText(cause, 'Try again.'));
                    }
                  }}
                >
                  Revoke
                </button>
              </span>
            </li>
          ))}
          {invites.length === 0 && <li className="muted-sm">No active invites.</li>}
        </ul>
      </section>
    </div>
  );
}

function ModerationPanel({ serverId }: { serverId: string }) {
  const toast = useToast();
  const [entries, setEntries] = useState<ModerationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { entries: rows } = await serverApi.moderation(serverId);
        if (!cancelled) setEntries(rows);
      } catch (cause) {
        toast.error('Could not load moderation log', errorText(cause, 'Check your permissions.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId, toast]);

  return (
    <div className="stack">
      <h3>Moderation log</h3>
      {loading && <p className="muted-sm">Loading…</p>}
      <ul className="mod-log">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className={`chip ${entry.action.includes('ban') ? 'warn' : ''}`}>{entry.action}</span>
            <span>
              <strong>{entry.actorName ?? entry.actorId}</strong>
              {entry.targetName ? ` → ${entry.targetName}` : ''}
              {entry.reason ? <span className="muted-sm"> · {entry.reason}</span> : null}
            </span>
            <time className="muted-sm">{formatDate(entry.createdAt)}</time>
          </li>
        ))}
        {!loading && entries.length === 0 && <li className="muted-sm">No moderation actions recorded yet.</li>}
      </ul>
    </div>
  );
}

function DangerPanel({
  serverId,
  detail,
  onDeleted,
  onChanged,
}: {
  serverId: string;
  detail: ServerDetail;
  onDeleted: () => Promise<void> | void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack">
      <section className="field-group">
        <h3>Ownership</h3>
        <p className="muted-sm">
          Transfer ownership from the Members tab. You remain an administrator afterwards.
        </p>
      </section>

      <section className="field-group danger-zone">
        <h3>Delete community</h3>
        <p className="muted-sm">
          This permanently removes every channel, message, role and invite in <strong>{detail.server.name}</strong>.
          This cannot be undone.
        </p>
        <label className="field">
          <span>Type the community name to confirm</span>
          <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={detail.server.name} />
        </label>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || confirmName.trim() !== detail.server.name}
            onClick={async () => {
              setBusy(true);
              try {
                await serverApi.remove(serverId);
                await onDeleted();
                toast.success('Community deleted', detail.server.name);
              } catch (cause) {
                toast.error('Could not delete community', errorText(cause, 'Try again.'));
                setBusy(false);
              }
            }}
          >
            <IconTrash size={15} /> Delete permanently
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void onChanged()} disabled={busy}>
            Refresh
          </button>
        </div>
      </section>
    </div>
  );
}
