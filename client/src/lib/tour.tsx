import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import TutorialOverlay from '../components/TutorialOverlay';
import {
  LESSONS,
  emptyProgress,
  tutorialApi,
  type LessonId,
  type TutorialProgress,
} from './tutorial';

/**
 * Guided tour state.
 *
 * The tour deliberately walks the *real* interface: every lesson navigates to a
 * live route. That means the overlay cannot live inside the tutorial page, or it
 * would unmount the moment a lesson starts. The provider sits above the router
 * routes and renders the overlay for whichever page the lesson points at.
 */

export type TourMode = 'idle' | 'running' | 'celebrate';

interface TourValue {
  mode: TourMode;
  index: number;
  paused: boolean;
  replayOnly: boolean;
  progress: TutorialProgress;
  loading: boolean;
  saving: boolean;
  error: string | null;
  start: (fromIndex: number, single?: boolean) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  togglePause: () => void;
  finish: () => void;
  refresh: () => Promise<void>;
}

const TourContext = createContext<TourValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<TutorialProgress>(emptyProgress);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TourMode>('idle');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replayOnly, setReplayOnly] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await tutorialApi.get();
      setProgress(data.progress);
      setError(null);
    } catch {
      setError('Tutorial progress could not be loaded. You can still take the tour.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    (fromIndex: number, single = false) => {
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

  const next = useCallback(() => {
    const lesson = LESSONS[index];
    if (!lesson) return;
    const completedLessons = Array.from(
      new Set<LessonId>([...progress.completedLessons, lesson.id]),
    );
    const isLast = index + 1 >= LESSONS.length;
    setProgress((prev) => ({ ...prev, completedLessons }));

    if (replayOnly) {
      void persist({ completedLessons });
      setMode('idle');
      setPaused(false);
      setReplayOnly(false);
      navigate('/tutorial');
      return;
    }

    if (isLast) {
      void persist({ completedLessons, completed: true });
      setMode('celebrate');
      setPaused(false);
      navigate('/tutorial');
      return;
    }

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
    setMode('idle');
    setPaused(false);
    setReplayOnly(false);
    navigate('/tutorial');
  }, [navigate]);

  const togglePause = useCallback(() => {
    setPaused((value) => !value);
  }, []);

  const finish = useCallback(() => {
    setMode('idle');
    navigate('/');
  }, [navigate]);

  const lesson = LESSONS[index];

  const value = useMemo<TourValue>(
    () => ({
      mode,
      index,
      paused,
      replayOnly,
      progress,
      loading,
      saving,
      error,
      start,
      next,
      back,
      skip,
      togglePause,
      finish,
      refresh,
    }),
    [
      mode,
      index,
      paused,
      replayOnly,
      progress,
      loading,
      saving,
      error,
      start,
      next,
      back,
      skip,
      togglePause,
      finish,
      refresh,
    ],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {mode === 'running' && lesson && (
        <TutorialOverlay
          lesson={lesson}
          index={index}
          total={LESSONS.length}
          paused={paused}
          onNext={next}
          onBack={back}
          onSkip={skip}
          onTogglePause={togglePause}
        />
      )}
    </TourContext.Provider>
  );
}

export function useTour(): TourValue {
  const context = useContext(TourContext);
  if (!context) throw new Error('useTour must be used inside TourProvider');
  return context;
}
