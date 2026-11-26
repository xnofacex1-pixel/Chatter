import { useEffect, useRef, useState } from 'react';
import { useCall } from '../lib/call-context';
import { callTitle, formatCallDuration, joinedParticipants } from '../lib/calls';
import {
  IconCamera,
  IconCheck,
  IconClose,
  IconHeadphones,
  IconHeadphonesOff,
  IconMic,
  IconMicOff,
  IconMonitor,
  IconPhone,
  IconSettings,
  IconUsers,
  IconWarning,
} from './icons';
import '../styles/stage4.css';

const hasVideo = (stream: MediaStream | null): boolean =>
  Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'));

function StreamVideo({
  stream,
  muted,
  className,
  mirrored,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className?: string;
  mirrored?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted={muted}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

export default function CallOverlay() {
  const calls = useCall();
  const active = calls.call;
  const incoming = calls.incoming;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    for (const element of audioRefs.current.values()) {
      const audio = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (calls.outputId && audio.setSinkId) void audio.setSinkId(calls.outputId).catch(() => undefined);
    }
  }, [calls.outputId, calls.remoteStreams]);

  if (!active) {
    if (!incoming) return null;
    return (
      <div className="call-incoming" role="dialog" aria-label="Incoming call">
        <div className="call-incoming-icon">
          <IconPhone size={20} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <strong className="truncate" style={{ display: 'block' }}>
            {callTitle(incoming)}
          </strong>
          <span className="muted small">
            {incoming.kind === 'video' ? 'Incoming video call' : 'Incoming voice call'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void calls.acceptIncoming()}
          disabled={calls.phase === 'connecting'}
        >
          <IconCheck size={14} /> {calls.phase === 'connecting' ? 'Connecting' : 'Accept'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void calls.declineIncoming()}>
          <IconClose size={14} /> Decline
        </button>
      </div>
    );
  }

  const participants = joinedParticipants(active);
  const sharer = participants.find((entry) => entry.screenOn);
  const sharedStream = sharer
    ? sharer.userId === calls.selfId
      ? calls.screenStream
      : calls.remoteStreams[sharer.userId] ?? null
    : null;
  const isHost = active.startedBy === calls.selfId;
  const peerStates = Object.values(calls.peerStates);
  const connecting =
    calls.phase === 'connecting' || peerStates.some((state) => state === 'connecting' || state === 'new');
  const reconnecting = peerStates.some((state) => state === 'disconnected' || state === 'failed');
  const micDevices = calls.devices.filter((device) => device.kind === 'audioinput');
  const outputDevices = calls.devices.filter((device) => device.kind === 'audiooutput');
  const cameraDevices = calls.devices.filter((device) => device.kind === 'videoinput');

  const goFullscreen = () => {
    const node = stageRef.current;
    if (node?.requestFullscreen) void node.requestFullscreen().catch(() => undefined);
  };

  const openPictureInPicture = async () => {
    const video = screenRef.current as
      | (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })
      | null;
    if (!video?.requestPictureInPicture) return;
    try {
      await video.requestPictureInPicture();
    } catch {
      /* browser refused (not supported for this stream) */
    }
  };

  return (
    <div className="call-overlay" role="dialog" aria-label="Chatter call">
      {Object.entries(calls.remoteStreams).map(([userId, stream]) => (
        <audio
          key={userId}
          autoPlay
          playsInline
          muted={calls.deafened}
          ref={(element) => {
            if (element) {
              element.srcObject = stream;
              audioRefs.current.set(userId, element);
            } else {
              audioRefs.current.delete(userId);
            }
          }}
        />
      ))}

      <div className="call-shell">
        <header className="call-head">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="call-title-row">
              <span className={`call-dot ${reconnecting ? 'warn' : connecting ? 'pending' : 'live'}`} />
              <h2 className="truncate">{callTitle(active)}</h2>
              <span className="call-badge">{active.kind === 'video' ? 'Video' : 'Voice'}</span>
            </div>
            <div className="call-meta">
              <span>{formatCallDuration(active.createdAt, now)}</span>
              <span aria-hidden="true">·</span>
              <span>
                <IconUsers size={12} /> {participants.length} connected
              </span>
              <span aria-hidden="true">·</span>
              <span>{reconnecting ? 'Reconnecting…' : connecting ? 'Connecting media…' : 'Connected'}</span>
            </div>
          </div>
          <button
            type="button"
            className={`icon-btn ${settingsOpen ? 'active' : ''}`}
            aria-label="Call device settings"
            title="Devices"
            onClick={() => {
              setSettingsOpen((open) => !open);
              void calls.refreshDevices();
            }}
          >
            <IconSettings size={17} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close call panel" title="Minimise" onClick={() => void calls.leave()}>
            <IconClose size={17} />
          </button>
        </header>

        {calls.error && (
          <div className="call-error" role="alert">
            <IconWarning size={15} />
            <span className="grow">{calls.error}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss error" onClick={calls.clearError}>
              <IconClose size={14} />
            </button>
          </div>
        )}

        {settingsOpen && (
          <div className="call-devices">
            <label>
              <span>Microphone</span>
              <select
                value={calls.inputId ?? ''}
                onChange={(event) => void calls.setInputDevice(event.target.value)}
                aria-label="Microphone device"
              >
                <option value="">System default</option>
                {micDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Speaker</span>
              <select
                value={calls.outputId ?? ''}
                onChange={(event) => calls.setOutputDevice(event.target.value)}
                aria-label="Speaker device"
              >
                <option value="">System default</option>
                {outputDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Camera</span>
              <select
                value={calls.cameraId ?? ''}
                onChange={(event) => void calls.setCameraDevice(event.target.value)}
                aria-label="Camera device"
              >
                <option value="">System default</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              {calls.turn
                ? 'Relay (TURN) credentials are configured, so strict networks can connect.'
                : 'Direct peer connections use public STUN. Networks with strict NAT or firewalls may need a TURN relay configured by the operator.'}
            </p>
          </div>
        )}

        {sharedStream && (
          <div className="call-stage" ref={stageRef}>
            <video
              ref={screenRef}
              autoPlay
              playsInline
              muted
              className="call-stage-video"
              // The shared screen is the stage: no mirroring, no cropping.
              style={{ background: '#05080f' }}
            />
            <div className="call-stage-bar">
              <span className="truncate">
                <IconMonitor size={14} /> {sharer?.user?.displayName ?? 'Someone'} is sharing their screen
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openPictureInPicture()}>
                  Picture in picture
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={goFullscreen}>
                  Fullscreen
                </button>
              </div>
            </div>
            <StreamVideoAttach stream={sharedStream} videoRef={screenRef} />
          </div>
        )}

        <div className={`call-grid cols-${Math.min(Math.max(participants.length, 1), 4)}`}>
          {participants.map((participant) => {
            const isMe = participant.userId === calls.selfId;
            const stream = isMe ? calls.localStream : calls.remoteStreams[participant.userId] ?? null;
            const showVideo = isMe ? calls.videoOn && hasVideo(stream) : participant.videoOn && hasVideo(stream);
            return (
              <div
                key={participant.userId}
                className={`call-tile ${calls.speaking[participant.userId] ? 'speaking' : ''}`}
              >
                {showVideo && stream ? (
                  <StreamVideo stream={stream} muted={isMe} className="call-tile-video" mirrored={isMe} />
                ) : (
                  <div className="call-tile-avatar">
                    {(participant.user?.displayName ?? 'Member').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="call-tile-name">
                  <span className="truncate">
                    {participant.user?.displayName ?? 'Member'}
                    {isMe ? ' (you)' : ''}
                  </span>
                  <span className="call-tile-icons">
                    {participant.micMuted ? <IconMicOff size={13} /> : <IconMic size={13} />}
                    {participant.screenOn && <IconMonitor size={13} />}
                  </span>
                </div>
              </div>
            );
          })}
          {participants.length === 1 && (
            <div className="call-waiting">
              <IconHeadphones size={18} />
              <span>Waiting for others to join…</span>
            </div>
          )}
        </div>

        <div className="call-controls">
          <button
            type="button"
            className={`call-btn ${calls.micMuted ? 'off' : ''}`}
            aria-label={calls.micMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={calls.micMuted}
            onClick={() => void calls.toggleMic()}
          >
            {calls.micMuted ? <IconMicOff size={19} /> : <IconMic size={19} />}
          </button>
          <button
            type="button"
            className={`call-btn ${calls.deafened ? 'off' : ''}`}
            aria-label={calls.deafened ? 'Undeafen' : 'Deafen'}
            aria-pressed={calls.deafened}
            onClick={() => void calls.toggleDeafen()}
          >
            {calls.deafened ? <IconHeadphonesOff size={19} /> : <IconHeadphones size={19} />}
          </button>
          <button
            type="button"
            className={`call-btn ${calls.videoOn ? 'on' : ''}`}
            aria-label={calls.videoOn ? 'Turn camera off' : 'Turn camera on'}
            aria-pressed={calls.videoOn}
            onClick={() => void calls.toggleVideo()}
          >
            <IconCamera size={19} />
          </button>
          <button
            type="button"
            className={`call-btn ${calls.screenOn ? 'on' : ''}`}
            aria-label={calls.screenOn ? 'Stop sharing screen' : 'Share screen'}
            aria-pressed={calls.screenOn}
            onClick={() => void (calls.screenOn ? calls.stopShare() : calls.shareScreen())}
          >
            <IconMonitor size={19} />
          </button>
          <button type="button" className="call-btn danger" aria-label="Leave call" onClick={() => void calls.leave()}>
            <IconPhone size={19} />
          </button>
          {isHost && (
            <button type="button" className="call-btn danger wide" onClick={() => void calls.endForEveryone()}>
              End for all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Attaches a stream to a video element that is also used as the PiP target, so
 * the element identity stays stable for requestPictureInPicture().
 */
function StreamVideoAttach({
  stream,
  videoRef,
}: {
  stream: MediaStream | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream, videoRef]);
  return null;
}
