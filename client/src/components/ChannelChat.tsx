import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type AttachmentUpload, type Message } from '../lib/api';
import { has, serverApi, P, type ServerChannel } from '../lib/servers';
import { Avatar, OwnerBadge } from './Avatar';
import { IconClose, IconLock, IconPin, IconTrash } from './icons';
import { IconDownload, IconEdit, IconPaperclip, IconReply, IconSend, IconSmile } from './icons-extra';
import { useToast } from './Toast';
import { PollCard, PollComposer } from './polls';
import { ThreadPanel } from './ThreadPanel';

export type ChatEvent = { seq: number; name: string; data: Record<string, unknown> };

const QUICK_REACTIONS = ['👍', '🎉', '💙', '🔥', '😂', '👀'];
const EMOJI = [...QUICK_REACTIONS, '🙌', '✨', '🚀', '✅', '😅', '🤝', '😮', '🥳', '💯'];
const PAGE_SIZE = 40;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const fullStamp = (iso: string) => new Date(iso).toLocaleString();
const bytes = (size: number) => (size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`);

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function AttachmentView({ attachment }: { attachment: AttachmentUpload }) {
  if (attachment.kind === 'image') {
    return (
      <a className="chat-img" href={attachment.url} target="_blank" rel="noreferrer noopener">
        <img src={attachment.url} alt="Shared image" loading="lazy" />
      </a>
    );
  }
  if (attachment.kind === 'video') {
    return (
      <video className="chat-video" src={attachment.url} controls preload="metadata" />
    );
  }
  return (
    <a className="chat-file" href={attachment.url} target="_blank" rel="noreferrer noopener" download>
      <IconDownload size={16} />
      <span className="truncate grow">{attachment.mime || 'Attachment'}</span>
      <span className="muted small">{bytes(attachment.byteSize)}</span>
    </a>
  );
}

export function ChannelChat({
  channel,
  serverId,
  me,
  permissions,
  memberRoleName,
  event,
  onUnreadChange,
}: {
  channel: ServerChannel;
  serverId: string;
  me: { id: string; displayName: string };
  permissions: number;
  memberRoleName?: string;
  event: ChatEvent | null;
  onUnreadChange?: () => void;
}) {
  const toast = useToast();
  const conversationId = channel.conversationId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<AttachmentUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [typingNames, setTypingNames] = useState<Record<string, string>>({});
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [threadFor, setThreadFor] = useState<Message | null>(null);
  const [pollOpen, setPollOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingActive = useRef(false);
  const typingTimer = useRef<number | null>(null);
  const stickToBottom = useRef(true);

  const canSend = channel.canSend && has(permissions, P.SEND_MESSAGES);
  const canManageMessages = has(permissions, P.MANAGE_MESSAGES);
  const canPin = has(permissions, P.PIN_MESSAGES);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
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

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await api.messages(conversationId, { limit: PAGE_SIZE });
      setMessages(data.messages);
      setHasMore(data.hasMore);
      setError(null);
      await Promise.all([
        serverApi.markChannelRead(serverId, channel.id).catch(() => undefined),
        api.markRead(conversationId).catch(() => undefined),
      ]);
      onUnreadChange?.();
      window.setTimeout(() => scrollToBottom(), 40);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'This channel could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [channel.id, conversationId, onUnreadChange, scrollToBottom, serverId]);

  useEffect(() => {
    setMessages([]);
    setLoading(true);
    setDraft('');
    setAttachments([]);
    setReplyTo(null);
    setEditing(null);
    setPinned([]);
    void refresh();
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!event) return;
    const incomingId = typeof event.data.conversationId === 'string' ? event.data.conversationId : null;
    if (event.name === 'message:new' || event.name === 'message:update') {
      const message = event.data.message as Message | undefined;
      if (message && message.conversationId === conversationId) {
        upsert(message);
        if (event.name === 'message:new') {
          stickToBottom.current = true;
          window.setTimeout(() => scrollToBottom(true), 30);
          void serverApi.markChannelRead(serverId, channel.id).catch(() => undefined);
          if (event.data.message && (event.data.message as Message).author?.id !== me.id) onUnreadChange?.();
        }
      }
      return;
    }
    if (event.name === 'message:delete' && incomingId === conversationId) {
      const messageId = typeof event.data.messageId === 'string' ? event.data.messageId : null;
      if (messageId) setMessages((prev) => prev.filter((entry) => entry.id !== messageId));
      return;
    }
    if (event.name === 'typing' && incomingId === conversationId && event.data.typing) {
      const who = event.data.user as { id?: string; displayName?: string } | undefined;
      if (!who?.id || who.id === me.id) return;
      setTypingNames((prev) => ({ ...prev, [who.id as string]: who.displayName || 'Someone' }));
      window.setTimeout(() => {
        setTypingNames((prev) => {
          const next = { ...prev };
          delete next[who.id as string];
          return next;
        });
      }, 4000);
    }
  }, [event]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const sendTyping = (typing: boolean) => {
    if (!conversationId || !canSend) return;
    if (typing === typingActive.current) return;
    typingActive.current = typing;
    void api.setTyping(conversationId, typing).catch(() => undefined);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    sendTyping(true);
    typingTimer.current = window.setTimeout(() => sendTyping(false), 2200);
  };

  const loadOlder = async () => {
    if (!conversationId || messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    const oldest = messages[0];
    try {
      const data = await api.messages(conversationId, { before: oldest.createdAt, beforeId: oldest.id, limit: PAGE_SIZE });
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
    } catch {
      toast.error('Could not load older messages', 'Check your connection and try again.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      for (const file of list.slice(0, 10)) {
        const data = await api.uploadAttachment(file);
        setAttachments((prev) => [...prev, data.attachment]);
        setUploadProgress((prev) => prev + Math.round(100 / list.length));
      }
    } catch (cause) {
      toast.error('Upload failed', cause instanceof ApiError ? cause.message : 'That file could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!conversationId || sending) return;
    const body = draft.trim();
    if (!body && attachments.length === 0) return;
    if (!canSend) {
      toast.error('You cannot post here', channel.readOnly ? 'This channel is read-only.' : 'You need permission to send messages.');
      return;
    }
    setSending(true);
    try {
      if (editing) {
        const data = await api.editMessage(conversationId, editing.id, body);
        upsert(data.message);
        setEditing(null);
        setDraft('');
      } else {
        const data = await api.sendMessage(conversationId, {
          body,
          attachmentIds: attachments.map((attachment) => attachment.id),
          replyToId: replyTo?.id ?? null,
        });
        upsert(data.message);
        setDraft('');
        setAttachments([]);
        setReplyTo(null);
        stickToBottom.current = true;
        window.setTimeout(() => scrollToBottom(true), 30);
        if (channel.slowmodeSeconds > 0) setCooldown(channel.slowmodeSeconds);
      }
      sendTyping(false);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Your message was not sent.';
      toast.error('Message not sent', message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (message: Message) => {
    if (!conversationId) return;
    try {
      await api.deleteMessage(conversationId, message.id);
      setMessages((prev) => prev.filter((entry) => entry.id !== message.id));
    } catch (cause) {
      toast.error('Could not delete message', cause instanceof ApiError ? cause.message : 'Try again.');
    }
  };

  const toggleReaction = async (message: Message, emoji: string) => {
    if (!conversationId) return;
    setEmojiFor(null);
    try {
      const data = await api.reactToMessage(conversationId, message.id, emoji);
      upsert(data.message);
    } catch (cause) {
      toast.error('Reaction failed', cause instanceof ApiError ? cause.message : 'Try again.');
    }
  };

  const togglePin = async (message: Message) => {
    if (!conversationId) return;
    try {
      await api.pinMessage(conversationId, message.id);
      const data = await api.pins(conversationId);
      setPinned(data.messages);
      toast.info(message.pinnedAt ? 'Message unpinned' : 'Message pinned', channel.name);
    } catch (cause) {
      toast.error('Pin failed', cause instanceof ApiError ? cause.message : 'Try again.');
    }
  };

  const openPins = async () => {
    if (!conversationId) return;
    setPinsOpen(true);
    try {
      const data = await api.pins(conversationId);
      setPinned(data.messages);
    } catch {
      setPinned([]);
    }
  };

  const typingLabel = useMemo(() => {
    const names = Object.values(typingNames);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
    return 'Several people are typing';
  }, [typingNames]);

  if (!conversationId) {
    return (
      <div className="chat-page">
        <div className="chat-empty">
          <IconLock size={26} />
          <p>This channel has no conversation attached yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`chat-page ${dragging ? 'dragging' : ''}`}
      onDragOver={(event_) => {
        event_.preventDefault();
        if (canSend) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event_) => {
        event_.preventDefault();
        setDragging(false);
        if (canSend && event_.dataTransfer.files.length > 0) void uploadFiles(event_.dataTransfer.files);
      }}
    >
      <div className="channel-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="channel-hash">#</span>
            <h1 className="truncate" style={{ fontSize: '1rem', margin: 0 }}>{channel.name}</h1>
            {channel.isPrivate && <span className="pill pill-lock"><IconLock size={11} /> Private</span>}
            {channel.readOnly && <span className="pill">Read-only</span>}
            {channel.slowmodeSeconds > 0 && <span className="pill">Slowmode {channel.slowmodeSeconds}s</span>}
          </div>
          {channel.topic && <div className="head-sub truncate">{channel.topic}</div>}
        </div>
        <button type="button" className="icon-btn" aria-label="Pinned messages" onClick={openPins} title="Pinned messages">
          <IconPin size={17} />
        </button>
      </div>

      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {loading ? (
          <div className="stack" style={{ padding: 16 }}>
            {[0, 1, 2, 3, 4].map((key) => (
              <div key={key} className="row" style={{ gap: 10 }}>
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 12 }} />
                <div className="skeleton" style={{ height: 12, flex: 1 }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="chat-empty">
            <p>{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="channel-intro">
              <div className="channel-intro-icon">#</div>
              <h2>Welcome to #{channel.name}</h2>
              <p className="muted">
                This is the start of the #{channel.name} channel{memberRoleName ? ` in your community` : ''}.
              </p>
            </div>
            {hasMore && (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {messages.length === 0 && <p className="muted small" style={{ textAlign: 'center', padding: 12 }}>No messages yet — say hello.</p>}
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
              const grouped =
                previous &&
                !newDay &&
                previous.author?.id === message.author?.id &&
                new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000;
              const mine = message.author?.id === me.id;
              const authorName = message.author?.displayName || 'Unknown';
              return (
                <div key={message.id}>
                  {newDay && <div className="day-divider"><span>{dayLabel(message.createdAt)}</span></div>}
                  <article className={`chat-msg ${grouped ? 'grouped' : ''}`}>
                    <div className="chat-msg-avatar">
                      {!grouped &&
                        (message.author ? (
                          <Avatar user={message.author} size="sm" showPresence={false} />
                        ) : (
                          <div className="avatar avatar-sm">{initials(authorName)}</div>
                        ))}
                    </div>
                    <div className="chat-msg-body">
                      {message.replyTo && (
                        <div className="chat-reply">
                          <IconReply size={12} /> {message.replyTo.authorName}: {message.replyTo.body.slice(0, 90)}
                        </div>
                      )}
                      {!grouped && (
                        <div className="chat-msg-head">
                          <span className="chat-msg-author">{authorName}</span>
                          {message.author?.isOwner && <OwnerBadge compact />}
                          <time className="chat-msg-time" title={fullStamp(message.createdAt)}>{clock(message.createdAt)}</time>
                        </div>
                      )}
                      {message.deletedAt ? (
                        <p className="chat-msg-text muted"><em>This message was deleted.</em></p>
                      ) : (
                        <>
                          {message.body && <p className="chat-msg-text">{message.body}</p>}
                          {message.attachments.length > 0 && (
                            <div className="chat-attachments">
                              {message.attachments.map((attachment) => (
                                <AttachmentView key={attachment.id} attachment={attachment} />
                              ))}
                            </div>
                          )}
                          {message.poll && (
                            <PollCard
                              poll={message.poll}
                              canVote={canSend}
                              onVote={async (optionIds) => {
                                const data = await api.votePoll(conversationId, message.id, optionIds);
                                upsert(data.message);
                              }}
                            />
                          )}
                          {message.editedAt && <span className="chat-msg-edited">edited</span>}
                        </>
                      )}
                      {message.reactions.length > 0 && (
                        <div className="chat-reactions">
                          {message.reactions.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              type="button"
                              className="chat-reaction"
                              data-me={reaction.me || undefined}
                              aria-pressed={reaction.me}
                              aria-label={`React with ${reaction.emoji}, ${reaction.count} reactions`}
                              onClick={() => void toggleReaction(message, reaction.emoji)}
                            >
                              {reaction.emoji} {reaction.count}
                            </button>
                          ))}
                        </div>
                      )}
                      {(message.threadReplyCount > 0 || canSend) && (
                        <div className="chat-reactions">
                          <button
                            type="button"
                            className="chat-reaction"
                            onClick={() => setThreadFor(message)}
                            aria-label={
                              message.threadReplyCount > 0
                                ? `Open thread, ${message.threadReplyCount} replies`
                                : 'Start a thread'
                            }
                          >
                            Thread{message.threadReplyCount > 0 ? ` · ${message.threadReplyCount}` : ''}
                          </button>
                        </div>
                      )}
                      {emojiFor === message.id && (
                        <div className="emoji-pop">
                          {EMOJI.map((emoji) => (
                            <button key={emoji} type="button" onClick={() => void toggleReaction(message, emoji)} aria-label={`React with ${emoji}`}>
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!message.deletedAt && (
                      <div className="chat-msg-actions">
                        <button type="button" className="chat-act" aria-label="React" onClick={() => setEmojiFor(emojiFor === message.id ? null : message.id)}>
                          <IconSmile size={14} />
                        </button>
                        {canSend && (
                          <button type="button" className="chat-act" aria-label="Reply" onClick={() => { setReplyTo(message); setEditing(null); }}>
                            <IconReply size={14} />
                          </button>
                        )}
                        {mine && !message.deletedAt && (
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
                            <IconEdit size={14} />
                          </button>
                        )}
                        {(mine || canManageMessages) && (
                          <button type="button" className="chat-act" aria-label="Delete message" onClick={() => void remove(message)}>
                            <IconTrash size={14} />
                          </button>
                        )}
                        {canPin && (
                          <button type="button" className="chat-act" aria-label="Pin message" onClick={() => void togglePin(message)}>
                            <IconPin size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {typingLabel && (
        <div className="chat-typing">
          <span className="chat-typing-dots"><span /><span /><span /></span> {typingLabel}
        </div>
      )}

      <div className="composer">
        {(replyTo || editing) && (
          <div className="composer-context">
            <span className="truncate">
              {editing ? 'Editing message' : `Replying to ${replyTo?.author?.displayName || 'message'}`}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={editing ? 'Cancel edit' : 'Cancel reply'}
              onClick={() => {
                if (editing) setDraft('');
                setEditing(null);
                setReplyTo(null);
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-files">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="composer-file">
                {attachment.mime}
                <button type="button" aria-label="Remove attachment" onClick={() => setAttachments((prev) => prev.filter((entry) => entry.id !== attachment.id))}>
                  <IconClose size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event_) => {
              if (event_.target.files) void uploadFiles(event_.target.files);
              event_.target.value = '';
            }}
          />
          <button type="button" className="icon-btn" aria-label="Attach a file" disabled={!canSend || uploading} onClick={() => fileRef.current?.click()}>
            <IconPaperclip size={18} />
          </button>
          <textarea
            className="composer-input"
            rows={1}
            value={draft}
            disabled={!canSend && !editing}
            placeholder={
              canSend
                ? `Message #${channel.name}`
                : channel.readOnly
                  ? `#${channel.name} is read-only`
                  : 'You do not have permission to send messages here'
            }
            aria-label={`Message ${channel.name}`}
            onChange={(event_) => onDraftChange(event_.target.value)}
            onKeyDown={(event_) => {
              if (event_.key === 'Enter' && !event_.shiftKey) {
                event_.preventDefault();
                void submit();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void submit()}
            disabled={sending || cooldown > 0 || (!draft.trim() && attachments.length === 0)}
          >
            <IconSend size={15} /> {cooldown > 0 ? `${cooldown}s` : 'Send'}
          </button>
        </div>
        {uploading && (
          <div className="composer-context">
            <span>Uploading… {uploadProgress}%</span>
          </div>
        )}
        {cooldown > 0 && <div className="composer-context"><span>Slowmode — wait {cooldown}s before the next message.</span></div>}
      </div>

      {pinsOpen && (
        <div className="modal-scrim" onClick={() => setPinsOpen(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(event_) => event_.stopPropagation()} role="dialog" aria-label="Pinned messages">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Pinned messages</h2>
              <button type="button" className="icon-btn" aria-label="Close pinned messages" onClick={() => setPinsOpen(false)}>
                <IconClose size={16} />
              </button>
            </div>
            {pinned.length === 0 ? (
              <p className="muted small">No pinned messages in #{channel.name} yet.</p>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {pinned.map((message) => (
                  <div key={message.id} className="card card-pad" style={{ padding: 12 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <strong>{message.author?.displayName || 'Unknown'}</strong>
                      <span className="muted small">{fullStamp(message.createdAt)}</span>
                    </div>
                    <p style={{ margin: '6px 0 0' }}>{message.body || '(attachment)'}</p>
                    {canPin && (
                      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => void togglePin(message)}>
                        Unpin
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {pollOpen && (
        <PollComposer
          sending={sending}
          onCancel={() => setPollOpen(false)}
          onSubmit={async (draft) => {
            setSending(true);
            try {
              const data = await api.sendMessage(conversationId, {
                poll: { question: draft.question, options: draft.options, multiple: draft.multiple },
              });
              upsert(data.message);
              setPollOpen(false);
            } catch (cause) {
              toast.error('Poll not posted', cause instanceof ApiError ? cause.message : 'Please try again.');
            } finally {
              setSending(false);
            }
          }}
        />
      )}
      {threadFor && (
        <ThreadPanel
          conversationId={conversationId}
          root={threadFor}
          meId={me.id}
          canSend={canSend}
          onClose={() => setThreadFor(null)}
          onRootChanged={(updated) => {
            upsert(updated);
            setThreadFor(updated);
          }}
        />
      )}
      {dragging && <div className="drop-hint">Drop files to upload</div>}
    </div>
  );
}
