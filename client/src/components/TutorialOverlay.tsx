import { useEffect, useMemo, useState } from 'react';
import type { Lesson } from '../lib/tutorial';

/**
 * Guided highlight overlay.
 *
 * Each lesson lists CSS anchors (`data-tour="..."`) in priority order. The first
 * anchor that is actually on screen gets the spotlight; when none is present the
 * card centres itself instead of pointing at nothing.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 360;
const CARD_ESTIMATED_HEIGHT = 250;

function measure(anchors: string[]): Rect | null {
  if (typeof document === 'undefined') return null;
  for (const selector of anchors) {
    let el: Element | null = null;
    try {
      el = document.querySelector(selector);
    } catch {
      el = null;
    }
    if (!el) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) continue;
    if (box.bottom < 0 || box.top > window.innerHeight) continue;
    return { top: box.top, left: box.left, width: box.width, height: box.height };
  }
  return null;
}

interface Props {
  lesson: Lesson;
  index: number;
  total: number;
  paused: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onTogglePause: () => void;
}

export default function TutorialOverlay({
  lesson,
  index,
  total,
  paused,
  onNext,
  onBack,
  onSkip,
  onTogglePause,
}: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const anchors = useMemo(() => lesson.anchors ?? [], [lesson]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(measure(anchors)));
    };
    // Navigation that the lesson triggered needs a frame or two to settle.
    const timer = window.setTimeout(update, 120);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchors]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onBack, onSkip]);

  const cardStyle = useMemo(() => {
    if (!rect) return undefined;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const fitsRight = rect.left + rect.width + CARD_WIDTH + 40 < viewportW;
    const fitsLeft = rect.left - CARD_WIDTH - 40 > 0;
    let left: number;
    if (fitsRight) left = rect.left + rect.width + 18;
    else if (fitsLeft) left = rect.left - CARD_WIDTH - 18;
    else left = Math.min(Math.max(16, rect.left), viewportW - CARD_WIDTH - 16);
    const top = Math.min(
      Math.max(16, rect.top + rect.height / 2 - CARD_ESTIMATED_HEIGHT / 2),
      Math.max(16, viewportH - CARD_ESTIMATED_HEIGHT - 16),
    );
    return { top: `${top}px`, left: `${left}px` };
  }, [rect]);

  const percent = Math.round(((index + 1) / total) * 100);

  return (
    <div
      className={`tour-root${paused ? ' is-paused' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Tutorial lesson ${index + 1} of ${total}: ${lesson.title}`}
    >
      {rect && !paused && (
        <div
          className="tour-spotlight"
          style={{
            top: `${rect.top - 6}px`,
            left: `${rect.left - 6}px`,
            width: `${rect.width + 12}px`,
            height: `${rect.height + 12}px`,
          }}
        />
      )}

      <div className={`tour-card${rect && !paused ? '' : ' is-centred'}`} style={paused ? undefined : cardStyle}>
        {paused ? (
          <>
            <span className="tour-eyebrow">Tutorial paused</span>
            <h2 className="tour-title">Take your time</h2>
            <p className="tour-body">
              Your progress is saved to your account. Resume whenever you are ready, or leave the
              tutorial and pick it up from Settings → Help &amp; Support.
            </p>
            <div className="tour-actions">
              <button type="button" className="btn btn-primary" onClick={onTogglePause}>
                Resume tutorial
              </button>
              <button type="button" className="btn btn-ghost" onClick={onSkip}>
                Leave tutorial
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tour-progress-row">
              <span className="tour-eyebrow">
                Lesson {index + 1} of {total}
              </span>
              <span className="tour-percent">{percent}%</span>
            </div>
            <div className="tour-progress" aria-hidden="true">
              <span className="tour-progress-fill" style={{ width: `${percent}%` }} />
            </div>

            <span className="tour-icon" aria-hidden="true">
              {lesson.number}
            </span>
            <h2 className="tour-title">{lesson.title}</h2>
            <p className="tour-body">{lesson.summary}</p>
            {lesson.points.length > 0 && (
              <ul className="tour-tips">
                {lesson.points.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            )}
            {lesson.fallbackNote && <p className="tour-note">{lesson.fallbackNote}</p>}

            <div className="tour-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onBack}
                disabled={index === 0}
              >
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={onNext}>
                {index + 1 === total ? 'Finish' : 'Next'}
              </button>
            </div>
            <div className="tour-footer-links">
              <button type="button" className="tour-link" onClick={onTogglePause}>
                Pause
              </button>
              <button type="button" className="tour-link" onClick={onSkip}>
                Skip tutorial
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
