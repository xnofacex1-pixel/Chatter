/**
 * WebRTC mesh used by Chatter calls.
 *
 * Each joined participant holds one RTCPeerConnection per other participant and
 * exchanges SDP/ICE through Chatter's own signalling endpoint — no third-party
 * RTC provider is involved. Audio is always negotiated; camera and screen tracks
 * are replaced on the existing video sender and renegotiated.
 */

export type CallSignal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

interface MeshOptions {
  selfId: string;
  sendSignal: (to: string, data: CallSignal) => void;
  onRemoteStream: (userId: string, stream: MediaStream | null) => void;
  onPeerState: (userId: string, state: RTCPeerConnectionState) => void;
  iceServers?: RTCIceServer[];
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Public STUN servers are free and suffice for most home networks. Symmetric
 * NATs need a TURN relay; Chatter reads optional TURN credentials from the build
 * environment so a self-hosted coturn can be added without a paid provider.
 */
export function defaultIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const url = env.VITE_TURN_URL;
  const username = env.VITE_TURN_USERNAME;
  const credential = env.VITE_TURN_CREDENTIAL;
  if (url && username && credential) servers.push({ urls: url, username, credential });
  return servers;
}

export const turnConfigured = (): boolean =>
  Boolean(env.VITE_TURN_URL && env.VITE_TURN_USERNAME && env.VITE_TURN_CREDENTIAL);

export class MeshSession {
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly remoteStreams = new Map<string, MediaStream>();
  private readonly pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private local: MediaStream;
  private closed = false;

  constructor(local: MediaStream, private readonly options: MeshOptions) {
    this.local = local;
  }

  get peerIds(): string[] {
    return [...this.peers.keys()];
  }

  setLocalStream(stream: MediaStream) {
    this.local = stream;
  }

  private streamFor(userId: string): MediaStream {
    let stream = this.remoteStreams.get(userId);
    if (!stream) {
      stream = new MediaStream();
      this.remoteStreams.set(userId, stream);
    }
    return stream;
  }

  private ensurePeer(userId: string): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? defaultIceServers(),
    });
    this.peers.set(userId, pc);

    for (const track of this.local.getTracks()) pc.addTrack(track, this.local);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.sendSignal(userId, { type: 'ice', candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      const stream = this.streamFor(userId);
      if (!stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      event.track.addEventListener('ended', () => {
        stream.removeTrack(event.track);
        this.options.onRemoteStream(userId, stream.getTracks().length > 0 ? stream : null);
      });
      this.options.onRemoteStream(userId, stream);
    };

    pc.onconnectionstatechange = () => {
      this.options.onPeerState(userId, pc.connectionState);
    };

    return pc;
  }

  /** Offer our tracks to every connected peer (used after adding a track). */
  async renegotiate(): Promise<void> {
    for (const [userId, pc] of this.peers) {
      if (this.closed || pc.signalingState !== 'stable') continue;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.options.sendSignal(userId, { type: 'offer', sdp: offer.sdp ?? '' });
      } catch {
        /* transient negotiation error; ICE restart will retry */
      }
    }
  }

  async offerTo(userId: string): Promise<void> {
    if (this.closed) return;
    const pc = this.ensurePeer(userId);
    if (pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.options.sendSignal(userId, { type: 'offer', sdp: offer.sdp ?? '' });
    } catch {
      /* ignore */
    }
  }

  async handleSignal(from: string, data: CallSignal): Promise<void> {
    if (this.closed || !from) return;
    const pc = this.ensurePeer(from);

    if (data.type === 'offer') {
      // Glare: the lexicographically larger id is "polite" and yields.
      const polite = this.options.selfId > from;
      if (pc.signalingState === 'have-local-offer') {
        if (!polite) return;
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch {
          /* older browsers */
        }
      }
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await this.flushIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.options.sendSignal(from, { type: 'answer', sdp: answer.sdp ?? '' });
      } catch {
        /* ignore malformed description */
      }
      return;
    }

    if (data.type === 'answer') {
      if (pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushIce(from, pc);
      } catch {
        /* ignore */
      }
      return;
    }

    if (data.type === 'ice') {
      if (!pc.remoteDescription) {
        const queue = this.pendingIce.get(from) ?? [];
        queue.push(data.candidate);
        this.pendingIce.set(from, queue);
        return;
      }
      try {
        await pc.addIceCandidate(data.candidate);
      } catch {
        /* candidate for a closed connection */
      }
    }
  }

  private async flushIce(userId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.pendingIce.get(userId);
    if (!queue?.length) return;
    this.pendingIce.delete(userId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* skip */
      }
    }
  }

  setAudioEnabled(enabled: boolean): void {
    for (const track of this.local.getAudioTracks()) track.enabled = enabled;
  }

  /** Swap the outgoing video track (camera, screen share, or null to stop). */
  async useVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    let added = false;
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((entry) => entry.track?.kind === 'video');
      if (track) {
        if (sender) {
          try {
            await sender.replaceTrack(track);
          } catch {
            /* ignore */
          }
        } else {
          pc.addTrack(track, this.local);
          added = true;
        }
      } else if (sender) {
        try {
          await sender.replaceTrack(null);
        } catch {
          /* ignore */
        }
      }
    }
    if (track && added) await this.renegotiate();
  }

  removePeer(userId: string): void {
    const pc = this.peers.get(userId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      this.peers.delete(userId);
    }
    this.pendingIce.delete(userId);
    if (this.remoteStreams.delete(userId)) this.options.onRemoteStream(userId, null);
  }

  close(): void {
    this.closed = true;
    for (const pc of this.peers.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    this.pendingIce.clear();
    for (const userId of [...this.remoteStreams.keys()]) {
      this.options.onRemoteStream(userId, null);
    }
    this.remoteStreams.clear();
  }
}

/** Audio level meter used for speaking indicators. */
export function createLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return () => undefined;
  const context = new AudioContextCtor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const timer = window.setInterval(() => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const value of data) sum += value * value;
    onLevel(Math.min(1, Math.sqrt(sum / data.length) / 90));
  }, 150);
  return () => {
    window.clearInterval(timer);
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    void context.close().catch(() => undefined);
  };
}
