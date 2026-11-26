import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '../components/AppShell';
import { useAuth } from '../lib/auth';
import {
  attachmentUrl,
  formatTicketWhen,
  isImageAttachment,
  supportApi,
  TICKET_PRIORITY_LABEL,
  type SupportMeta,
  type Ticket,
  type TicketAttachment,
  type TicketCategory,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from '../lib/support';

const STATUS_FILTERS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_user', label: 'Waiting on me' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

function StatusPill({ status, label }: { status: TicketStatus; label: string }) {
  return <span className={`pill ticket-status is-${status}`}>{label}</span>;
}

function AttachmentChips({
  items,
  onRemove,
}: {
  items: TicketAttachment[];
  onRemove?: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="ticket-attachments">
      {items.map((item) => (
        <span key={item.id} className="ticket-attachment-chip">
          <a href={attachmentUrl(item.id)} target="_blank" rel="noreferrer">
            {item.name || 'Attachment'}
          </a>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${item.name || 'attachment'}`}
              onClick={() => onRemove(item.id)}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export default function Support() {
  const { user } = useAuth();
  const [meta, setMeta] = useState<SupportMeta | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<TicketStatus | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // new ticket form
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('account');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [draftAttachments, setDraftAttachments] = useState<TicketAttachment[]>([]);

  // reply composer
  const [reply, setReply] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<TicketAttachment[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const replyUploadRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadTickets = useCallback(async () => {
    try {
      const data = await supportApi.list(filter === 'all' ? undefined : filter);
      setTickets(data.tickets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your tickets.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    supportApi
      .meta()
      .then((data) => {
        setMeta(data);
        if (data.categories[0]) setCategory(data.categories[0].value);
      })
      .catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const openTicket = useCallback(async (id: string) => {
    setActiveId(id);
    setComposing(false);
    setThreadLoading(true);
    try {
      const data = await supportApi.get(id);
      setActiveTicket(data.ticket);
      setMessages(data.messages);
      setTickets((prev) =>
        prev.map((ticket) => (ticket.id === id ? { ...ticket, unread: false } : ticket)),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that ticket.');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const upload = async (file: File, target: 'draft' | 'reply') => {
    setBusy(true);
    try {
      const data = await supportApi.upload(file);
      if (target === 'draft') setDraftAttachments((prev) => [...prev, data.attachment]);
      else setReplyAttachments((prev) => [...prev, data.attachment]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be uploaded.');
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
      if (replyUploadRef.current) replyUploadRef.current.value = '';
    }
  };

  const submitTicket = async () => {
    if (!subject.trim() || !description.trim()) {
      setError('Add a subject and a description so staff can help.');
      return;
    }
    setBusy(true);
    try {
      const data = await supportApi.create({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        attachments: draftAttachments,
      });
      setSubject('');
      setDescription('');
      setPriority('normal');
      setDraftAttachments([]);
      setComposing(false);
      await loadTickets();
      await openTicket(data.ticket.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your ticket could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!activeId || !reply.trim()) return;
    setBusy(true);
    try {
      const data = await supportApi.reply(activeId, reply.trim(), replyAttachments);
      setMessages((prev) => [...prev, data.message]);
      setActiveTicket(data.ticket);
      setReply('');
      setReplyAttachments([]);
      await loadTickets();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your reply could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (action: 'close' | 'reopen') => {
    if (!activeId) return;
    setBusy(true);
    try {
      const data = action === 'close' ? await supportApi.close(activeId) : await supportApi.reopen(activeId);
      setActiveTicket(data.ticket);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: tickets.length };
    for (const ticket of tickets) map[ticket.status] = (map[ticket.status] ?? 0) + 1;
    return map;
  }, [tickets]);

  const canReply = activeTicket ? activeTicket.status !== 'closed' : false;

  return (
    <AppShell>
      <div className="page support-page" data-tour="support-page">
        <header className="page-head support-head">
          <div>
            <h1>Support</h1>
            <p className="muted">
              Talk to the Chatter team about account issues, bugs or anything that feels wrong.
              Only you and Chatter staff can read your tickets.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}>
            New ticket
          </button>
        </header>

        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}

        <div className="support-grid">
          <aside className="support-list panel">
            <div className="support-filters">
              {STATUS_FILTERS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className={`chip${filter === entry.value ? ' is-active' : ''}`}
                  onClick={() => setFilter(entry.value)}
                >
                  {entry.label}
                  {counts[entry.value] ? <span className="chip-count">{counts[entry.value]}</span> : null}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="support-empty muted">Loading your tickets…</div>
            ) : tickets.length === 0 ? (
              <div className="support-empty">
                <span className="support-empty-icon" aria-hidden="true">
                  ✉
                </span>
                <strong>No tickets yet</strong>
                <p className="muted">
                  Open a ticket and the team will reply here. You can attach screenshots to help us
                  reproduce the problem.
                </p>
                <button type="button" className="btn btn-secondary" onClick={() => setComposing(true)}>
                  Create your first ticket
                </button>
              </div>
            ) : (
              <ul className="ticket-list">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      className={`ticket-row${activeId === ticket.id ? ' is-active' : ''}${
                        ticket.unread ? ' is-unread' : ''
                      }`}
                      onClick={() => void openTicket(ticket.id)}
                    >
                      <span className="ticket-row-top">
                        <span className="ticket-subject">{ticket.subject}</span>
                        <span className="ticket-when">{formatTicketWhen(ticket.updatedAt)}</span>
                      </span>
                      <span className="ticket-row-meta">
                        <StatusPill status={ticket.status} label={ticket.statusLabel} />
                        <span className="muted">{ticket.categoryLabel}</span>
                        {ticket.unread && <span className="dot-unread" aria-label="Unread" />}
                      </span>
                      <span className="ticket-preview muted">{ticket.preview}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="support-thread panel">
            {composing ? (
              <div className="ticket-compose">
                <h2>New support ticket</h2>
                <label className="field">
                  <span>Subject</span>
                  <input
                    value={subject}
                    maxLength={140}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Short summary of the problem"
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Category</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)}>
                      {(meta?.categories ?? []).map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
                      {(meta?.priorities ?? ['low', 'normal', 'high', 'urgent']).map((value) => (
                        <option key={value} value={value}>
                          {TICKET_PRIORITY_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>What happened?</span>
                  <textarea
                    rows={7}
                    value={description}
                    maxLength={6000}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Include what you were doing, what you expected and what happened instead."
                  />
                </label>

                <div className="ticket-upload-row">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => uploadRef.current?.click()}
                    disabled={busy || draftAttachments.length >= 5}
                  >
                    Attach files
                  </button>
                  <input
                    ref={uploadRef}
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(file, 'draft');
                    }}
                  />
                  <span className="muted">Up to 5 files, images and documents.</span>
                </div>
                <AttachmentChips
                  items={draftAttachments}
                  onRemove={(id) => setDraftAttachments((prev) => prev.filter((item) => item.id !== id))}
                />

                <div className="ticket-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setComposing(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void submitTicket()} disabled={busy}>
                    {busy ? 'Creating…' : 'Create ticket'}
                  </button>
                </div>
              </div>
            ) : !activeId || !activeTicket ? (
              <div className="support-placeholder">
                <span className="support-empty-icon" aria-hidden="true">
                  ◈
                </span>
                <h2>Select a ticket</h2>
                <p className="muted">
                  Pick a conversation on the left to read the thread, or open a new ticket to reach
                  the Chatter team.
                </p>
              </div>
            ) : (
              <>
                <header className="thread-head">
                  <div>
                    <h2>{activeTicket.subject}</h2>
                    <div className="thread-meta">
                      <StatusPill status={activeTicket.status} label={activeTicket.statusLabel} />
                      <span className="pill">{activeTicket.categoryLabel}</span>
                      <span className={`pill priority-${activeTicket.priority}`}>
                        {TICKET_PRIORITY_LABEL[activeTicket.priority]}
                      </span>
                      <span className="muted">Opened {formatTicketWhen(activeTicket.createdAt)}</span>
                    </div>
                  </div>
                  <div className="thread-head-actions">
                    {activeTicket.status === 'closed' ? (
                      <button type="button" className="btn btn-secondary" onClick={() => void changeStatus('reopen')} disabled={busy}>
                        Reopen
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost" onClick={() => void changeStatus('close')} disabled={busy}>
                        Close ticket
                      </button>
                    )}
                  </div>
                </header>

                {activeTicket.assignee && (
                  <p className="muted thread-assignee">
                    Handled by {activeTicket.assignee.displayName || activeTicket.assignee.username}
                  </p>
                )}

                <div className="thread-messages">
                  {threadLoading ? (
                    <div className="support-empty muted">Loading conversation…</div>
                  ) : (
                    messages.map((message) => {
                      const mine = message.author?.id === user?.id;
                      return (
                        <article
                          key={message.id}
                          className={`thread-message${mine ? ' is-mine' : ''}${
                            message.internal ? ' is-internal' : ''
                          }`}
                        >
                          <div className="thread-message-head">
                            <strong>
                              {message.author
                                ? message.author.displayName || message.author.username
                                : 'Chatter'}
                            </strong>
                            {message.author?.isOwner && <span className="badge-owner">OWNER</span>}
                            {!mine && !message.internal && (
                              <span className="pill pill-staff">Chatter Support</span>
                            )}
                            <span className="muted">{formatTicketWhen(message.createdAt)}</span>
                          </div>
                          <p className="thread-message-body">{message.body}</p>
                          {message.attachments.length > 0 && (
                            <div className="thread-attachment-grid">
                              {message.attachments.map((item) =>
                                isImageAttachment(item) ? (
                                  <a
                                    key={item.id}
                                    href={attachmentUrl(item.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="thread-image"
                                  >
                                    <img src={attachmentUrl(item.id)} alt={item.name || 'Ticket attachment'} />
                                  </a>
                                ) : (
                                  <a
                                    key={item.id}
                                    className="thread-file"
                                    href={attachmentUrl(item.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    ⤓ {item.name || 'Attachment'}
                                  </a>
                                ),
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {canReply ? (
                  <div className="thread-composer">
                    <textarea
                      rows={3}
                      value={reply}
                      maxLength={6000}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="Write a reply…"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendReply();
                        }
                      }}
                    />
                    <AttachmentChips
                      items={replyAttachments}
                      onRemove={(id) => setReplyAttachments((prev) => prev.filter((item) => item.id !== id))}
                    />
                    <div className="thread-composer-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => replyUploadRef.current?.click()}
                        disabled={busy || replyAttachments.length >= 5}
                      >
                        Attach
                      </button>
                      <input
                        ref={replyUploadRef}
                        type="file"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void upload(file, 'reply');
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void sendReply()}
                        disabled={busy || !reply.trim()}
                      >
                        Send reply
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="thread-closed">
                    <p className="muted">
                      This ticket is closed. Reopen it if you still need help — staff keep the full
                      history.
                    </p>
                    <button type="button" className="btn btn-secondary" onClick={() => void changeStatus('reopen')} disabled={busy}>
                      Reopen ticket
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
