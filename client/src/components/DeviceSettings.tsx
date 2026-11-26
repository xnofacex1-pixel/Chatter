import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { IconCamera, IconCheck, IconHeadphones, IconMic, IconWarning } from './icons';
import { describeError } from '../lib/validation';

type DeviceChoice = { id: string; label: string };

interface StoredDevicePrefs {
  inputId: string;
  outputId: string;
  cameraId: string;
  inputVolume: number;
  outputVolume: number;
}

const STORAGE_KEY = 'chatter:voice-devices';

const DEFAULTS: StoredDevicePrefs = {
  inputId: '',
  outputId: '',
  cameraId: '',
  inputVolume: 80,
  outputVolume: 85,
};

function readPrefs(): StoredDevicePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<StoredDevicePrefs>;
    return {
      inputId: typeof parsed.inputId === 'string' ? parsed.inputId : '',
      outputId: typeof parsed.outputId === 'string' ? parsed.outputId : '',
      cameraId: typeof parsed.cameraId === 'string' ? parsed.cameraId : '',
      inputVolume: typeof parsed.inputVolume === 'number' ? parsed.inputVolume : DEFAULTS.inputVolume,
      outputVolume: typeof parsed.outputVolume === 'number' ? parsed.outputVolume : DEFAULTS.outputVolume,
    };
  } catch {
    return DEFAULTS;
  }
}

const label = (device: MediaDeviceInfo, fallback: string) => device.label || fallback;

/**
 * Real device selection and audio testing.
 *
 * Device labels are only exposed after the browser grants permission, so the
 * list is refreshed once permission is granted. The level meter and speaker test
 * use live Web Audio nodes: if neither produces data the UI says so instead of
 * claiming the device works.
 */
export function DeviceSettings() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<StoredDevicePrefs>(readPrefs);
  const [inputs, setInputs] = useState<DeviceChoice[]>([]);
  const [outputs, setOutputs] = useState<DeviceChoice[]>([]);
  const [cameras, setCameras] = useState<DeviceChoice[]>([]);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [supportsOutput, setSupportsOutput] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPermissionError('This browser cannot enumerate audio or video devices.');
      return;
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind: MediaDeviceKind, fallback: string) =>
      list
        .filter((device) => device.kind === kind)
        .map((device, index) => ({ id: device.deviceId, label: label(device, `${fallback} ${index + 1}`) }));
    setInputs(pick('audioinput', 'Microphone'));
    setOutputs(pick('audiooutput', 'Speaker'));
    setCameras(pick('videoinput', 'Camera'));
    setSupportsOutput(typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype);
  }, []);

  useEffect(() => {
    void refreshDevices().catch(() => setPermissionError('Devices could not be listed.'));
    const onChange = () => void refreshDevices().catch(() => undefined);
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [refreshDevices]);

  const stopTest = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    setLevel(0);
    setTesting(false);
  }, []);

  useEffect(() => stopTest, [stopTest]);

  const save = (next: StoredDevicePrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing can block storage; the selection still applies this session.
    }
  };

  const startTest = async () => {
    stopTest();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: prefs.inputId ? { deviceId: { exact: prefs.inputId } } : true,
      });
      streamRef.current = stream;
      const Context = window.AudioContext;
      const context = new Context();
      contextRef.current = context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        setLevel(Math.min(1, peak * 1.6));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
      setTesting(true);
      setPermissionError(null);
      await refreshDevices();
    } catch (cause) {
      stopTest();
      setPermissionError(describeError(cause).message);
    }
  };

  const testSpeaker = async () => {
    try {
      const Context = window.AudioContext;
      const context = new Context();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 620;
      gain.gain.value = Math.max(0.02, Math.min(1, prefs.outputVolume / 100)) * 0.12;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.6);
      oscillator.onended = () => void context.close();
      toast.push({ kind: 'success', title: 'Speaker test played', description: 'You should have heard a short chime.' });
    } catch (cause) {
      toast.push({ kind: 'error', title: 'Speaker test failed', description: describeError(cause).message });
    }
  };

  const requestAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      await refreshDevices();
      toast.push({ kind: 'success', title: 'Device access granted' });
    } catch (cause) {
      setPermissionError(describeError(cause).message);
      toast.push({
        kind: 'info',
        title: 'Device access was not granted',
        description: 'Microphone and camera stay off until you allow them in the browser.',
      });
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card card-pad stack" style={{ gap: 12 }}>
        <div>
          <h3 className="section-title">Voice &amp; video devices</h3>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            These choices apply to the next call you join. Microphone access is only requested while you test.
          </p>
        </div>

        {permissionError && (
          <div className="alert alert-warning" role="alert">
            <IconWarning size={15} /> {permissionError}
          </div>
        )}

        <div className="device-grid">
          <div className="device-card">
            <div className="device-head">
              <IconMic size={14} /> Microphone
            </div>
            <select
              className="input"
              aria-label="Microphone"
              value={prefs.inputId}
              onChange={(event) => save({ ...prefs, inputId: event.target.value })}
            >
              <option value="">System default</option>
              {inputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
            <label className="row" style={{ gap: 8, marginTop: 10, fontSize: 12 }}>
              <span className="muted">Input volume</span>
              <input
                type="range"
                min={0}
                max={100}
                value={prefs.inputVolume}
                aria-label="Input volume"
                onChange={(event) => save({ ...prefs, inputVolume: Number(event.target.value) })}
                style={{ flex: 1 }}
              />
              <span className="muted">{prefs.inputVolume}%</span>
            </label>
            <div className="meter" aria-hidden="true" style={{ marginTop: 8 }}>
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={testing ? stopTest : () => void startTest()}>
                {testing ? 'Stop test' : 'Test microphone'}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void requestAccess()}>
                Allow devices
              </button>
            </div>
            {testing && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                {level > 0.02 ? (
                  <span className="row" style={{ gap: 6 }}>
                    <IconCheck size={13} /> Hearing input — speak to confirm the meter moves.
                  </span>
                ) : (
                  'Meter is flat — check the selected microphone or raise the input volume.'
                )}
              </div>
            )}
          </div>

          <div className="device-card">
            <div className="device-head">
              <IconHeadphones size={14} /> Speaker
            </div>
            <select
              className="input"
              aria-label="Speaker"
              value={prefs.outputId}
              disabled={!supportsOutput}
              onChange={(event) => save({ ...prefs, outputId: event.target.value })}
            >
              <option value="">System default</option>
              {outputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
            {!supportsOutput && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                This browser uses the system output device.
              </div>
            )}
            <label className="row" style={{ gap: 8, marginTop: 10, fontSize: 12 }}>
              <span className="muted">Output volume</span>
              <input
                type="range"
                min={0}
                max={100}
                value={prefs.outputVolume}
                aria-label="Output volume"
                onChange={(event) => save({ ...prefs, outputVolume: Number(event.target.value) })}
                style={{ flex: 1 }}
              />
              <span className="muted">{prefs.outputVolume}%</span>
            </label>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => void testSpeaker()}>
                Test speaker
              </button>
            </div>
          </div>

          <div className="device-card">
            <div className="device-head">
              <IconCamera size={14} /> Camera
            </div>
            <select
              className="input"
              aria-label="Camera"
              value={prefs.cameraId}
              onChange={(event) => save({ ...prefs, cameraId: event.target.value })}
            >
              <option value="">System default</option>
              {cameras.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              Cameras are only turned on when you enable video in a call.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
