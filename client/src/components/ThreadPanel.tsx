import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Message } from '../lib/api';
import { Avatar, OwnerBadge } from './Avatar';
import { IconClose } from './icons';
import { IconSend } from './icons-extra';
import { PollCard } from './polls';

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Thread side panel: loads the replies for a root message, renders them and posts
 * new replies with threadRootId so they stay out of the main channel flow.
 */
export function ThreadPanel({
  conversationId,
  root,
  meId,
  canSend,
  onClose,
  onPosted,
  onRootChanged,
}: {
  conversationId: string;
  root: Message;
  meId: string;
  canSend: boolean;
  onClose: () => void;
  onPosted?: (reply: Message) => void;
  onRootChanged?: (root: Message) => void;
}) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.thread(conversationId, root.id);
      setReplies(data.replies);
      onRootChanged?.(data.root);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'This thread could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, root.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending || !canSend) return;
    setSending(true);
    try {
      const data = await api.sendMessage(conversationId, { body, threadRootId: root.id });
      setReplies((prev) => [...prev, data.message]);
      onPosted?.(data.message);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Your reply was not sent.');
    } finally {
      setSending(false);
    }
  };

  const vote = async (optionIds: string[]) => {
    const data = await api.votePoll(conversationId, root.id, optionIds);
    onRootChanged?.(data.message);
  };

  return (
    <aside
      className="thread-panel"
      aria-label="Thread"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(420px, 100vw)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid rgba(255,255,255,0.09)',
        background: 'var(--panel, #12161f)',
        boxShadow: '-18px 0 40px rgba(0,0,0,0.35)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>Thread</strong>
          <div className="muted small truncate">
            {root.author?.displayName || 'Unknown'} · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Close thread" onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>

      <div className="stack" style={{ gap: 10, padding: 14, overflowY: 'auto', flex: 1 }}>
        <div className="card card-pad" style={{ padding: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong>{root.author?.displayName || 'Unknown'}</strong>
            {root.author?.isOwner && <OwnerBadge compact />}
            <span className="muted small">{clock(root.createdAt)}</span>
          </div>
          {root.body && <p style={{ margin: '6px 0 0' }}>{root.body}</p>}
          {root.poll && <PollCard poll={root.poll} canVote={canSend} onVote={vote} />}
        </div>

        {loading ? (
          <p className="muted small">Loading replies…</p>
        ) : error ? (
          <div className="stack" style={{ gap: 8 }}>
            <p className="small" style={{ color: '#f87171' }}>{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : replies.length === 0 ? (
          <p className="muted small">No replies yet — start the thread.</p>
        ) : (
          replies.map((reply) => (
            <article key={reply.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: '0 0 auto' }}>
                {reply.author ? (
                  <Avatar user={reply.author} size="sm" showPresence={false} />
                ) : (
                  <div className="avatar avatar-sm">?</div>
                )}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong className="small">{reply.author?.displayName || 'Removed member'}</strong>
                  <span className="muted small">{clock(reply.createdAt)}</span>
                </div>
                <p className="small" style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>
                  {reply.deletedAt ? 'This message was deleted.' : reply.body}
                </p>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="row" style={{ gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <input
          className="input grow"
          value={draft}
          placeholder={canSend ? 'Reply in thread' : 'You cannot reply here'}
          aria-label="Reply in thread"
          disabled={!canSend || sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void submit()}
          disabled={!canSend || sending || !draft.trim()}
          aria-label="Send thread reply"
        >
          <IconSend size={14} />
        </button>
      </div>
      {meId === root.author?.id && root.threadReplyCount > 0 && (
        <div className="muted small" style={{ padding: '0 14px 12px' }}>
          Replies stay out of the main channel.
        </div>
      )}
    </aside>
  );
}
