import { request, type User } from './api';
import type { CallSignal } from './webrtc';

export type CallKind = 'voice' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended';
export type ParticipantState = 'invited' | 'joined' | 'left' | 'declined';

export interface CallParticipant {
  userId: string;
  state: ParticipantState;
  micMuted: boolean;
  deafened: boolean;
  videoOn: boolean;
  screenOn: boolean;
  invitedAt: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  user: User | null;
}

export interface CallView {
  id: string;
  kind: CallKind;
  status: CallStatus;
  conversationId: string | null;
  channelId: string | null;
  serverId: string | null;
  channelName: string | null;
  conversationName: string | null;
  startedBy: string | null;
  createdAt: string;
  endedAt: string | null;
  participants: CallParticipant[];
  joinedCount: number;
  me: CallParticipant | null;
}

export interface MediaStateInput {
  micMuted?: boolean;
  deafened?: boolean;
  videoOn?: boolean;
  screenOn?: boolean;
}

/**
 * Server contract for calls. Media never leaves the browser directly: the
 * server only relays SDP/ICE between participants that it has authorised.
 */
export const callApi = {
  active: () => request<{ calls: CallView[] }>('/api/calls/active'),
  start: (input: { conversationId?: string; channelId?: string; kind: CallKind }) =>
    request<{ call: CallView }>('/api/calls/start', { method: 'POST', body: input }),
  get: (id: string) => request<{ call: CallView }>(`/api/calls/${id}`),
  join: (id: string) => request<{ call: CallView }>(`/api/calls/${id}/join`, { method: 'POST', body: {} }),
  leave: (id: string) => request<{ call: CallView }>(`/api/calls/${id}/leave`, { method: 'POST', body: {} }),
  end: (id: string) => request<{ call: CallView }>(`/api/calls/${id}/end`, { method: 'POST', body: {} }),
  signal: (id: string, to: string, data: CallSignal) =>
    request<{ ok: boolean }>(`/api/calls/${id}/signal`, { method: 'POST', body: { to, data } }),
  setState: (id: string, input: MediaStateInput) =>
    request<{ call: CallView }>(`/api/calls/${id}/state`, { method: 'PATCH', body: input }),
};

/** True when this participant is the one currently carrying media. */
export const hasMedia = (participant: CallParticipant | undefined): boolean =>
  Boolean(participant && participant.state === 'joined');

export const joinedParticipants = (call: CallView | null): CallParticipant[] =>
  (call?.participants ?? []).filter((entry) => entry.state === 'joined');

export const callTitle = (call: CallView | null): string => {
  if (!call) return 'Call';
  if (call.channelName) return call.channelName;
  if (call.conversationName) return call.conversationName;
  const others = (call.participants ?? []).filter((entry) => entry.state === 'joined' && entry.user);
  if (others.length === 1) return others[0].user?.displayName ?? others[0].user?.username ?? 'Direct call';
  if (others.length > 1) return `${others.length} people`;
  return call.kind === 'video' ? 'Video call' : 'Voice call';
};

export const formatCallDuration = (startedAt: string | null, now: number): string => {
  if (!startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
};
