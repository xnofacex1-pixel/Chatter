import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import TutorialCelebration from '../components/TutorialCelebration';
import TutorialOverlay from '../components/TutorialOverlay';
import { useAuth } from '../lib/auth';
import { getSoundSettings, saveSoundSettings } from '../lib/sounds';
import {
  LESSONS,
  TOTAL_LESSONS,
  emptyProgress,
  tutorialApi,
  type LessonId,
  type TutorialProgress,
} from '../lib/tutorial';

type Mode = 'intro' | 'running' | 'celebrate';

export default function Tutorial() {
  const { user, settings } = useAuth();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<TutorialProgress>(emptyProgress);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('intro');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replayOnly, setReplayOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => getSoundSettings().enabled);

  const reducedMotion = Boolean(settings?.reducedMotion);

  useEffect(() => {
    let cancelled = false;
    tutorialApi
      .get()
      .then((data) => {
        if (!cancelled) setProgress(data.progress);
      })
      .catch(() => {
        if (!cancelled) setError('Tutorial progress could not be loaded. You can still take the tour.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (patch: { completedLessons?: LessonId[]; lastLesson?: string | null; completed?: boolean }) => {
      setSaving(true);
      try {
        const data = await tutorialApi.save(patch);
        setProgress(data.progress);
        setError(null);
      } catch {
        setError('Progress could not be saved right now — it will sync the next time you finish a lesson.');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const start = useCallback(
    (fromIndex: number, single: boolean) => {
      const lesson = LESSONS[fromIndex];
      if (!lesson) return;
      setIndex(fromIndex);
      setReplayOnly(single);
      setPaused(false);
      setMode('running');
      void persist({ lastLesson: lesson.id });
      navigate(lesson.path);
    },
    [navigate, persist],
  );

  const advance = useCallback(() => {
    const lesson = LESSONS[index];
    if (!lesson) return;
    const completedLessons = Array.from(
      new Set<LessonId>([...progress.completedLessons, lesson.id]),
    );
    const isLast = index + 1 >= LESSONS.length;

    if (replayOnly) {
      void persist({ completedLessons });
      setMode('intro');
      navigate('/tutorial');
      return;
    }

    if (isLast) {
      setProgress((prev) => ({ ...prev, completedLessons }));
      void persist({ completedLessons, completed: true });
      setMode('celebrate');
      return;
    }

    setProgress((prev) => ({ ...prev, completedLessons }));
    void persist({ completedLessons, lastLesson: LESSONS[index + 1]?.id ?? null });
    setIndex((value) => value + 1);
    navigate(LESSONS[index + 1]?.path ?? '/');
  }, [index, navigate, persist, progress.completedLessons, replayOnly]);

  const back = useCallback(() => {
    if (index === 0) return;
    const previous = index - 1;
    setIndex(previous);
    navigate(LESSONS[previous]?.path ?? '/');
  }, [index, navigate]);

  const skip = useCallback(() => {
    setMode('intro');
    setPaused(false);
    setReplayOnly(false);
    navigate('/tutorial');
  }, [navigate]);

  const enterChatter = useCallback(() => {
    setMode('intro');
    navigate('/');
  }, [navigate]);

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

  const lesson = LESSONS[index];

  return (
    <AppShell
      title="Tutorial"
      subtitle="A guided tour of everything Chatter can do"
    >
      <div className="page tutorial-page">
        {mode === 'running' && lesson && (
          <TutorialOverlay
            lesson={lesson}
            index={index}
            total={LESSONS.length}
            paused={paused}
            onNext={advance}
            onBack={back}
            onSkip={skip}
            onTogglePause={() => setPaused((value) => !value)}
          />
        )}

        {mode === 'celebrate' && (
          <TutorialCelebration
            onEnter={enterChatter}
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
                  onClick={() => start(progress.completed ? 0 : Math.min(completedCount, TOTAL_LESSONS - 1), false)}
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
