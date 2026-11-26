import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attachmentUrl,
  formatTicketWhen,
  isImageAttachment,
  supportApi,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  type StaffTicketStats,
  type Ticket,
  type TicketAttachment,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
  type TicketUser,
} from '../lib/support';

const STATUS_ORDER: TicketStatus[] = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
const PRIORITY_ORDER: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

/**
 * Staff-side support queue rendered inside the owner console.
 *
 * Every mutation goes through /api/support/staff/*, which re-checks the caller's
 * staff permissions on the server; hiding controls here is convenience only.
 */
export default function SupportAdmin() {
  const [stats, setStats] = useState<StaffTicketStats | null>(null);
  const [staff, setStaff] = useState<TicketUser[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');
  const [assigned, setAssigned] = useState<'all' | 'me' | 'unassigned'>('all');
  const [query, setQuery] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<TicketAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    try {
      setListLoading(true);
      setListError(null);
      const [list, counters, members] = await Promise.all([
        supportApi.staffTickets({ status, query: query.trim() || undefined, assigned }),
        supportApi.staffStats(),
        supportApi.staffMembers(),
      ]);
      setTickets(list.tickets);
      setStats(counters);
      setStaff(members.staff);
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'The support queue could not be loaded.');
    } finally {
      setListLoading(false);
    }
  }, [status, query, assigned]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadThread = useCallback(async (id: string) => {
    try {
      setThreadLoading(true);
      setThreadError(null);
      const result = await supportApi.staffGet(id);
      setTicket(result.ticket);
      setMessages(result.messages);
    } catch (error) {
      setThreadError(error instanceof Error ? error.message : 'This ticket could not be opened.');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setTicket(null);
      setMessages([]);
      return;
    }
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  const openTicket = (next: Ticket) => {
    setSelectedId(next.id);
    setReply('');
    setInternal(false);
    setPendingFiles([]);
    setActionError(null);
  };

  const refreshAll = async (id: string) => {
    await Promise.all([loadThread(id), loadList()]);
  };

  const patchTicket = async (patch: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string | null }) => {
    if (!ticket) return;
    try {
      setBusy(true);
      setActionError(null);
      const result = await supportApi.staffUpdate(ticket.id, patch);
      setTicket(result.ticket);
      setTickets((rows) => rows.map((row) => (row.id === result.ticket.id ? result.ticket : row)));
      setStats(await supportApi.staffStats());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const attachFile = async (file: File) => {
    try {
      setBusy(true);
      setActionError(null);
      const result = await supportApi.upload(file);
      setPendingFiles((rows) => [...rows, result.attachment].slice(0, 5));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That file could not be uploaded.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sendReply = async () => {
    if (!ticket || (!reply.trim() && pendingFiles.length === 0)) return;
    try {
      setBusy(true);
      setActionError(null);
      await supportApi.staffReply(ticket.id, reply.trim() || '(attachment only)', internal, pendingFiles);
      setReply('');
      setPendingFiles([]);
      await refreshAll(ticket.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The reply could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: 0 };
    for (const key of STATUS_ORDER) map[key] = 0;
    for (const row of tickets) {
      map.all += 1;
      map[row.status] = (map[row.status] ?? 0) + 1;
    }
    return map;
  }, [tickets]);

  return (
    <div className="owner-panel support-admin">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>Support tickets</h3>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Replies marked internal stay invisible to members. Every action is written to the audit log.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadList()} disabled={listLoading}>
          {listLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="support-stats" style={{ marginTop: 14 }}>
        {[
          { label: 'Open', value: stats?.counts?.open ?? 0 },
          { label: 'In progress', value: stats?.counts?.in_progress ?? 0 },
          { label: 'Waiting on user', value: stats?.counts?.waiting_user ?? 0 },
          { label: 'Unassigned', value: stats?.unassigned ?? 0 },
          { label: 'Unread replies', value: stats?.unread ?? 0 },
          { label: 'Total tickets', value: stats?.total ?? 0 },
        ].map((entry) => (
          <div className="support-stat" key={entry.label}>
            <span>{entry.label}</span>
            <strong>{entry.value}</strong>
          </div>
        ))}
      </div>

      {listError && <p className="form-error">{listError}</p>}

      <div className="ticket-admin-grid">
        <div className="support-list">
          <div className="ticket-admin-controls">
            <input
              type="search"
              className="input"
              placeholder="Search subject, body or member"
              aria-label="Search support tickets"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              className="input"
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value as TicketStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {STATUS_ORDER.map((key) => (
                <option key={key} value={key}>
                  {TICKET_STATUS_LABEL[key]}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Filter by assignment"
              value={assigned}
              onChange={(event) => setAssigned(event.target.value as 'all' | 'me' | 'unassigned')}
            >
              <option value="all">Any assignee</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>

          {tickets.length === 0 && !listLoading ? (
            <div className="support-empty">
              <div className="support-empty-icon" aria-hidden="true">
                ✓
              </div>
              <strong>No tickets match these filters</strong>
              <p className="muted small">Try clearing the search or switching the status filter.</p>
            </div>
          ) : (
            <ul className="ticket-list" aria-label="Support tickets">
              {tickets.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`ticket-row ${selectedId === row.id ? 'is-active' : ''} ${row.unread ? 'is-unread' : ''}`}
                    onClick={() => openTicket(row)}
                    aria-current={selectedId === row.id ? 'true' : undefined}
                  >
                    <span className="ticket-row-top">
                      <span className="ticket-subject">{row.subject}</span>
                      <span className="ticket-when">{formatTicketWhen(row.lastReplyAt || row.createdAt)}</span>
                    </span>
                    <span className="ticket-row-meta">
                      <span className={`pill ticket-status is-${row.status}`}>{TICKET_STATUS_LABEL[row.status]}</span>
                      <span className={`pill priority-${row.priority}`}>{TICKET_PRIORITY_LABEL[row.priority]}</span>
                      {row.unread && <span className="dot-unread" aria-label="Unread replies" />}
                      <span className="muted">{row.owner?.displayName || row.owner?.username}</span>
                    </span>
                    <span className="ticket-preview muted">{row.preview || row.categoryLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="tiny muted" style={{ margin: 0, padding: '6px 12px' }}>
            {counts.all} ticket{counts.all === 1 ? '' : 's'} in view
          </p>
        </div>

        <div className="ticket-admin-thread">
          {!selectedId ? (
            <div className="support-list support-placeholder">
              <div className="support-empty-icon" aria-hidden="true">
                ☰
              </div>
              <strong>Select a ticket</strong>
              <p className="muted small">Pick a ticket from the queue to read the conversation and reply.</p>
            </div>
          ) : threadLoading && !ticket ? (
            <div className="support-list support-placeholder">
              <p className="muted small">Opening ticket…</p>
            </div>
          ) : threadError ? (
            <div className="support-list support-placeholder">
              <strong>Ticket unavailable</strong>
              <p className="muted small">{threadError}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadThread(selectedId)}>
                Try again
              </button>
            </div>
          ) : ticket ? (
            <>
              <div className="ticket-admin-toolbar">
                <label>
                  Status
                  <select
                    className="input"
                    value={ticket.status}
                    disabled={busy}
                    onChange={(event) => void patchTicket({ status: event.target.value as TicketStatus })}
                  >
                    {STATUS_ORDER.map((key) => (
                      <option key={key} value={key}>
                        {TICKET_STATUS_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    className="input"
                    value={ticket.priority}
                    disabled={busy}
                    onChange={(event) => void patchTicket({ priority: event.target.value as TicketPriority })}
                  >
                    {PRIORITY_ORDER.map((key) => (
                      <option key={key} value={key}>
                        {TICKET_PRIORITY_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Assignee
                  <select
                    className="input"
                    value={ticket.assignee?.id ?? ''}
                    disabled={busy}
                    onChange={(event) => void patchTicket({ assignedTo: event.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName || member.username}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="support-list">
                <div className="thread-head">
                  <div style={{ minWidth: 0 }}>
                    <h2>{ticket.subject}</h2>
                    <div className="thread-meta muted">
                      <span className={`pill ticket-status is-${ticket.status}`}>{ticket.statusLabel}</span>
                      <span className={`pill priority-${ticket.priority}`}>{TICKET_PRIORITY_LABEL[ticket.priority]}</span>
                      <span>{ticket.categoryLabel}</span>
                      <span>· opened {formatTicketWhen(ticket.createdAt)}</span>
                      <span>· {ticket.owner?.displayName || ticket.owner?.username}</span>
                    </div>
                  </div>
                </div>
                <div className="thread-messages">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`thread-message ${message.internal ? 'is-internal' : ''}`}
                      style={message.internal ? undefined : { alignSelf: 'flex-start' }}
                    >
                      <header className="thread-message-head">
                        <strong>{message.author?.displayName || message.author?.username || 'Chatter'}</strong>
                        {message.internal && <span className="pill pill-staff">Internal note</span>}
                        {message.author?.isStaff && !message.internal && <span className="pill pill-staff">Staff</span>}
                        <span className="muted">{formatTicketWhen(message.createdAt)}</span>
                      </header>
                      <p className="thread-message-body">{message.body}</p>
                      {message.attachments?.length > 0 && (
                        <div className="thread-attachment-grid">
                          {message.attachments.map((file) =>
                            isImageAttachment(file) ? (
                              <a
                                key={file.id}
                                className="thread-image"
                                href={attachmentUrl(file.id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img src={attachmentUrl(file.id)} alt={file.name || 'Ticket attachment'} loading="lazy" />
                              </a>
                            ) : (
                              <a
                                key={file.id}
                                className="thread-file"
                                href={attachmentUrl(file.id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {file.name || 'Attachment'}
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                <div className="thread-composer">
                  {actionError && <p className="form-error">{actionError}</p>}
                  <textarea
                    className="input"
                    placeholder={internal ? 'Internal note — only staff can read this' : 'Reply to the member…'}
                    aria-label="Reply to ticket"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                  />
                  {pendingFiles.length > 0 && (
                    <div className="ticket-attachments">
                      {pendingFiles.map((file) => (
                        <span className="ticket-attachment-chip" key={file.id}>
                          <span>{file.name || 'Attachment'}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${file.name || 'attachment'}`}
                            onClick={() => setPendingFiles((rows) => rows.filter((row) => row.id !== file.id))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="thread-composer-actions" style={{ justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="ticket-internal-toggle">
                        <input
                          type="checkbox"
                          checked={internal}
                          onChange={(event) => setInternal(event.target.checked)}
                        />
                        Internal note
                      </label>
                      <input
                        ref={fileRef}
                        type="file"
                        hidden
                        accept="image/*,video/*,.pdf,.txt,.log,.zip"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void attachFile(file);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => fileRef.current?.click()}
                        disabled={busy || pendingFiles.length >= 5}
                      >
                        Attach file
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void sendReply()}
                      disabled={busy || (!reply.trim() && pendingFiles.length === 0)}
                    >
                      {busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
