import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './auth';
import { useRealtime } from './realtime';
import { ApiError } from './api';
import { callApi, type CallKind, type CallView } from './calls';
import { playSound } from './sounds';
import {
  MeshSession,
  createLevelMeter,
  defaultIceServers,
  turnConfigured,
  type CallSignal,
} from './webrtc';

export type CallPhase = 'idle' | 'connecting' | 'live';

export interface CallContextValue {
  call: CallView | null;
  incoming: CallView | null;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  micMuted: boolean;
  deafened: boolean;
  videoOn: boolean;
  screenOn: boolean;
  screenStream: MediaStream | null;
  speaking: Record<string, boolean>;
  peerStates: Record<string, RTCPeerConnectionState>;
  phase: CallPhase;
  error: string | null;
  supported: boolean;
  turn: boolean;
  selfId: string | null;
  devices: MediaDeviceInfo[];
  inputId: string | null;
  outputId: string | null;
  cameraId: string | null;
  clearError: () => void;
  refreshDevices: () => Promise<void>;
  start: (input: { conversationId?: string; channelId?: string; kind: CallKind }) => Promise<void>;
  join: (callId: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => Promise<void>;
  leave: () => Promise<void>;
  endForEveryone: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  shareScreen: () => Promise<void>;
  stopShare: () => Promise<void>;
  setInputDevice: (deviceId: string) => Promise<void>;
  setOutputDevice: (deviceId: string) => void;
  setCameraDevice: (deviceId: string) => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside CallProvider');
  return context;
}

const audioConstraints = (deviceId?: string | null): MediaTrackConstraints => ({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
});

const cameraConstraints = (deviceId?: string | null): MediaTrackConstraints => ({
  width: { ideal: 1280 },
  height: { ideal: 720 },
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
});

async function captureMedia(kind: CallKind, micId: string | null, cameraId: string | null): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('media_unsupported');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraints(micId),
    video: kind === 'video' ? cameraConstraints(cameraId) : false,
  });
}

function mediaErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message === 'media_unsupported') {
    return 'This browser cannot access a microphone. Chatter calls need a secure (https) connection and a supported browser.';
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Chatter needs permission to use your microphone or camera. Allow access in the browser address bar, then try again.';
  }
  if (name === 'NotFoundError') return 'No microphone or camera was found on this device.';
  if (name === 'NotReadableError') return 'Your microphone or camera is being used by another application. Close it and try again.';
  if (name === 'OverconstrainedError') return 'The selected device is no longer available. Pick another device and try again.';
  return 'Chatter could not start the call. Check your connection and try again.';
}

type ScreenCapture = (constraints?: Record<string, unknown>) => Promise<MediaStream>;

const displayCapture = (): ScreenCapture | null => {
  if (typeof navigator === 'undefined') return null;
  const media = navigator.mediaDevices as unknown as { getDisplayMedia?: ScreenCapture } | undefined;
  return media?.getDisplayMedia ? media.getDisplayMedia.bind(media) : null;
};

export function CallProvider({ children }: { children: ReactNode }) {
  const auth = useAuth() as unknown as { user?: { id: string } | null; me?: { id: string } | null };
  const selfId = auth.user?.id ?? auth.me?.id ?? null;
  const selfIdRef = useRef<string | null>(null);
  selfIdRef.current = selfId;

  const [call, setCall] = useState<CallView | null>(null);
  const [incoming, setIncoming] = useState<CallView | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [micMuted, setMicMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState<string | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);

  const callRef = useRef<CallView | null>(null);
  const sessionRef = useRef<MeshSession | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const metersRef = useRef<Map<string, () => void>>(new Map());
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const previousMicRef = useRef(false);
  const stopShareRef = useRef<() => Promise<void>>(async () => undefined);
  const joinedRef = useRef<Set<string>>(new Set());
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const reportLevel = useCallback((userId: string, level: number) => {
    setSpeaking((prev) => {
      const next = level > 0.14;
      if (prev[userId] === next) return prev;
      return { ...prev, [userId]: next };
    });
  }, []);

  const attachMeter = useCallback(
    (userId: string, stream: MediaStream | null) => {
      metersRef.current.get(userId)?.();
      metersRef.current.delete(userId);
      if (!stream) {
        setSpeaking((prev) => {
          if (!(userId in prev)) return prev;
          const next = { ...prev };
          delete next[userId];
          return next;
        });
        return;
      }
      metersRef.current.set(
        userId,
        createLevelMeter(stream, (level) => reportLevel(userId, level)),
      );
    },
    [reportLevel],
  );

  const teardown = useCallback(() => {
    for (const stop of metersRef.current.values()) stop();
    metersRef.current.clear();
    sessionRef.current?.close();
    sessionRef.current = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    cameraTrackRef.current = null;
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    callRef.current = null;
    joinedRef.current = new Set();
    setCall(null);
    setLocalStream(null);
    setRemoteStreams({});
    setSpeaking({});
    setPeerStates({});
    setPhase('idle');
    setMicMuted(false);
    setDeafened(false);
    setVideoOn(false);
    setScreenOn(false);
    setScreenStream(null);
  }, []);

  const buildSession = useCallback(
    (stream: MediaStream, callId: string) => {
      const session = new MeshSession(stream, {
        selfId: selfIdRef.current ?? '',
        iceServers: defaultIceServers(),
        sendSignal: (to, data: CallSignal) => {
          void callApi.signal(callId, to, data).catch(() => undefined);
        },
        onRemoteStream: (userId, remote) => {
          setRemoteStreams((prev) => {
            if (!remote) {
              if (!(userId in prev)) return prev;
              const next = { ...prev };
              delete next[userId];
              return next;
            }
            return { ...prev, [userId]: remote };
          });
          attachMeter(userId, remote);
        },
        onPeerState: (userId, state) => {
          setPeerStates((prev) => ({ ...prev, [userId]: state }));
        },
      });
      sessionRef.current = session;
      return session;
    },
    [attachMeter],
  );

  const enterCall = useCallback(
    (next: CallView, stream: MediaStream) => {
      callRef.current = next;
      setCall(next);
      localRef.current = stream;
      setLocalStream(stream);
      const session = sessionRef.current ?? buildSession(stream, next.id);
      session.setLocalStream(stream);
      const me = next.me;
      const muted = Boolean(me?.micMuted);
      const isDeafened = Boolean(me?.deafened);
      setMicMuted(muted);
      setDeafened(isDeafened);
      setVideoOn(Boolean(me?.videoOn));
      setScreenOn(Boolean(me?.screenOn));
      session.setAudioEnabled(!muted && !isDeafened);
      cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
      joinedRef.current = new Set(
        next.participants.filter((entry) => entry.state === 'joined').map((entry) => entry.userId),
      );
      setPhase('live');
      // The join cue only fires once media capture and the call entry succeeded.
      playSound(next.channelId ? 'voiceJoin' : 'callConnect');
    },
    [buildSession],
  );

  const start = useCallback(
    async (input: { conversationId?: string; channelId?: string; kind: CallKind }) => {
      if (!selfId) return;
      setError(null);
      setPhase('connecting');
      let stream: MediaStream | null = null;
      try {
        stream = await captureMedia(input.kind, inputId, cameraId);
        const { call: created } = await callApi.start(input);
        enterCall(created, stream);
        if (created.status === 'ringing') playSound('callOutgoing');
        void refreshDevicesInternal();
      } catch (caught) {
        stream?.getTracks().forEach((track) => track.stop());
        setPhase('idle');
        setError(mediaErrorMessage(caught));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraId, enterCall, inputId, selfId],
  );

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);
    } catch {
      /* device list is optional */
    }
  }, []);
  const refreshDevicesInternal = refreshDevices;

  const join = useCallback(
    async (callId: string) => {
      if (!selfId) return;
      setError(null);
      setPhase('connecting');
      try {
        const { call: joined } = await callApi.join(callId);
        const stream = await captureMedia(joined.kind, inputId, cameraId);
        enterCall(joined, stream);
        setIncoming((prev) => (prev && prev.id === callId ? null : prev));
        const session = sessionRef.current;
        if (session) {
          const others = joined.participants
            .filter((entry) => entry.state === 'joined' && entry.userId !== selfId)
            .map((entry) => entry.userId);
          await Promise.all(others.map((userId) => session.offerTo(userId)));
        }
        void refreshDevices();
      } catch (caught) {
        setError(mediaErrorMessage(caught));
        // Never leave a call entry behind when local media could not start.
        await callApi.leave(callId).catch(() => undefined);
        teardown();
      }
    },
    [cameraId, enterCall, inputId, refreshDevices, selfId, teardown],
  );

  const leave = useCallback(async () => {
    const current = callRef.current;
    playSound(current?.channelId ? 'voiceLeave' : 'callEnded');
    teardown();
    if (current) await callApi.leave(current.id).catch(() => undefined);
  }, [teardown]);

  const endForEveryone = useCallback(async () => {
    const current = callRef.current;
    playSound('callEnded');
    teardown();
    if (current) await callApi.end(current.id).catch(() => undefined);
  }, [teardown]);

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    playSound('callAccepted');
    await join(incoming.id);
  }, [incoming, join]);

  const declineIncoming = useCallback(async () => {
    const current = incoming;
    playSound('callDeclined');
    setIncoming(null);
    if (current) await callApi.leave(current.id).catch(() => undefined);
  }, [incoming]);

  const toggleMic = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    const next = !micMuted;
    setMicMuted(next);
    playSound(next ? 'micMute' : 'micUnmute');
    sessionRef.current?.setAudioEnabled(!next && !deafened);
    await callApi.setState(current.id, { micMuted: next }).catch(() => undefined);
  }, [deafened, micMuted]);

  const toggleDeafen = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    const next = !deafened;
    setDeafened(next);
    playSound(next ? 'micMute' : 'micUnmute');
    let mic = micMuted;
    if (next) {
      previousMicRef.current = micMuted;
      mic = true;
      setMicMuted(true);
    } else {
      mic = previousMicRef.current;
      setMicMuted(mic);
    }
    sessionRef.current?.setAudioEnabled(!next && !mic);
    await callApi.setState(current.id, { deafened: next, micMuted: mic }).catch(() => undefined);
  }, [deafened, micMuted]);

  const toggleVideo = useCallback(async () => {
    const current = callRef.current;
    const stream = localRef.current;
    if (!current || !stream) return;
    if (screenOn) {
      setError('Stop sharing your screen before switching to your camera.');
      return;
    }
    if (videoOn) {
      const track = stream.getVideoTracks()[0] ?? cameraTrackRef.current;
      cameraTrackRef.current = null;
      track?.stop();
      if (track) stream.removeTrack(track);
      await sessionRef.current?.useVideoTrack(null);
      setVideoOn(false);
      playSound('cameraOff');
      await callApi.setState(current.id, { videoOn: false }).catch(() => undefined);
      return;
    }
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(cameraId) });
      const track = captured.getVideoTracks()[0];
      if (!track) return;
      cameraTrackRef.current = track;
      stream.addTrack(track);
      await sessionRef.current?.useVideoTrack(track);
      setVideoOn(true);
      playSound('cameraOn');
      await callApi.setState(current.id, { videoOn: true }).catch(() => undefined);
    } catch (caught) {
      setError(mediaErrorMessage(caught));
    }
  }, [cameraId, screenOn, videoOn]);

  const stopShare = useCallback(async () => {
    const current = callRef.current;
    const track = screenTrackRef.current;
    screenTrackRef.current = null;
    track?.stop();
    setScreenOn(false);
    setScreenStream(null);
    playSound('screenShareStop');
    await sessionRef.current?.useVideoTrack(cameraTrackRef.current);
    if (current) await callApi.setState(current.id, { screenOn: false }).catch(() => undefined);
  }, []);
  stopShareRef.current = stopShare;

  const shareScreen = useCallback(async () => {
    const current = callRef.current;
    if (!current || !localRef.current) return;
    const capture = displayCapture();
    if (!capture) {
      setError('This browser does not support screen sharing. Chrome, Edge and desktop Safari do.');
      return;
    }
    try {
      const captured = await capture({ video: { frameRate: { ideal: 30 } }, audio: false });
      const track = captured.getVideoTracks()[0];
      if (!track) return;
      screenTrackRef.current = track;
      setScreenStream(captured);
      track.addEventListener('ended', () => {
        void stopShareRef.current();
      });
      await sessionRef.current?.useVideoTrack(track);
      setScreenOn(true);
      playSound('screenShareStart');
      await callApi.setState(current.id, { screenOn: true }).catch(() => undefined);
    } catch (caught) {
      const name = (caught as { name?: string } | null)?.name;
      setError(
        name === 'NotAllowedError' || name === 'AbortError'
          ? 'Screen sharing was cancelled or blocked. Choose a screen or window to share.'
          : mediaErrorMessage(caught),
      );
    }
  }, []);

  const setInputDevice = useCallback(
    async (deviceId: string) => {
      setInputId(deviceId);
      const stream = localRef.current;
      if (!stream) return;
      try {
        const captured = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
        const track = captured.getAudioTracks()[0];
        if (!track) return;
        const previous = stream.getAudioTracks()[0];
        if (previous) {
          stream.removeTrack(previous);
          previous.stop();
        }
        stream.addTrack(track);
        track.enabled = !micMuted && !deafened;
        await sessionRef.current?.useAudioTrack(track);
      } catch (caught) {
        setError(mediaErrorMessage(caught));
      }
    },
    [deafened, micMuted],
  );

  const setOutputDevice = useCallback((deviceId: string) => {
    setOutputId(deviceId);
  }, []);

  const setCameraDevice = useCallback(
    async (deviceId: string) => {
      setCameraId(deviceId);
      if (!videoOn) return;
      const stream = localRef.current;
      if (!stream) return;
      try {
        const captured = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(deviceId) });
        const track = captured.getVideoTracks()[0];
        if (!track) return;
        const previous = stream.getVideoTracks()[0] ?? cameraTrackRef.current;
        if (previous) {
          stream.removeTrack(previous);
          previous.stop();
        }
        stream.addTrack(track);
        cameraTrackRef.current = track;
        await sessionRef.current?.useVideoTrack(track);
      } catch (caught) {
        setError(mediaErrorMessage(caught));
      }
    },
    [videoOn],
  );

  const clearError = useCallback(() => setError(null), []);

  useRealtime(
    (event, data) => {
      const payload = data as { call?: CallView; callId?: string; from?: string; data?: CallSignal };
      if (event === 'call:incoming' && payload.call) {
        if (!callRef.current) {
          setIncoming(payload.call);
          playSound('callIncoming');
        }
        return;
      }
      if (event === 'call:updated' && payload.call) {
        const next = payload.call;
        setIncoming((prev) => (prev && prev.id === next.id && next.status !== 'ringing' ? null : prev));
        if (callRef.current?.id !== next.id) return;
        if (next.status === 'ended') {
          playSound('callEnded');
          teardown();
          return;
        }
        callRef.current = next;
        setCall(next);
        const joinedNow = new Set(
          next.participants.filter((entry) => entry.state === 'joined').map((entry) => entry.userId),
        );
        const before = joinedRef.current;
        for (const userId of joinedNow) {
          if (!before.has(userId) && userId !== selfIdRef.current) {
            playSound(next.channelId ? 'voiceMemberJoin' : 'callAccepted');
          }
        }
        for (const userId of before) {
          if (!joinedNow.has(userId) && userId !== selfIdRef.current) {
            playSound(next.channelId ? 'voiceMemberLeave' : 'callEnded');
          }
        }
        joinedRef.current = joinedNow;
        const session = sessionRef.current;
        if (session) {
          const live = new Set(
            next.participants.filter((entry) => entry.state === 'joined').map((entry) => entry.userId),
          );
          for (const peerId of session.peerIds) {
            if (!live.has(peerId)) session.removePeer(peerId);
          }
        }
        return;
      }
      if (event === 'call:signal' && payload.callId && payload.from && payload.data) {
        if (callRef.current?.id !== payload.callId) return;
        void sessionRef.current?.handleSignal(payload.from, payload.data);
        return;
      }
      if (event === 'call:ended' && payload.callId) {
        if (callRef.current?.id === payload.callId) {
          playSound(callRef.current?.channelId ? 'voiceLeave' : 'callEnded');
          teardown();
        }
        setIncoming((prev) => (prev && prev.id === payload.callId ? null : prev));
      }
    },
    Boolean(selfId),
  );

  useEffect(() => {
    if (call) void refreshDevices();
  }, [call, refreshDevices]);

  useEffect(() => teardown, [teardown]);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      incoming,
      localStream,
      remoteStreams,
      micMuted,
      deafened,
      videoOn,
      screenOn,
      screenStream,
      speaking,
      peerStates,
      phase,
      error,
      supported,
      turn: turnConfigured(),
      selfId,
      devices,
      inputId,
      outputId,
      cameraId,
      clearError,
      refreshDevices,
      start,
      join,
      acceptIncoming,
      declineIncoming,
      leave,
      endForEveryone,
      toggleMic,
      toggleDeafen,
      toggleVideo,
      shareScreen,
      stopShare,
      setInputDevice,
      setOutputDevice,
      setCameraDevice,
    }),
    [
      call,
      incoming,
      localStream,
      remoteStreams,
      micMuted,
      deafened,
      videoOn,
      screenOn,
      screenStream,
      speaking,
      peerStates,
      phase,
      error,
      supported,
      selfId,
      devices,
      inputId,
      outputId,
      cameraId,
      clearError,
      refreshDevices,
      start,
      join,
      acceptIncoming,
      declineIncoming,
      leave,
      endForEveryone,
      toggleMic,
      toggleDeafen,
      toggleVideo,
      shareScreen,
      stopShare,
      setInputDevice,
      setOutputDevice,
      setCameraDevice,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
