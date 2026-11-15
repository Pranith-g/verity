import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Stop } from '../types';
import { pct } from '../lib/format';
import { useTween } from '../lib/motion';
import { AlertIcon, CheckIcon, CopyIcon } from './icons';

export function Icon({ name }: { name: 'ok' | 'no' | 'wait' }) {
  if (name === 'wait')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="spin-slow">
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4" />
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      {name === 'ok' ? (
        <path d="M3.8 7.3l2.2 2.2 4.2-4.6" fill="none" stroke="#04070d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4.4 4.4l5.2 5.2M9.6 4.4l-5.2 5.2" stroke="#04070d" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function Flag({ tone, boxed, children }: { tone: 'good' | 'bad' | 'wait'; boxed?: boolean; children: ReactNode }) {
  return (
    <div className={`flag ${tone}${boxed ? ' boxed' : ''}`}>
      <Icon name={tone === 'good' ? 'ok' : tone === 'bad' ? 'no' : 'wait'} />
      <span>{children}</span>
    </div>
  );
}

/** A glass panel with an instrument-style title row. */
export function Panel({
  title,
  aside,
  children,
  className = '',
  style,
  as: Tag = 'section',
  label,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: 'section' | 'article' | 'div';
  label?: string;
}) {
  return (
    <Tag className={`panel ${className}`} style={style} aria-label={label}>
      {(title || aside) && (
        <header className="panel-head">
          {title && <h2 className="panel-title">{title}</h2>}
          {aside && <div className="panel-aside">{aside}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** A number that animates to each new value. */
export function Num({ value, format = (v) => String(Math.round(v)), ms }: { value: number | null | undefined; format?: (v: number) => string; ms?: number }) {
  const ok = value != null && Number.isFinite(value);
  const v = useTween(ok ? value : 0, ms);
  return <>{ok ? format(v) : '–'}</>;
}

export function LiveDot({ on = true, tone = 'good' }: { on?: boolean; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  return <i className={`live-dot ${tone}${on ? ' on' : ''}`} aria-hidden="true" />;
}

interface SegProps<T extends string | number> {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function Segmented<T extends string | number>({ id, label, value, options, onChange, disabled, compact }: SegProps<T>) {
  return (
    <div className={`seg-field${compact ? ' compact' : ''}`}>
      <span id={`${id}-label`} className="overline">
        {label}
      </span>
      <div className="seg" role="group" aria-labelledby={`${id}-label`}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            id={`${id}-${o.value}`}
            type="button"
            aria-pressed={o.value === value}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The three tests Verify must pass before it will say "stop". `show` formats a miss for display. */
export function StopRule({ stop, show }: { stop: Stop | null; show: (miss: number) => string }) {
  const items: [boolean, string, string, number][] = stop
    ? [
        [
          stop.features_checked,
          'Every deep feature it sees has been checked',
          stop.unchecked === 0 ? `${stop.deep_features} found, none left` : `${stop.unchecked} of ${stop.deep_features} left to check`,
          stop.deep_features ? 1 - stop.unchecked / stop.deep_features : 0,
        ],
        [
          stop.surprises_small,
          'Recent runs stopped surprising it',
          stop.worst_recent_miss == null
            ? 'collecting evidence'
            : `worst recent miss ${show(stop.worst_recent_miss)}, needs ${show(stop.allowed_miss)} or less`,
          stop.worst_recent_miss == null ? 0 : Math.min(1, stop.allowed_miss / Math.max(1e-12, stop.worst_recent_miss)),
        ],
        [
          stop.no_blind_spot,
          `No blind spot wider than ${pct(stop.max_gap, 0)} of the map`,
          `largest gap ${pct(stop.largest_gap)}`,
          Math.min(1, stop.max_gap / Math.max(1e-12, stop.largest_gap)),
        ],
      ]
    : [
        [false, 'Every deep feature it sees has been checked', 'waiting for the first fit', 0],
        [false, 'Recent runs stopped surprising it', 'waiting for the first fit', 0],
        [false, 'No blind spot wider than 7% of the map', 'waiting for the first fit', 0],
      ];
  return (
    <ul className="rule-list">
      {items.map(([ok, title, detail, frac], i) => (
        <li key={title} className={ok ? 'ok' : ''} style={{ ['--i' as string]: i }}>
          <span className="rule-ic">
            <Icon name={ok ? 'ok' : 'wait'} />
          </span>
          <div className="rule-body">
            <span className="rule-title">{title}</span>
            <em>{detail}</em>
            <span className="rule-track" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.max(0.02, frac)})` }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ErrorNote({ message, id }: { message: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p className="error" role="alert" id={id}>
      <AlertIcon size={15} />
      <span>{message}</span>
    </p>
  );
}

/** One headline number in a glass tile, with an icon, a unit and a line of context. */
export function Tile({
  icon,
  label,
  children,
  unit,
  sub,
  tone,
  progress,
  accent,
  style,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: 'good' | 'bad' | 'warn';
  progress?: number;
  accent?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`tile${tone ? ` ${tone}` : ''}`} style={{ ...(accent ? { ['--accent' as string]: accent } : {}), ...style }}>
      {icon && <span className="tile-ic">{icon}</span>}
      <div className="tile-body">
        <span className="overline">{label}</span>
        <span className="tile-v">
          {children}
          {unit && <small className="unit">{unit}</small>}
        </span>
        {progress != null && (
          <span className="track" aria-hidden="true">
            <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
          </span>
        )}
        {sub != null && <span className="tile-sub">{sub}</span>}
      </div>
    </div>
  );
}

/** A 270-degree radial gauge, value 0..1, with a gradient arc and a label in the middle. */
export function Gauge({ value, label, children, size = 168, from = '#7c5cff', to = '#00d4ff' }: {
  value: number;
  label: string;
  children: ReactNode;
  size?: number;
  from?: string;
  to?: string;
}) {
  const id = useId().replace(/:/g, '');
  const v = useTween(Math.min(1, Math.max(0, value)), 900);
  const r = 42;
  const len = 2 * Math.PI * r * 0.75;
  return (
    <div className="gauge" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`gg${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
          <filter id={`gf${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <g transform="rotate(135 50 50)">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(120,160,220,.12)" strokeWidth="6" strokeDasharray={`${len} 999`} strokeLinecap="round" />
          {Array.from({ length: 28 }, (_, i) => {
            const a = (i / 27) * 1.5 * Math.PI;
            return (
              <line
                key={i}
                x1={50 + Math.cos(a) * 34}
                y1={50 + Math.sin(a) * 34}
                x2={50 + Math.cos(a) * (i % 9 === 0 ? 30.5 : 32)}
                y2={50 + Math.sin(a) * (i % 9 === 0 ? 30.5 : 32)}
                stroke="rgba(160,190,240,.28)"
                strokeWidth=".7"
              />
            );
          })}
          <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#gg${id})`} strokeWidth="6" strokeDasharray={`${v * len} 999`} strokeLinecap="round" filter={`url(#gf${id})`} opacity=".7" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#gg${id})`} strokeWidth="6" strokeDasharray={`${v * len} 999`} strokeLinecap="round" />
        </g>
      </svg>
      <div className="gauge-mid">{children}</div>
    </div>
  );
}

export interface Step {
  label: string;
  icon: ReactNode;
  state: 'done' | 'active' | 'todo' | 'bad';
  hint?: string;
}

/** The workflow ribbon along the bottom of a page: what has happened, what is happening, what comes next. */
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <nav className="stepper" aria-label={label}>
      <ol>
        {steps.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && (
              <li className={`step-link${steps[i - 1].state === 'done' ? ' lit' : ''}`} aria-hidden="true">
                <svg viewBox="0 0 100 10" preserveAspectRatio="none">
                  <path d="M0 5H96" />
                  <path d="M92 1l5 4-5 4" />
                </svg>
              </li>
            )}
            <li className={`step ${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
              <span className="step-ic">
                {s.state === 'done' ? <CheckIcon size={18} /> : s.icon}
                {s.state === 'active' && <i className="step-orbit" aria-hidden="true" />}
              </span>
              <span className="step-txt">
                <span className="step-n">{i + 1}</span>
                {s.label}
                {s.hint && <em>{s.hint}</em>}
              </span>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** A small filled line, for activity and convergence read-outs. */
export function Sparkline({ values, w = 120, h = 32, color = '#00d4ff', log = false, label }: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
  log?: boolean;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const vs = values.map((v) => (log ? Math.log10(Math.max(1e-9, v)) : v)).filter(Number.isFinite);
  if (vs.length < 2)
    return (
      <svg width={w} height={h} className="spark" aria-hidden={!label} role={label ? 'img' : undefined} aria-label={label}>
        <path d={`M0 ${h - 1}H${w}`} stroke="rgba(120,160,220,.2)" strokeDasharray="2 3" />
      </svg>
    );
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pts = vs.map((v, i) => [(i / (vs.length - 1)) * w, h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="spark" role={label ? 'img' : undefined} aria-label={label} aria-hidden={!label}>
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${w} ${h}L0 ${h}Z`} fill={`url(#sp${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={color} />
    </svg>
  );
}

/** Copies text and confirms it in place for a moment. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button className="btn sm" type="button" onClick={() => void copy()}>
      {state === 'done' ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      <span aria-live="polite">{state === 'done' ? 'Copied' : state === 'failed' ? 'Select and copy by hand' : label}</span>
    </button>
  );
}

export function MapLegend({ study }: { study?: boolean }) {
  return (
    <div className="legend-row" aria-label="Map symbols">
      <span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5" fill="rgba(200,230,255,.18)" />
          <circle cx="8" cy="8" r="2.4" fill="#eaf6ff" />
        </svg>
        one paid run
      </span>
      <span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="4.5" y="4.5" width="7" height="7" transform="rotate(45 8 8)" fill="var(--s-verify)" stroke="#04070d" strokeWidth="1" />
        </svg>
        a run spent checking a predicted peak or valley
      </span>
      {study && (
        <span>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5" fill="none" stroke="var(--warn)" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
          </svg>
          suggested, waiting for a result
        </span>
      )}
      <span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="#b9cff5" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
        </svg>
        {study ? 'deep feature, not checked yet' : 'real feature, not captured yet'}
      </span>
      <span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--good)" strokeWidth="2.2" />
        </svg>
        {study ? 'deep feature, checked' : 'real feature, captured'}
      </span>
      {!study && (
        <span>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="var(--bad)" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          ghost: a deep feature the stand-in invented
        </span>
      )}
    </div>
  );
}
