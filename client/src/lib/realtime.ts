import { useEffect, useRef, useState } from 'react';

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting';

/** Events the server pushes down the authenticated SSE stream. */
export const REALTIME_EVENTS = [
  'ready',
  'presence',
  'friend:update',
  'conversation:new',
  'conversation:update',
  'conversation:removed',
  'message:new',
  'message:update',
  'message:delete',
  'read',
  'typing',
  'call:incoming',
  'call:updated',
  'call:signal',
  'call:ended',
  'notification',
] as const;

export type RealtimeHandler = (event: string, data: Record<string, unknown>) => void;

/**
 * Subscribes to /api/realtime/stream.
 *
 * Chat state always lives in SQLite and is re-fetched over REST, so this stream
 * is only a notification channel: a dropped connection costs latency, never a
 * message. EventSource reconnects on its own (the server sends retry: 3000) and
 * the handler is kept in a ref so re-renders never reopen the connection.
 */
export function useRealtime(handler: RealtimeHandler, enabled = true): RealtimeStatus {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/realtime/stream');

    const listeners = REALTIME_EVENTS.map((name) => {
      const listener = (event: MessageEvent<string>) => {
        let data: Record<string, unknown> = {};
        try {
          data = event.data ? (JSON.parse(event.data) as Record<string, unknown>) : {};
        } catch {
          return;
        }
        handlerRef.current(name, data);
      };
      source.addEventListener(name, listener as EventListener);
      return { name, listener };
    });

    source.onopen = () => setStatus('open');
    source.onerror = () => setStatus('reconnecting');

    return () => {
      for (const { name, listener } of listeners) source.removeEventListener(name, listener as EventListener);
      source.close();
    };
  }, [enabled]);

  return status;
}
