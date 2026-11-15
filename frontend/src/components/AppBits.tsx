import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { bandPosition } from '../lib/appfmt';
import { useReducedMotion, useTween } from '../lib/motion';
import type { AppBand, AppKey } from '../types';

/** A link card that tilts towards the pointer in 3D, with a moving glare. Flat when reduced motion is on. */
export function TiltCard({
  to,
  current,
  hue,
  onHover,
  children,
  style,
}: {
  to: string;
  current: boolean;
  hue: number;
  onHover?: (on: boolean) => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduced = useReducedMotion();
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reduced || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 14}deg`);
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (el) {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    }
    onHover?.(false);
  };
  return (
    <Link
      ref={ref}
      to={to}
      className={`tilt-card${current ? ' current' : ''}`}
      aria-current={current ? 'page' : undefined}
      style={{ ['--h' as string]: hue, ...style }}
      onPointerMove={move}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={leave}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
    >
      <span className="tilt-inner">{children}</span>
      <span className="tilt-glare" aria-hidden="true" />
    </Link>
  );
}

/** Small animated illustration per application: drifting particles, moving cars, a turning sun. */
export function AppGlyph({ app, size = 44 }: { app: AppKey; size?: number }) {
  if (app === 'air-quality')
    return (
      <svg className="glyph air" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <path className="wind w1" d="M4 18h22a5 5 0 1 0-5-5" />
        <path className="wind w2" d="M4 26h32a5 5 0 1 1-5 5" />
        <path className="wind w3" d="M4 34h14" />
        {[
          [30, 14, 1.6],
          [38, 22, 2.2],
          [24, 40, 1.8],
          [40, 36, 1.4],
          [14, 10, 1.2],
        ].map(([cx, cy, r], i) => (
          <circle key={i} className="mote" cx={cx} cy={cy} r={r} style={{ ['--d' as string]: `${i * 0.6}s` }} />
        ))}
      </svg>
    );
  if (app === 'traffic')
    return (
      <svg className="glyph traffic" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <path className="road" d="M2 16h44M2 32h44" />
        <path className="lane" d="M2 24h44" />
        <g className="car c1">
          <rect x="0" y="18" width="10" height="4.5" rx="1.6" />
        </g>
        <g className="car c2">
          <rect x="0" y="25.5" width="8" height="4.5" rx="1.6" />
        </g>
        <g className="car c3">
          <rect x="0" y="18" width="7" height="4.5" rx="1.6" />
        </g>
      </svg>
    );
  return (
    <svg className="glyph weather" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <g className="sun">
        <circle cx="18" cy="18" r="7" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return <path key={i} d={`M${18 + Math.cos(a) * 10.5} ${18 + Math.sin(a) * 10.5}L${18 + Math.cos(a) * 14} ${18 + Math.sin(a) * 14}`} />;
        })}
      </g>
      <path className="cloud" d="M16 38h20a7 7 0 0 0 0-14 9 9 0 0 0-17 3 5.5 5.5 0 0 0-3 11z" />
      <path className="drop d1" d="M22 42v3" />
      <path className="drop d2" d="M30 42v3" />
    </svg>
  );
}

/** The category scale, one coloured segment per band, with a marker that glides to the current value. */
export function BandScale({ bands, value }: { bands: AppBand[]; value: number | null }) {
  const pos = useTween(value == null ? 0 : bandPosition(bands, value), 650);
  return (
    <div className="band-scale">
      <div className="band-track">
        {bands.map((b) => (
          <span key={b.label} style={{ background: b.color }} title={`${b.label}${b.upto != null ? ` (up to ${b.upto})` : ''}`} />
        ))}
        {value != null && <i className="band-marker" style={{ left: `${pos * 100}%` }} />}
      </div>
      <div className="band-labels">
        {bands.map((b) => (
          <span key={b.label}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
