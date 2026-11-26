import { request as apiRequest } from './api';

type RequestOptions = NonNullable<Parameters<typeof apiRequest>[1]>;

const request = <T,>(path: string, options?: RequestOptions): Promise<T> =>
  apiRequest<T>(`/api/support${path}`, options);

export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketCategory =
  | 'account'
  | 'friends'
  | 'servers'
  | 'voice'
  | 'ai'
  | 'bugs'
  | 'safety'
  | 'other';

export interface TicketAttachment {
  id: string;
  name?: string;
  mime?: string;
  byteSize?: number;
}

export interface TicketUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isStaff?: boolean;
  title: string | null;
}

export interface TicketMessage {
  id: string;
  body: string;
  internal: boolean;
  createdAt: string;
  author: TicketUser | null;
  attachments: TicketAttachment[];
}

export interface Ticket {
  id: string;
  subject: string;
  category: TicketCategory;
  categoryLabel: string;
  priority: TicketPriority;
  status: TicketStatus;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
  lastReplyAt: string | null;
  closedAt: string | null;
  unread: boolean;
  messageCount: number;
  preview: string;
  owner: TicketUser | null;
  assignee: TicketUser | null;
}

export interface SupportMeta {
  categories: { value: TicketCategory; label: string }[];
  statuses: { value: TicketStatus; label: string }[];
  priorities: TicketPriority[];
  staff: boolean;
}

export interface StaffTicketStats {
  counts: Record<TicketStatus, number>;
  unassigned: number;
  unread: number;
  total: number;
}

export interface NewTicketInput {
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  attachments?: TicketAttachment[];
}

export interface StaffTicketQuery {
  status?: TicketStatus | 'all';
  query?: string;
  assigned?: 'me' | 'unassigned' | 'all';
}

export const attachmentUrl = (id: string) => `/api/support/attachments/${id}`;

export const isImageAttachment = (attachment: TicketAttachment) =>
  (attachment.mime ?? '').startsWith('image/');

export const supportApi = {
  meta: () => request<SupportMeta>('/meta'),

  list: (status?: TicketStatus) =>
    request<{ tickets: Ticket[] }>(status ? `/?status=${status}` : '/'),

  create: (input: NewTicketInput) =>
    request<{ ticket: Ticket }>('/', { method: 'POST', body: input }),

  get: (id: string) => request<{ ticket: Ticket; messages: TicketMessage[] }>(`/${id}`),

  reply: (id: string, body: string, attachments: TicketAttachment[] = []) =>
    request<{ message: TicketMessage; ticket: Ticket }>(`/${id}/messages`, {
      method: 'POST',
      body: { body, attachments },
    }),

  reopen: (id: string) =>
    request<{ ok: boolean; ticket: Ticket }>(`/${id}/reopen`, { method: 'POST' }),

  close: (id: string) =>
    request<{ ok: boolean; ticket: Ticket }>(`/${id}/close`, { method: 'POST' }),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ attachment: TicketAttachment }>('/attachments', {
      method: 'POST',
      formData,
    });
  },

  // --- Staff / owner ---------------------------------------------------------

  staffStats: () => request<StaffTicketStats>('/staff/stats'),

  staffMembers: () => request<{ staff: TicketUser[] }>('/staff/staff'),

  staffTickets: (query: StaffTicketQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status && query.status !== 'all') params.set('status', query.status);
    if (query.query) params.set('query', query.query);
    if (query.assigned && query.assigned !== 'all') params.set('assigned', query.assigned);
    const suffix = params.toString();
    return request<{ tickets: Ticket[] }>(`/staff/tickets${suffix ? `?${suffix}` : ''}`);
  },

  staffGet: (id: string) =>
    request<{ ticket: Ticket; messages: TicketMessage[] }>(`/staff/tickets/${id}`),

  staffReply: (id: string, body: string, internal: boolean, attachments: TicketAttachment[] = []) =>
    request<{ message: TicketMessage; ticket: Ticket }>(`/staff/tickets/${id}/messages`, {
      method: 'POST',
      body: { body, internal, attachments },
    }),

  staffUpdate: (
    id: string,
    patch: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string | null },
  ) => request<{ ticket: Ticket }>(`/staff/tickets/${id}`, { method: 'PATCH', body: patch }),
};

export const TICKET_STATUS_TONE: Record<TicketStatus, string> = {
  open: 'info',
  in_progress: 'warn',
  waiting_user: 'muted',
  resolved: 'ok',
  closed: 'muted',
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_user: 'Waiting for user',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const formatTicketWhen = (iso: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
