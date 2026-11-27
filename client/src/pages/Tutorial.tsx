import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import TutorialCelebration from '../components/TutorialCelebration';
import { useAuth } from '../lib/auth';
import { getSoundSettings, saveSoundSettings } from '../lib/sounds';
import { useTour } from '../lib/tour';
import { LESSONS, TOTAL_LESSONS } from '../lib/tutorial';

export default function Tutorial() {
  const { user, settings } = useAuth();
  const navigate = useNavigate();
  const { mode, progress, loading, saving, error, start, finish } = useTour();
  const [soundEnabled, setSoundEnabled] = useState(() => getSoundSettings().enabled);

  const reducedMotion = Boolean(settings?.reducedMotion);

  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => {
      const next = !current;
      const existing = getSoundSettings();
      saveSoundSettings({ ...existing, enabled: next });
      return next;
    });
  }, []);

  const completedCount = progress.completedLessons.length;
  const percent = Math.round((completedCount / TOTAL_LESSONS) * 100);
  const resumeLesson = useMemo(
    () => LESSONS.find((lesson) => lesson.id === progress.lastLesson) ?? null,
    [progress.lastLesson],
  );

  return (
    <AppShell title="Tutorial" subtitle="A guided tour of everything Chatter can do">
      <div className="page tutorial-page">
        {mode === 'celebrate' && (
          <TutorialCelebration
            onEnter={finish}
            reducedMotion={reducedMotion}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
          />
        )}

        {error && (
          <div className="banner banner-warn" role="status">
            {error}
          </div>
        )}

        {loading ? (
          <div className="tutorial-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        ) : (
          <>
            <section className="tutorial-hero panel">
              <div className="tutorial-hero-glow" aria-hidden="true" />
              <span className="tutorial-eyebrow">Chatter guide</span>
              <h1>Welcome to Chatter{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}!</h1>
              <p className="tutorial-lede">
                Chatter is where you chat with friends, build communities and hop into voice, video
                and screen sharing. This short tour walks through every part of the app, using the
                real interface — nothing here changes your account.
              </p>

              <div className="tutorial-progress-block">
                <div className="tutorial-progress-head">
                  <span>
                    {completedCount} of {TOTAL_LESSONS} lessons complete
                  </span>
                  <strong>{percent}%</strong>
                </div>
                <div className="tour-progress" aria-hidden="true">
                  <span className="tour-progress-fill" style={{ width: `${percent}%` }} />
                </div>
                {progress.completed && (
                  <p className="tutorial-complete-note">You have completed the full tour.</p>
                )}
              </div>

              <div className="tutorial-hero-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() =>
                    start(progress.completed ? 0 : Math.min(completedCount, TOTAL_LESSONS - 1), false)
                  }
                >
                  {progress.completed || completedCount > 0 ? 'Restart tutorial' : 'Start tutorial'}
                </button>
                {!progress.completed && resumeLesson && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => start(LESSONS.findIndex((entry) => entry.id === resumeLesson.id), false)}
                  >
                    Resume at “{resumeLesson.title}”
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
                  Skip for now
                </button>
              </div>
              <p className="muted tutorial-save-note">
                {saving ? 'Saving progress…' : 'Progress is saved to your account, so you can pick up later.'}
              </p>
            </section>

            <section className="tutorial-lessons" aria-label="Tutorial lessons">
              <header className="tutorial-lessons-head">
                <h2>Lessons</h2>
                <p className="muted">Replay any lesson on its own whenever you like.</p>
              </header>
              <ol className="lesson-grid">
                {LESSONS.map((entry, entryIndex) => {
                  const done = progress.completedLessons.includes(entry.id);
                  return (
                    <li key={entry.id} className={`lesson-card${done ? ' is-done' : ''}`}>
                      <div className="lesson-card-top">
                        <span className="lesson-number">{done ? '✓' : entry.number}</span>
                        <div>
                          <h3>{entry.title}</h3>
                          <p className="muted">{entry.summary}</p>
                        </div>
                      </div>
                      <div className="lesson-card-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => start(entryIndex, true)}
                        >
                          Replay lesson
                        </button>
                        {done && <span className="lesson-done-label">Completed</span>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
