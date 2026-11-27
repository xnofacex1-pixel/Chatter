import { useEffect, useRef, useState } from 'react';
import { playSound } from '../lib/sounds';

/**
 * Tutorial completion celebration.
 *
 * The particle field is drawn on a canvas and stops as soon as the overlay
 * unmounts. With reduced motion enabled the field is skipped entirely and the
 * glow stays static so nothing animates for users who asked for calm.
 */

interface Props {
  onEnter: () => void;
  reducedMotion: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  life: number;
}

const PALETTE = [188, 199, 210, 220];

export default function TutorialCelebration({
  onEnter,
  reducedMotion,
  soundEnabled,
  onToggleSound,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [percent, setPercent] = useState(reducedMotion ? 100 : 0);

  // Count up to 100% once, then hold.
  useEffect(() => {
    if (reducedMotion) {
      setPercent(100);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const duration = 1800;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setPercent(Math.round(progress * 100));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  // Success chime, respecting the saved sound preference.
  useEffect(() => {
    if (!soundEnabled) return;
    const timer = window.setTimeout(() => playSound('callConnect'), 260);
    return () => window.clearTimeout(timer);
  }, [soundEnabled]);

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const burst = () => {
      const originX = width / 2;
      const originY = height * 0.42;
      const particles: Particle[] = [];
      for (let index = 0; index < 120; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.6 + Math.random() * 4.2;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1 + Math.random() * 2.6,
          hue: PALETTE[Math.floor(Math.random() * PALETTE.length)],
          life: 1,
        });
      }
      return particles;
    };

    let particles = burst();
    let frame = 0;

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';
      particles = particles.filter((particle) => particle.life > 0);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.035;
        particle.vx *= 0.995;
        particle.vy *= 0.995;
        particle.life -= 0.006;
        context.beginPath();
        context.fillStyle = `hsla(${particle.hue}, 95%, 66%, ${Math.max(0, particle.life)})`;
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      if (particles.length === 0) particles = burst();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    const onResize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [reducedMotion]);

  return (
    <div
      className={`celebrate-root${reducedMotion ? ' is-calm' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial complete"
    >
      {!reducedMotion && <canvas ref={canvasRef} className="celebrate-canvas" aria-hidden="true" />}
      <div className="celebrate-glow" aria-hidden="true" />
      <div className="celebrate-ring" aria-hidden="true" />
      <div className="celebrate-ring celebrate-ring-2" aria-hidden="true" />

      <div className="celebrate-content">
        <div className="celebrate-logo" aria-hidden="true">
          <svg viewBox="0 0 64 64" width="72" height="72" role="presentation">
            <defs>
              <linearGradient id="celebrate-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7655f5" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#celebrate-gradient)" opacity="0.16" />
            <path
              d="M18 24h28a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H30l-10 8v-8h-2a6 6 0 0 1-6-6V30a6 6 0 0 1 6-6z"
              fill="none"
              stroke="url(#celebrate-gradient)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <circle cx="26" cy="35" r="2.4" fill="#7655f5" />
            <circle cx="34" cy="35" r="2.4" fill="#a78bfa" />
            <circle cx="42" cy="35" r="2.4" fill="#60a5fa" />
          </svg>
        </div>

        <h1 className="celebrate-title">YOU&rsquo;RE READY TO CHAT!</h1>
        <p className="celebrate-subtitle">Welcome to the Chatter community.</p>

        <div className="celebrate-meter" aria-hidden="true">
          <span className="celebrate-meter-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="celebrate-percent">
          Tutorial complete — <strong>{percent}%</strong>
        </p>

        <div className="celebrate-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={onEnter}>
            Enter Chatter
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onToggleSound}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? 'Sound on' : 'Sound off'}
          </button>
        </div>
      </div>
    </div>
  );
}
