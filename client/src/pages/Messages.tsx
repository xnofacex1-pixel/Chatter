import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Avatar, OwnerBadge } from '../components/Avatar';
import { useToast } from '../components/Toast';
import {
  IconCheck,
  IconClose,
  IconMessage,
  IconPin,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUsers,
} from '../components/icons';
import {
  IconArchive,
  IconDownload,
  IconEdit,
  IconMore,
  IconPaperclip,
  IconReply,
  IconSend,
  IconSmile,
} from '../components/icons-extra';
import { useAuth } from '../lib/auth';
import {
  api,
  ApiError,
  type AttachmentUpload,
  type Conversation,
  type ConversationMember,
  type Message,
  type User,
} from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { formatDate, relativeTime } from '../lib/format';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢'];
const EMOJI = [...QUICK_REACTIONS, '🔥', '👀', '🙌', '💙', '✨', '🚀', '✅', '😅', '🤝'];

const FALLBACK_AUTHOR = {
  username: 'unknown',
  displayName: 'Removed member',
  avatarUrl: null,
  accentColor: null,
  presence: 'offline',
  isOwner: false,
} as unknown as User;

function conversationTitle(conversation: Conversation, meId: string | undefined): string {
  if (conversation.kind === 'dm') return conversation.partner?.displayName ?? 'Direct message';
  if (conversation.title) return conversation.title;
  const names = conversation.members.filter((member) => member.id !== meId).map((member) => member.displayName);
  return names.length > 0 ? names.slice(0, 3).join(', ') : 'Group conversation';
}

function previewText(conversation: Conversation): string {
  const preview = conversation.lastMessage;
  if (!preview) return conversation.kind === 'dm' ? 'No messages yet' : 'Group created';
  if (preview.deleted) return 'Message deleted';
  const body = preview.body || 'Attachment';
  return conversation.kind === 'dm' ? body : `${preview.authorName}: ${body}`;
}

export default function Messages() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user: me } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [detail, setDetail] = useState<{ conversation: Conversation; members: ConversationMember[] } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<AttachmentUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [friends, setFriends] = useState<User[] | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ message: Message; conversation: Conversation }[] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const typingActive = useRef(false);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await api.conversations();
      setConversations(data.conversations);
    } catch {
      /* The thread still works; the list retries on the next event. */
    } finally {
      setListLoading(false);
    }
  }, []);

  const upsert = useCallback((message: Message) => {
    setMessages((prev) => {
      const index = prev.findIndex((entry) => entry.id === message.id);
      if (index === -1) return [...prev, message];
      const next = [...prev];
      next[index] = message;
      return next;
    });
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setThreadError(null);
    setEditing(null);
    setReplyTo(null);
    setPending([]);
    setDraft('');
    setPinsOpen(false);
    setResults(null);
    setTyping({});

    Promise.all([api.conversation(id), api.messages(id, { limit: 40 })])
      .then(([conversationData, messageData]) => {
        if (cancelled) return;
        setDetail(conversationData);
        setMessages(messageData.messages);
        setHasMore(messageData.hasMore);
        const last = messageData.messages[messageData.messages.length - 1];
        if (last) void api.markRead(id, last.id).catch(() => {});
      })
      .catch((error) => {
        if (cancelled) return;
        setThreadError(
          error instanceof ApiError && error.status === 404
            ? 'This conversation is no longer available to you.'
            : 'Chatter could not open this conversation. Try again in a moment.',
        );
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  useRealtime((event, data) => {
    const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;

    if (event === 'message:new' || event === 'message:update') {
      const message = data.message as Message | undefined;
      if (message) {
        if (message.conversationId === id) {
          upsert(message);
          if (event === 'message:new') void api.markRead(id, message.id).catch(() => {});
        }
      }
      void refreshConversations();
      return;
    }

    if (event === 'message:delete') {
      const messageId = typeof data.messageId === 'string' ? data.messageId : null;
      if (messageId && conversationId === id) {
        setMessages((prev) => prev.filter((entry) => entry.id !== messageId));
      }
      void refreshConversations();
      return;
    }

    if (event === 'typing' && conversationId === id) {
      const who = data.user as { id?: string; displayName?: string } | undefined;
      const isTyping = Boolean(data.typing);
      if (!who?.id || who.id === me?.id) return;
      setTyping((prev) => {
        const next = { ...prev };
        if (isTyping) next[who.id as string] = who.displayName || 'Someone';
        else delete next[who.id as string];
        return next;
      });
      return;
    }

    if (event === 'conversation:new' || event === 'conversation:update' || event === 'conversation:removed') {
      void refreshConversations();
      if (conversationId === id && event === 'conversation:removed') {
        setThreadError('This conversation is no longer available to you.');
      }
      return;
    }

    if (event === 'read' || event === 'presence' || event === 'friend:update') {
      void refreshConversations();
    }
  });

  const typingNames = Object.values(typing);
  const activeTitle = detail ? conversationTitle(detail.conversation, me?.id) : 'Messages';
  const myRole = detail?.members.find((member) => member.user.id === me?.id)?.role;
  const canManageGroup = detail?.conversation.kind === 'group' && myRole === 'owner';

  const sendTyping = (isTyping: boolean) => {
    if (!id) return;
    if (isTyping === typingActive.current) return;
    typingActive.current = isTyping;
    void api.setTyping(id, isTyping).catch(() => {});
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    sendTyping(true);
    typingTimer.current = window.setTimeout(() => sendTyping(false), 2500);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    for (const file of list) {
      try {
        const { attachment } = await api.uploadAttachment(file);
        setPending((prev) => [...prev, attachment]);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : `Could not upload ${file.name}.`);
      }
    }
    setUploading(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id) return;
    const body = draft.trim();
    if (!body && pending.length === 0) return;
    setSending(true);
    try {
      if (editing) {
        if (!body) {
          toast.error('A message cannot be empty.');
          return;
        }
        const { message } = await api.editMessage(id, editing.id, body);
        upsert(message);
        setEditing(null);
        setDraft('');
      } else {
        const { message } = await api.sendMessage(id, {
          body: body || undefined,
          attachmentIds: pending.map((attachment) => attachment.id),
          replyToId: replyTo?.id ?? null,
        });
        upsert(message);
        setDraft('');
        setPending([]);
        setReplyTo(null);
      }
      sendTyping(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That message could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(event);
    }
    if (event.key === 'Escape') {
      setEditing(null);
      setReplyTo(null);
      setEmojiOpen(false);
    }
  };

  const react = async (message: Message, emoji: string) => {
    if (!id) return;
    try {
      const { message: updated } = await api.reactToMessage(id, message.id, emoji);
      upsert(updated);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That reaction did not save.');
    }
  };

  const removeMessage = async (message: Message) => {
    if (!id) return;
    if (!window.confirm('Delete this message for everyone in the conversation?')) return;
    try {
      await api.deleteMessage(id, message.id);
      setMessages((prev) => prev.filter((entry) => entry.id !== message.id));
      void refreshConversations();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That message could not be deleted.');
    }
  };

  const togglePin = async (message: Message) => {
    if (!id) return;
    try {
      const { message: updated } = await api.pinMessage(id, message.id);
      upsert(updated);
      toast.success(updated.pinnedAt ? 'Message pinned.' : 'Message unpinned.');
      if (pinsOpen) setPins((await api.pins(id)).messages);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That pin did not save.');
    }
  };

  const openPins = async () => {
    if (!id) return;
    setPinsOpen((open) => !open);
    try {
      setPins((await api.pins(id)).messages);
    } catch {
      toast.error('Pinned messages could not load.');
    }
  };

  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    try {
      const data = await api.searchMessages(query);
      setResults(data.results);
    } catch {
      toast.error('Message search is unavailable right now.');
    }
  };

  const startDm = async (user: User) => {
    try {
      const { conversation } = await api.createConversation({ kind: 'dm', userIds: [user.id] });
      setNewGroupOpen(false);
      navigate(`/messages/${conversation.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not open that conversation.');
    }
  };

  const loadFriends = async () => {
    if (friends) return;
    try {
      const data = await api.friends();
      setFriends(data.friends);
    } catch {
      setFriends([]);
    }
  };

  const createGroup = async () => {
    if (groupSelection.length === 0) {
      toast.error('Choose at least one friend for the group.');
      return;
    }
    try {
      const { conversation } = await api.createConversation({
        kind: 'group',
        userIds: groupSelection,
        title: groupName.trim() || undefined,
      });
      setNewGroupOpen(false);
      setGroupSelection([]);
      setGroupName('');
      await refreshConversations();
      navigate(`/messages/${conversation.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That group could not be created.');
    }
  };

  const addMembers = async (userId: string) => {
    if (!id) return;
    try {
      await api.addConversationMembers(id, [userId]);
      const refreshed = await api.conversation(id);
      setDetail(refreshed);
      setAddMemberOpen(false);
      toast.success('Member added to the group.');
      void refreshConversations();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That member could not be added.');
    }
  };

  const leaveGroup = async () => {
    if (!id || !detail) return;
    if (!window.confirm(`Leave ${activeTitle}? You will need a new invite to return.`)) return;
    try {
      await api.leaveConversation(id);
      await refreshConversations();
      navigate('/messages');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'You could not leave this conversation.');
    }
  };

  const setPreference = async (input: { muted?: boolean; archived?: boolean }) => {
    if (!id) return;
    try {
      const { conversation } = await api.conversationPreferences(id, input);
      setDetail((prev) => (prev ? { ...prev, conversation } : prev));
      await refreshConversations();
      setMenuOpen(false);
      if (input.archived) navigate('/messages');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That setting did not save.');
    }
  };

  const loadOlder = async () => {
    if (!id || messages.length === 0) return;
    try {
      const data = await api.messages(id, {
        before: messages[0].createdAt,
        beforeId: messages[0].id,
        limit: 40,
      });
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
    } catch {
      toast.error('Older messages could not load.');
    }
  };

  const directConversations = useMemo(
    () => conversations.filter((entry) => entry.kind === 'dm' && !entry.archived),
    [conversations],
  );
  const groupConversations = useMemo(
    () => conversations.filter((entry) => entry.kind === 'group' && !entry.archived),
    [conversations],
  );

  const sidebar = (
    <>
      <div className="sidebar-head">
        <div>
          <div className="sidebar-subtitle">Chatter</div>
          <div className="sidebar-title">Direct messages</div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Start a conversation"
          title="Start a conversation"
          onClick={() => {
            void loadFriends();
            setNewGroupOpen(true);
          }}
        >
          <IconPlus size={17} />
        </button>
      </div>
      <div className="sidebar-scroll">
        <form onSubmit={runSearch} className="search-field" style={{ marginBottom: 10 }}>
          <IconSearch size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            data-testid="message-search"
          />
        </form>

        <div className="nav-section-label">Direct</div>
        {listLoading ? (
          <div className="stack" style={{ gap: 8, padding: '4px 6px' }}>
            {[0, 1, 2].map((key) => (
              <div key={key} className="skeleton" style={{ height: 38, borderRadius: 10 }} />
            ))}
          </div>
        ) : directConversations.length === 0 ? (
          <p className="muted small" style={{ padding: '4px 8px' }}>
            No direct messages yet. Add a friend to start one.
          </p>
        ) : (
          directConversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === id}
              meId={me?.id}
            />
          ))
        )}

        <div className="nav-section-label">Groups</div>
        {groupConversations.length === 0 ? (
          <p className="muted small" style={{ padding: '4px 8px' }}>
            No group conversations yet.
          </p>
        ) : (
          groupConversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === id}
              meId={me?.id}
            />
          ))
        )}
      </div>
    </>
  );

  const membersPanel = detail ? (
    <div className="chat-members">
      <div className="chat-members-head">
        <span className="nav-section-label" style={{ padding: 0 }}>
          Members — {detail.members.length}
        </span>
        {canManageGroup && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Add group member"
            title="Add group member"
            onClick={() => {
              void loadFriends();
              setAddMemberOpen((open) => !open);
            }}
          >
            <IconPlus size={15} />
          </button>
        )}
      </div>
      {addMemberOpen && canManageGroup && (
        <div className="chat-add-member">
          {(friends ?? []).filter(
            (friend) => !detail.members.some((member) => member.user.id === friend.id),
          ).length === 0 ? (
            <p className="muted small">All of your friends are already here.</p>
          ) : (
            (friends ?? [])
              .filter((friend) => !detail.members.some((member) => member.user.id === friend.id))
              .map((friend) => (
                <button key={friend.id} type="button" className="chat-add-row" onClick={() => void addMembers(friend.id)}>
                  <Avatar user={friend} size="xs" />
                  <span className="truncate">{friend.displayName}</span>
                  <IconPlus size={13} />
                </button>
              ))
          )}
        </div>
      )}
      {detail.members.map((member) => (
        <div key={member.user.id} className="member-row">
          <Avatar user={member.user} size="sm" showPresence />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="member-name truncate" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="truncate">{member.user.displayName}</span>
              {member.user.isOwner && <OwnerBadge compact />}
            </div>
            {member.role === 'owner' && detail.conversation.kind === 'group' && (
              <span className="muted" style={{ fontSize: '0.6875rem' }}>Group owner</span>
            )}
          </div>
        </div>
      ))}
      {detail.conversation.kind === 'group' && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => void leaveGroup()}>
          Leave group
        </button>
      )}
    </div>
  ) : (
    <div className="chat-members">
      <p className="muted small">Select a conversation to see its members.</p>
    </div>
  );

  return (
    <AppShell
      title={activeTitle}
      subtitle={
        detail
          ? detail.conversation.kind === 'dm'
            ? 'Direct message'
            : `Group conversation · ${detail.members.length} members`
          : 'Private conversations'
      }
      sidebar={sidebar}
      members={membersPanel}
      headActions={
        detail ? (
          <div className="row" style={{ gap: 6, position: 'relative' }}>
            <button type="button" className="icon-btn" title="Pinned messages" aria-label="Pinned messages" onClick={() => void openPins()}>
              <IconPin size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Conversation options"
              aria-label="Conversation options"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
              data-testid="conversation-menu"
            >
              <IconMore size={16} />
            </button>
            {menuOpen && (
              <div className="chat-menu" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => void setPreference({ muted: !detail.conversation.muted })}>
                  {detail.conversation.muted ? 'Unmute conversation' : 'Mute conversation'}
                </button>
                <button type="button" onClick={() => void setPreference({ archived: true })}>
                  <IconArchive size={14} /> Archive conversation
                </button>
                {detail.conversation.kind === 'group' && (
                  <button type="button" onClick={() => void leaveGroup()}>
                    <IconTrash size={14} /> Leave group
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null
      }
    >
      <div
        className="chat-page"
        data-drag={dragActive}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
        }}
      >
        {!id ? (
          <div className="chat-empty">
            <div className="empty-icon">
              <IconMessage size={28} />
            </div>
            <h2>Your conversations live here</h2>
            <p className="muted">
              Pick a conversation on the left, or start a new one. Messages are delivered instantly and only people in the
              conversation can read them.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void loadFriends();
                setNewGroupOpen(true);
              }}
            >
              <IconPlus size={16} /> Start a conversation
            </button>
          </div>
        ) : threadError ? (
          <div className="chat-empty">
            <h2>Conversation unavailable</h2>
            <p className="muted">{threadError}</p>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/messages')}>
              Back to messages
            </button>
          </div>
        ) : (
          <>
            {results && (
              <div className="chat-search-results">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>Search results — {results.length}</strong>
                  <button type="button" className="icon-btn" aria-label="Close search results" onClick={() => setResults(null)}>
                    <IconClose size={15} />
                  </button>
                </div>
                {results.length === 0 && <p className="muted small">No messages matched that search.</p>}
                {results.map((result) => (
                  <button
                    key={result.message.id}
                    type="button"
                    className="chat-result"
                    onClick={() => {
                      setResults(null);
                      navigate(`/messages/${result.conversation.id}`);
                    }}
                  >
                    <span className="muted small">{relativeTime(result.message.createdAt)}</span>
                    <span className="truncate">
                      <strong>{result.message.author?.displayName ?? 'Removed member'}:</strong> {result.message.body}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {pinsOpen && (
              <div className="chat-pins">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>Pinned messages</strong>
                  <button type="button" className="icon-btn" aria-label="Close pins" onClick={() => setPinsOpen(false)}>
                    <IconClose size={15} />
                  </button>
                </div>
                {pins.length === 0 ? (
                  <p className="muted small">No pinned messages in this conversation.</p>
                ) : (
                  pins.map((pin) => (
                    <div key={pin.id} className="chat-result" style={{ cursor: 'default' }}>
                      <span className="truncate">
                        <strong>{pin.author?.displayName ?? 'Removed member'}:</strong> {pin.body}
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void togglePin(pin)}>
                        Unpin
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="chat-scroll" data-testid="message-thread">
              {threadLoading ? (
                <div className="stack" style={{ gap: 14, padding: 20 }}>
                  {[0, 1, 2, 3].map((key) => (
                    <div key={key} className="row" style={{ gap: 10 }}>
                      <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 10 }} />
                      <div className="skeleton" style={{ height: 12, width: `${40 + key * 8}%` }} />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {hasMore && (
                    <div style={{ textAlign: 'center', padding: '10px 0' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadOlder()}>
                        Load older messages
                      </button>
                    </div>
                  )}
                  {messages.length === 0 && (
                    <div className="chat-empty" style={{ padding: '40px 20px' }}>
                      <h2>No messages yet</h2>
                      <p className="muted">Say hello — this is the very beginning of {activeTitle}.</p>
                    </div>
                  )}
                  {messages.map((message, index) => {
                    const previous = messages[index - 1];
                    const grouped =
                      previous &&
                      previous.author?.id === message.author?.id &&
                      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000;
                    const author = message.author ?? FALLBACK_AUTHOR;
                    return (
                      <div key={message.id} className="chat-msg" data-own={message.author?.id === me?.id} data-grouped={Boolean(grouped)}>
                        <div className="chat-msg-avatar">
                          {!grouped && <Avatar user={author} size="sm" />}
                        </div>
                        <div className="chat-msg-body">
                          {!grouped && (
                            <div className="chat-msg-head">
                              <span className="chat-msg-author">{author.displayName}</span>
                              {author.isOwner && <OwnerBadge compact />}
                              <span className="chat-msg-time">
                                {formatDate(message.createdAt, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {message.editedAt && <span className="chat-msg-edited">edited</span>}
                              {message.pinnedAt && <IconPin size={12} />}
                            </div>
                          )}
                          {message.replyTo && (
                            <div className="chat-reply">
                              <IconReply size={12} /> {message.replyTo.authorName}: {message.replyTo.body.slice(0, 90)}
                            </div>
                          )}
                          {message.deletedAt ? (
                            <p className="chat-msg-text muted">
                              <em>This message was deleted.</em>
                            </p>
                          ) : (
                            message.body && <p className="chat-msg-text">{message.body}</p>
                          )}
                          {message.attachments.length > 0 && (
                            <div className="chat-attachments">
                              {message.attachments.map((attachment) =>
                                attachment.mime.startsWith('image/') ? (
                                  <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                                    <img className="chat-img" src={attachment.url} alt="Shared image" loading="lazy" />
                                  </a>
                                ) : attachment.mime.startsWith('video/') ? (
                                  <video key={attachment.id} className="chat-video" src={attachment.url} controls preload="metadata" />
                                ) : (
                                  <a key={attachment.id} className="chat-file" href={attachment.url} target="_blank" rel="noreferrer">
                                    <IconDownload size={14} />
                                    <span className="truncate">{attachment.mime.split('/')[1]?.toUpperCase() ?? 'File'}</span>
                                    <span className="muted small">{(attachment.byteSize / 1024).toFixed(0)} KB</span>
                                  </a>
                                ),
                              )}
                            </div>
                          )}
                          {message.reactions.length > 0 && (
                            <div className="chat-reactions">
                              {message.reactions.map((reaction) => (
                                <button
                                  key={reaction.emoji}
                                  type="button"
                                  className="chat-reaction"
                                  data-active={reaction.me}
                                  onClick={() => void react(message, reaction.emoji)}
                                  aria-label={`React with ${reaction.emoji}`}
                                >
                                  {reaction.emoji} {reaction.count}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="chat-msg-actions">
                            {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="chat-act"
                                aria-label={`React with ${emoji}`}
                                onClick={() => void react(message, emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="chat-act"
                              aria-label="Reply"
                              onClick={() => {
                                setReplyTo(message);
                                setEditing(null);
                              }}
                            >
                              <IconReply size={13} />
                            </button>
                            {message.author?.id === me?.id && !message.deletedAt && (
                              <button
                                type="button"
                                className="chat-act"
                                aria-label="Edit message"
                                onClick={() => {
                                  setEditing(message);
                                  setDraft(message.body);
                                  setReplyTo(null);
                                }}
                              >
                                <IconEdit size={13} />
                              </button>
                            )}
                            <button type="button" className="chat-act" aria-label="Pin message" onClick={() => void togglePin(message)}>
                              <IconPin size={13} />
                            </button>
                            {(message.author?.id === me?.id || canManageGroup) && !message.deletedAt && (
                              <button type="button" className="chat-act" aria-label="Delete message" onClick={() => void removeMessage(message)}>
                                <IconTrash size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </>
              )}
            </div>

            {typingNames.length > 0 && (
              <div className="chat-typing" data-testid="typing-indicator">
                <span className="chat-typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {typingNames.slice(0, 3).join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
              </div>
            )}

            <form className="composer" onSubmit={submit}>
              {(replyTo || editing) && (
                <div className="composer-context">
                  <span className="truncate">
                    {editing ? 'Editing your message' : `Replying to ${replyTo?.author?.displayName ?? 'member'}`}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Cancel"
                    onClick={() => {
                      setReplyTo(null);
                      setEditing(null);
                      if (editing) setDraft('');
                    }}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              )}
              {pending.length > 0 && (
                <div className="composer-files">
                  {pending.map((attachment) => (
                    <span key={attachment.id} className="composer-file">
                      <IconPaperclip size={12} />
                      <span className="truncate">{attachment.mime.split('/')[1] ?? 'file'}</span>
                      <button
                        type="button"
                        aria-label="Remove attachment"
                        onClick={() => setPending((prev) => prev.filter((entry) => entry.id !== attachment.id))}
                      >
                        <IconClose size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {emojiOpen && (
                <div className="emoji-pop">
                  {EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setDraft((value) => `${value}${emoji}`);
                        setEmojiOpen(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              <div className="composer-row">
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  multiple
                  accept="image/*,video/*,application/pdf,text/plain,application/zip"
                  onChange={(event) => {
                    if (event.target.files) void uploadFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Attach a file"
                  title="Attach a file"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  <IconPaperclip size={17} />
                </button>
                <button type="button" className="icon-btn" aria-label="Emoji picker" title="Emoji" onClick={() => setEmojiOpen((open) => !open)}>
                  <IconSmile size={17} />
                </button>
                <textarea
                  className="composer-input"
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={uploading ? 'Uploading attachment…' : `Message ${activeTitle}`}
                  rows={1}
                  maxLength={4000}
                  data-testid="composer-input"
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={sending || uploading || (!draft.trim() && pending.length === 0)}
                  data-testid="send-message"
                >
                  <IconSend size={15} /> Send
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {newGroupOpen && (
        <div className="modal-scrim" onClick={() => setNewGroupOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>New conversation</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setNewGroupOpen(false)}>
                <IconClose size={16} />
              </button>
            </div>
            <label className="field" style={{ marginTop: 14 }}>
              <span className="field-label">Group name (optional)</span>
              <input
                className="input"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Weekend crew"
                maxLength={80}
              />
            </label>
            <div className="nav-section-label">Choose friends</div>
            <div className="stack" style={{ gap: 4, maxHeight: 260, overflowY: 'auto' }}>
              {(friends ?? []).length === 0 && <p className="muted small">Add friends first, then start a group.</p>}
              {(friends ?? []).map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  className="chat-add-row"
                  data-selected={groupSelection.includes(friend.id)}
                  onClick={() => {
                    if (groupSelection.length === 0 && !groupName) void startDm(friend);
                    else
                      setGroupSelection((prev) =>
                        prev.includes(friend.id) ? prev.filter((entry) => entry !== friend.id) : [...prev, friend.id],
                      );
                  }}
                >
                  <Avatar user={friend} size="xs" showPresence />
                  <span className="truncate grow" style={{ textAlign: 'left' }}>{friend.displayName}</span>
                  {groupSelection.includes(friend.id) && <IconCheck size={14} />}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => void createGroup()} disabled={groupSelection.length === 0}>
                Create group
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setNewGroupOpen(false)}>
                Cancel
              </button>
              <span className="muted small">Pick one friend for a DM, or several for a group.</span>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ConversationRow({
  conversation,
  active,
  meId,
}: {
  conversation: Conversation;
  active: boolean;
  meId: string | undefined;
}) {
  const title = conversationTitle(conversation, meId);
  const partner = conversation.partner;
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="convo-row"
      data-active={active}
      onClick={() => navigate(`/messages/${conversation.id}`)}
    >
      {partner ? (
        <Avatar user={partner} size="sm" showPresence />
      ) : (
        <span className="convo-icon">
          <IconUsers size={15} />
        </span>
      )}
      <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
        <span className="convo-title truncate">{title}</span>
        <span className="convo-preview truncate">{previewText(conversation)}</span>
      </span>
      <span className="convo-meta">
        {conversation.unreadCount > 0 && <span className="convo-unread">{conversation.unreadCount}</span>}
        {conversation.lastMessageAt && <span className="convo-time">{relativeTime(conversation.lastMessageAt)}</span>}
        {conversation.muted && <IconCheck size={11} aria-label="Muted" />}
      </span>
    </button>
  );
}
