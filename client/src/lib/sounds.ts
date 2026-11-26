/**
 * Chatter sound engine.
 *
 * Every cue is synthesised with the Web Audio API, so no binary assets are
 * shipped, nothing is fetched from a third party and the sounds respect the
 * browser autoplay policy (the context is only created after a user gesture).
 */

export type SoundName =
  | 'callOutgoing'
  | 'callIncoming'
  | 'callAccepted'
  | 'callDeclined'
  | 'callEnded'
  | 'callConnect'
  | 'callConnectionLost'
  | 'callConnectionRestored'
  | 'voiceJoin'
  | 'voiceLeave'
  | 'voiceMemberJoin'
  | 'voiceMemberLeave'
  | 'micMute'
  | 'micUnmute'
  | 'cameraOn'
  | 'cameraOff'
  | 'screenShareStart'
  | 'screenShareStop';

export type SoundSettings = {
  enabled: boolean;
  volume: number;
  cues: Record<SoundName, boolean>;
};

export const SOUND_CUES: { name: SoundName; label: string; group: string; hint: string }[] = [
  { name: 'callOutgoing', label: 'Outgoing call ringing', group: 'Calls', hint: 'While your call is dialling' },
  { name: 'callIncoming', label: 'Incoming call ringing', group: 'Calls', hint: 'Someone is calling you' },
  { name: 'callAccepted', label: 'Call accepted', group: 'Calls', hint: 'The other side picked up' },
  { name: 'callDeclined', label: 'Call declined', group: 'Calls', hint: 'Your call was declined' },
  { name: 'callEnded', label: 'Call ended', group: 'Calls', hint: 'A call finishes' },
  { name: 'callConnect', label: 'Call connected', group: 'Calls', hint: 'Media is flowing in a direct call' },
  { name: 'callConnectionLost', label: 'Connection lost', group: 'Connection', hint: 'The call dropped offline' },
  { name: 'callConnectionRestored', label: 'Connection restored', group: 'Connection', hint: 'The call reconnected' },
  { name: 'voiceJoin', label: 'Joined voice channel', group: 'Voice channels', hint: 'Only after the room really connects' },
  { name: 'voiceLeave', label: 'Left voice channel', group: 'Voice channels', hint: 'You leave a voice room' },
  { name: 'voiceMemberJoin', label: 'Someone joined your voice channel', group: 'Voice channels', hint: 'Another member joins the room' },
  { name: 'voiceMemberLeave', label: 'Someone left your voice channel', group: 'Voice channels', hint: 'Another member leaves the room' },
  { name: 'micMute', label: 'Microphone muted', group: 'Microphone & camera', hint: 'Microphone toggled off' },
  { name: 'micUnmute', label: 'Microphone unmuted', group: 'Microphone & camera', hint: 'Microphone toggled on' },
  { name: 'cameraOn', label: 'Camera enabled', group: 'Microphone & camera', hint: 'Camera toggled on' },
  { name: 'cameraOff', label: 'Camera disabled', group: 'Microphone & camera', hint: 'Camera toggled off' },
  { name: 'screenShareStart', label: 'Screen sharing started', group: 'Microphone & camera', hint: 'You or a peer start sharing' },
  { name: 'screenShareStop', label: 'Screen sharing stopped', group: 'Microphone & camera', hint: 'Sharing ends' },
];

const STORAGE_KEY = 'chatter.sounds.v1';

type Note = { at: number; freq: number; dur: number; type?: OscillatorType; gain?: number };

const CUES: Record<SoundName, Note[]> = {
  callOutgoing: [
    { at: 0, freq: 523.25, dur: 0.16, gain: 0.2 },
    { at: 0.28, freq: 659.25, dur: 0.16, gain: 0.2 },
  ],
  callIncoming: [
    { at: 0, freq: 784, dur: 0.12, gain: 0.24 },
    { at: 0.16, freq: 1046.5, dur: 0.12, gain: 0.22 },
    { at: 0.34, freq: 784, dur: 0.12, gain: 0.24 },
    { at: 0.5, freq: 1046.5, dur: 0.16, gain: 0.22 },
  ],
  callAccepted: [
    { at: 0, freq: 659.25, dur: 0.12, gain: 0.22 },
    { at: 0.12, freq: 987.77, dur: 0.2, gain: 0.2 },
  ],
  callDeclined: [
    { at: 0, freq: 392, dur: 0.16, gain: 0.2, type: 'triangle' },
    { at: 0.18, freq: 261.63, dur: 0.24, gain: 0.18, type: 'triangle' },
  ],
  callEnded: [
    { at: 0, freq: 523.25, dur: 0.14, gain: 0.2 },
    { at: 0.15, freq: 392, dur: 0.22, gain: 0.18 },
  ],
  callConnect: [
    { at: 0, freq: 587.33, dur: 0.12, gain: 0.2 },
    { at: 0.13, freq: 880, dur: 0.22, gain: 0.18 },
  ],
  callConnectionLost: [
    { at: 0, freq: 330, dur: 0.2, gain: 0.2, type: 'sawtooth' },
    { at: 0.22, freq: 220, dur: 0.28, gain: 0.16, type: 'sawtooth' },
  ],
  callConnectionRestored: [
    { at: 0, freq: 440, dur: 0.12, gain: 0.18 },
    { at: 0.14, freq: 660, dur: 0.12, gain: 0.18 },
    { at: 0.28, freq: 880, dur: 0.18, gain: 0.16 },
  ],
  voiceJoin: [
    { at: 0, freq: 523.25, dur: 0.14, gain: 0.18 },
    { at: 0.13, freq: 783.99, dur: 0.18, gain: 0.16 },
  ],
  voiceLeave: [
    { at: 0, freq: 659.25, dur: 0.12, gain: 0.16 },
    { at: 0.13, freq: 440, dur: 0.2, gain: 0.14 },
  ],
  voiceMemberJoin: [{ at: 0, freq: 880, dur: 0.1, gain: 0.14 }],
  voiceMemberLeave: [{ at: 0, freq: 587.33, dur: 0.12, gain: 0.12 }],
  micMute: [{ at: 0, freq: 300, dur: 0.12, gain: 0.14, type: 'triangle' }],
  micUnmute: [{ at: 0, freq: 520, dur: 0.12, gain: 0.14, type: 'triangle' }],
  cameraOn: [
    { at: 0, freq: 700, dur: 0.1, gain: 0.14 },
    { at: 0.11, freq: 1046.5, dur: 0.12, gain: 0.12 },
  ],
  cameraOff: [
    { at: 0, freq: 700, dur: 0.1, gain: 0.12 },
    { at: 0.11, freq: 466.16, dur: 0.14, gain: 0.12 },
  ],
  screenShareStart: [
    { at: 0, freq: 622.25, dur: 0.1, gain: 0.14 },
    { at: 0.12, freq: 932.33, dur: 0.16, gain: 0.12 },
  ],
  screenShareStop: [
    { at: 0, freq: 622.25, dur: 0.1, gain: 0.12 },
    { at: 0.12, freq: 415.3, dur: 0.16, gain: 0.1 },
  ],
};

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.6,
  cues: SOUND_CUES.reduce((acc, cue) => {
    acc[cue.name] = true;
    return acc;
  }, {} as Record<SoundName, boolean>),
};

let cached: SoundSettings | null = null;

function normalise(raw: unknown): SoundSettings {
  const source = (raw ?? {}) as Partial<SoundSettings>;
  const cues = { ...DEFAULT_SOUND_SETTINGS.cues };
  if (source.cues && typeof source.cues === 'object') {
    for (const cue of SOUND_CUES) {
      const value = (source.cues as Record<string, unknown>)[cue.name];
      if (typeof value === 'boolean') cues[cue.name] = value;
    }
  }
  const volume = typeof source.volume === 'number' ? Math.min(1, Math.max(0, source.volume)) : DEFAULT_SOUND_SETTINGS.volume;
  return { enabled: source.enabled !== false, volume, cues };
}

export function getSoundSettings(): SoundSettings {
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    cached = stored ? normalise(JSON.parse(stored)) : { ...DEFAULT_SOUND_SETTINGS };
  } catch {
    cached = { ...DEFAULT_SOUND_SETTINGS };
  }
  return cached;
}

export function saveSoundSettings(next: SoundSettings): SoundSettings {
  cached = normalise(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Storage may be unavailable in private mode; keep the in-memory value.
  }
  window.dispatchEvent(new CustomEvent('chatter:sounds-changed', { detail: cached }));
  return cached;
}

export function resetSoundSettings(): SoundSettings {
  return saveSoundSettings(DEFAULT_SOUND_SETTINGS);
}

let context: AudioContext | null = null;
const lastPlayed = new Map<SoundName, number>();

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

/** Unlock audio after the first gesture so cues can play later without a click. */
export function primeSoundEngine(): void {
  ensureContext();
}

/**
 * Plays a cue. Silently does nothing when sounds are disabled, the cue is
 * muted, the volume is zero, or the browser blocks audio.
 */
export function playSound(name: SoundName): void {
  const settings = getSoundSettings();
  if (!settings.enabled || settings.volume <= 0) return;
  if (!settings.cues[name]) return;

  const now = Date.now();
  const previous = lastPlayed.get(name) ?? 0;
  if (now - previous < 140) return;
  lastPlayed.set(name, now);

  const ctx = ensureContext();
  if (!ctx) return;

  const master = ctx.createGain();
  master.gain.value = settings.volume;
  master.connect(ctx.destination);

  const start = ctx.currentTime + 0.01;
  for (const note of CUES[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? 'sine';
    osc.frequency.value = note.freq;
    const peak = (note.gain ?? 0.18) * 0.9;
    const from = start + note.at;
    gain.gain.setValueAtTime(0.0001, from);
    gain.gain.exponentialRampToValueAtTime(peak, from + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, from + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(from);
    osc.stop(from + note.dur + 0.03);
  }

  window.setTimeout(() => {
    try {
      master.disconnect();
    } catch {
      // Already torn down.
    }
  }, 2500);
}

export function previewSound(name: SoundName): void {
  const settings = getSoundSettings();
  if (!settings.enabled || settings.volume <= 0 || !settings.cues[name]) return;
  const ctx = ensureContext();
  if (!ctx) return;
  const master = ctx.createGain();
  master.gain.value = settings.volume;
  master.connect(ctx.destination);
  const start = ctx.currentTime + 0.01;
  for (const note of CUES[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? 'sine';
    osc.frequency.value = note.freq;
    const peak = (note.gain ?? 0.18) * 0.9;
    const from = start + note.at;
    gain.gain.setValueAtTime(0.0001, from);
    gain.gain.exponentialRampToValueAtTime(peak, from + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, from + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(from);
    osc.stop(from + note.dur + 0.03);
  }
}
