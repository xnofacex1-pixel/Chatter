import { useEffect, useState } from 'react';
import { IconCheck, IconHeadphones, IconMic } from './icons';
import {
  getSoundSettings,
  previewSound,
  resetSoundSettings,
  saveSoundSettings,
  SOUND_CUES,
  type SoundName,
  type SoundSettings,
} from '../lib/sounds';

export function SoundSettingsPanel() {
  const [prefs, setPrefs] = useState<SoundSettings>(() => getSoundSettings());

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<SoundSettings>).detail;
      if (detail) setPrefs(detail);
    };
    window.addEventListener('chatter:sounds-changed', onChange);
    return () => window.removeEventListener('chatter:sounds-changed', onChange);
  }, []);

  const update = (next: SoundSettings) => setPrefs(saveSoundSettings(next));

  const toggleCue = (name: SoundName) => {
    update({ ...prefs, cues: { ...prefs.cues, [name]: !prefs.cues[name] } });
  };

  const groups = SOUND_CUES.reduce<Record<string, typeof SOUND_CUES>>((acc, cue) => {
    acc[cue.group] = acc[cue.group] ?? [];
    acc[cue.group].push(cue);
    return acc;
  }, {});

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="section-head">
          <span>Call & voice sounds</span>
          <span className="tiny muted">{prefs.enabled ? 'Enabled' : 'Muted'}</span>
        </div>
        <div className="card-pad stack" style={{ gap: 16 }}>
          <div className="row-between">
            <div className="stack" style={{ gap: 2 }}>
              <span style={{ fontWeight: 600 }}>Master sound</span>
              <span className="tiny muted">Turn every Chatter call and voice cue on or off.</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={prefs.enabled}
                onChange={(event) => update({ ...prefs, enabled: event.target.checked })}
                aria-label="Enable Chatter sounds"
              />
              <span />
            </label>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <div className="row-between">
              <span className="small">Volume</span>
              <span className="tiny muted">{Math.round(prefs.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(prefs.volume * 100)}
              onChange={(event) => update({ ...prefs, volume: Number(event.target.value) / 100 })}
              onMouseUp={() => previewSound('callConnect')}
              aria-label="Sound volume"
              disabled={!prefs.enabled}
            />
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => previewSound('callIncoming')}>
              <IconHeadphones size={14} /> Preview call
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => previewSound('voiceJoin')}>
              <IconMic size={14} /> Preview voice join
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrefs(resetSoundSettings())}>
              Reset to defaults
            </button>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            Sounds play through your normal output device and never touch your microphone or call audio. Browsers only allow
            audio after you interact with the page, so the first cue may stay silent until you click something.
          </p>
        </div>
      </section>

      {Object.entries(groups).map(([group, cues]) => (
        <section className="card" key={group}>
          <div className="section-head">
            <span>{group}</span>
            <span className="tiny muted">{cues.filter((cue) => prefs.cues[cue.name]).length}/{cues.length} on</span>
          </div>
          <div className="card-pad stack" style={{ gap: 10 }}>
            {cues.map((cue) => (
              <div className="row-between" key={cue.name}>
                <div className="stack" style={{ gap: 2 }}>
                  <span className="small">{cue.label}</span>
                  <span className="tiny muted">{cue.hint}</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => previewSound(cue.name)}
                    aria-label={`Preview ${cue.label}`}
                    disabled={!prefs.enabled || !prefs.cues[cue.name]}
                  >
                    Preview
                  </button>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={prefs.cues[cue.name]}
                      onChange={() => toggleCue(cue.name)}
                      aria-label={`${cue.label} sound`}
                      disabled={!prefs.enabled}
                    />
                    <span>{prefs.cues[cue.name] ? <IconCheck size={11} /> : null}</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
