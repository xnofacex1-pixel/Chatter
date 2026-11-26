import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, DefaultSidebar } from '../components/AppShell';
import { EmptyState } from '../components/LoadingScreen';
import { IconClose, IconPlus, IconSend, IconSparkle, IconTrash } from '../components/icons';
import { useToast } from '../components/Toast';
import { api, ApiError, type AiConversation, type AiMessage, type AiStatus } from '../lib/api';
import { relativeTime } from '../lib/format';

type ChatBubble = AiMessage & { pending?: boolean };

function apiBase() {
  return '';
}

async function streamReply(
  conversationId: string,
  content: string,
  handlers: {
    onStart: () => void;
    onDelta: (text: string) => void;
    onDone: (message: AiMessage) => void;
    onError: (message: string) => void;
  },
) {
  const res = await fetch(`${apiBase()}/api/ai/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content }),
  });

  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const payload = await res.json().catch(() => null);
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      'Chatter AI could not answer right now. Please try again.';
    throw new Error(message);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('This browser cannot read streamed replies.');

  const decoder = new TextDecoder();
  let buffer = '';
  let started = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const chunk = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
      if (!chunk.startsWith('data:')) continue;
      const raw = chunk.slice(5).trim();
      if (!raw) continue;
      let event: { type: string; text?: string; message?: AiMessage; message_text?: string };
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }
      if (event.type === 'start' && !started) {
        started = true;
        handlers.onStart();
      } else if (event.type === 'delta' && event.text) {
        handlers.onDelta(event.text);
      } else if (event.type === 'done' && event.message) {
        handlers.onDone(event.message);
      } else if (event.type === 'error') {
        handlers.onError(String((event as { message?: unknown }).message ?? 'Chatter AI stopped responding.'));
      }
    }
  }
}

export default function Ai() {
  const toast = useToast();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  const loadConversations = useCallback(async () => {
    const data = await api.ai.conversations();
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusData, list] = await Promise.all([api.ai.status(), api.ai.conversations()]);
        if (cancelled) return;
        setStatus(statusData);
        setConversations(list.conversations);
        if (list.conversations.length > 0) {
          setActiveId(list.conversations[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Chatter AI is unavailable right now.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    api.ai
      .conversation(activeId)
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages.map((message) => ({ ...message })));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'That conversation could not be opened.');
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streamingText]);

  async function startConversation() {
    try {
      const data = await api.ai.createConversation();
      setConversations((current) => [data.conversation, ...current]);
      setActiveId(data.conversation.id);
      setMessages([]);
      setError(null);
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Could not start a new chat.', 'error');
    }
  }

  async function removeConversation(id: string) {
    try {
      await api.ai.deleteConversation(id);
      setConversations((current) => {
        const next = current.filter((conversation) => conversation.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Could not delete that chat.', 'error');
    }
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    if (!status?.configured) {
      setError('Chatter AI is not configured yet. Add GROQ_API_KEY in Settings → Environment variables.');
      return;
    }
    let conversationId = activeId;
    try {
      if (!conversationId) {
        const created = await api.ai.createConversation();
        conversationId = created.conversation.id;
        setConversations((current) => [created.conversation, ...current]);
        setActiveId(created.conversation.id);
      }
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Could not start a new chat.', 'error');
      return;
    }

    setDraft('');
    setError(null);
    setSending(true);
    setStreamingText('');
    const optimistic: ChatBubble = {
      id: `local-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      await streamReply(conversationId, content, {
        onStart: () => setStreamingText(''),
        onDelta: (text) => setStreamingText((current) => current + text),
        onDone: (message) => {
          setMessages((current) => [...current, message]);
          setStreamingText('');
          void loadConversations();
        },
        onError: (message) => setError(message),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chatter AI could not answer right now.');
    } finally {
      setSending(false);
      setStreamingText('');
    }
  }

  return (
    <AppShell
      title="Chatter AI"
      subtitle="Private AI conversations powered by Groq"
      sidebar={<DefaultSidebar active="ai" />}
    >
      <div className="ai-layout">
        <aside className="ai-side" aria-label="AI conversations">
          <button type="button" className="btn btn-primary ai-new" onClick={startConversation}>
            <IconPlus size={15} /> New chat
          </button>
          <div className="ai-side-list">
            {conversations.length === 0 && !loading ? (
              <p className="tiny muted" style={{ padding: '10px 12px' }}>
                No AI conversations yet.
              </p>
            ) : (
              conversations.map((conversation) => (
                <div key={conversation.id} className="ai-side-row" data-active={conversation.id === activeId}>
                  <button type="button" className="ai-side-main" onClick={() => setActiveId(conversation.id)}>
                    <span className="truncate ai-side-title">{conversation.title}</span>
                    <span className="tiny muted truncate">
                      {conversation.preview ?? 'Empty conversation'} · {relativeTime(conversation.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => removeConversation(conversation.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="ai-main">
          <header className="ai-head">
            <div className="row" style={{ gap: 10 }}>
              <span className="ai-orb" aria-hidden="true">
                <IconSparkle size={16} />
              </span>
              <div>
                <div className="ai-title">{active?.title ?? 'New Chatter AI chat'}</div>
                <div className="tiny muted">
                  {status ? `${status.provider} · ${status.model}` : 'Checking provider…'}
                  {status && !status.configured ? ' · not configured' : ''}
                </div>
              </div>
            </div>
          </header>

          {status && !status.configured && (
            <div className="notice" data-kind="warning" role="status" style={{ margin: '0 14px' }}>
              Chatter AI needs a Groq API key. Add <code>GROQ_API_KEY</code> in Settings → Environment variables (and
              optionally <code>GROQ_MODEL</code>), then redeploy. Your conversations are stored privately per account.
            </div>
          )}
          {error && (
            <div className="notice" data-kind="error" role="alert" style={{ margin: '0 14px' }}>
              <span className="grow">{error}</span>
              <button type="button" className="icon-btn" aria-label="Dismiss error" onClick={() => setError(null)}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          <div className="ai-scroll" ref={scrollRef}>
            {loading ? (
              <div className="ai-thinking">
                <span className="spinner" /> Loading conversations…
              </div>
            ) : messages.length === 0 && !streamingText ? (
              <EmptyState
                icon={<IconSparkle size={26} />}
                title="Ask Chatter AI anything"
                description="Only the messages you send here are shared with Groq. Your Chatter DMs, servers and account details are never sent automatically."
              />
            ) : (
              <div className="ai-thread">
                {messages.map((message) => (
                  <article key={message.id} className="ai-msg" data-role={message.role}>
                    <div className="ai-msg-role">{message.role === 'assistant' ? 'Chatter AI' : 'You'}</div>
                    <div className="ai-msg-body">{message.content}</div>
                  </article>
                ))}
                {streamingText && (
                  <article className="ai-msg" data-role="assistant">
                    <div className="ai-msg-role">Chatter AI</div>
                    <div className="ai-msg-body">
                      {streamingText}
                      <span className="ai-caret" aria-hidden="true" />
                    </div>
                  </article>
                )}
                {sending && !streamingText && (
                  <div className="ai-thinking">
                    <span className="spinner" /> Chatter AI is thinking…
                  </div>
                )}
              </div>
            )}
          </div>

          <form
            className="ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              className="ai-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={status?.configured === false ? 'Add a Groq API key to start chatting' : 'Message Chatter AI…'}
              rows={1}
              maxLength={status?.limits.maxContent ?? 8000}
              aria-label="Message Chatter AI"
            />
            <button type="submit" className="btn btn-primary" disabled={sending || draft.trim().length === 0}>
              <IconSend size={15} /> Send
            </button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
