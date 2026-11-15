import { useId, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  color: string; // a CSS colour, usually var(--s-…)
  pts: { x: number; y: number }[];
  dashed?: boolean;
}

interface Props {
  aria: string;
  xMax: number;
  xLabel: string;
  series: Series[];
  scale: { type: 'linear' | 'log'; min: number; max: number };
  ticks: { v: number; label: string }[];
  fmt: (v: number) => string;
  mark?: { x: number; label: string; color: string } | null;
}

const W = 440;
const H = 250;
const M = { l: 44, r: 70, t: 14, b: 34 };

/** Glowing lines on a dark grid, end labels, and a crosshair that reads every series at once. */
export function LineChart({ aria, xMax, xLabel, series, scale, ticks, fmt, mark }: Props) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const x = (n: number) => M.l + (n / Math.max(1, xMax)) * pw;
  const y = (v: number) => {
    const c = Math.min(scale.max, Math.max(scale.min, v));
    const f =
      scale.type === 'log'
        ? (Math.log10(c) - Math.log10(scale.min)) / (Math.log10(scale.max) - Math.log10(scale.min))
        : (c - scale.min) / (scale.max - scale.min || 1);
    return M.t + (1 - f) * ph;
  };
  const xStep = xMax <= 150 ? 30 : xMax <= 400 ? 60 : 120;
  const xTicks: number[] = [];
  for (let n = 0; n <= xMax; n += xStep) xTicks.push(n);

  const live = series.filter((s) => s.pts.length);
  const ends = live.map((s) => ({ s, x: x(s.pts[s.pts.length - 1].x), y: y(s.pts[s.pts.length - 1].y) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (let i = ends.length - 1; i >= 0; i--) {
    const cap = H - M.b - (ends.length - 1 - i) * 14;
    if (ends[i].y > cap) ends[i].y = cap;
  }

  const nearest = (s: Series, n: number) => s.pts.reduce((b, p) => (Math.abs(p.x - n) < Math.abs(b.x - n) ? p : b), s.pts[0]);
  const hoverX = hover != null && live.length ? nearest(live[0], hover).x : null;
  const path = (s: Series) => s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join('');

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        <defs>
          <clipPath id={`clip${uid}`}>
            <rect className="chart-reveal" x={M.l - 4} y={0} width={pw + M.r} height={H} />
          </clipPath>
          <filter id={`glow${uid}`} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          {live.map((s) => (
            <linearGradient key={s.key} id={`area${uid}${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".22" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <rect x={M.l} y={M.t} width={pw} height={ph} fill="rgba(8,14,26,.5)" stroke="var(--line)" />
        {xTicks.map((n) => (
          <g key={n}>
            <line x1={x(n)} x2={x(n)} y1={M.t} y2={H - M.b} stroke="var(--line)" />
            <text x={x(n)} y={H - M.b + 16} textAnchor="middle">
              {n >= 1000 ? `${n / 1000}k` : n}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t.v}>
            <line x1={M.l} x2={W - M.r} y1={y(t.v)} y2={y(t.v)} stroke="var(--line)" />
            <text x={M.l - 7} y={y(t.v) + 4} textAnchor="end">
              {t.label}
            </text>
          </g>
        ))}
        <text x={M.l + pw / 2} y={H - 3} textAnchor="middle" className="lab">
          {xLabel}
        </text>
        {mark && (
          <g>
            <line x1={x(mark.x)} x2={x(mark.x)} y1={M.t} y2={H - M.b} stroke={mark.color} strokeWidth={1.2} strokeDasharray="3 4" />
            <rect x={x(mark.x) + 4} y={M.t + 4} width={mark.label.length * 5.6 + 10} height={16} rx={4} fill="rgba(4,7,13,.85)" stroke={mark.color} strokeOpacity=".5" />
            <text x={x(mark.x) + 9} y={M.t + 15} className="lab" fill={mark.color}>
              {mark.label}
            </text>
          </g>
        )}
        <g clipPath={`url(#clip${uid})`}>
          {live.length <= 3 &&
            live
              .filter((s) => !s.dashed)
              .map((s) => (
                <path
                  key={`a${s.key}`}
                  d={`${path(s)}L${x(s.pts[s.pts.length - 1].x).toFixed(1)} ${H - M.b}L${x(s.pts[0].x).toFixed(1)} ${H - M.b}Z`}
                  fill={`url(#area${uid}${s.key})`}
                />
              ))}
          {live.map((s) => (
            <g key={s.key}>
              {!s.dashed && <path d={path(s)} fill="none" stroke={s.color} strokeWidth={4} opacity={0.45} filter={`url(#glow${uid})`} />}
              <path
                d={path(s)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 1.4 : 1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '5 4' : undefined}
              />
              {!s.dashed && (
                <circle cx={x(s.pts[s.pts.length - 1].x)} cy={y(s.pts[s.pts.length - 1].y)} r={3.6} fill={s.color} stroke="#04070d" strokeWidth={1.5} className="end-dot" />
              )}
            </g>
          ))}
        </g>
        {ends.map((e) => (
          <text key={e.s.key} x={e.x + 9} y={e.y + 4} className="lab" fill={e.s.color}>
            {e.s.label}
          </text>
        ))}
        {hoverX != null && <line x1={x(hoverX)} x2={x(hoverX)} y1={M.t} y2={H - M.b} stroke="rgba(200,225,255,.45)" strokeDasharray="2 3" />}
        {hover != null &&
          hoverX != null &&
          live.map((s) => {
            const p = nearest(s, hover);
            return <circle key={s.key} cx={x(p.x)} cy={y(p.y)} r={4} fill="#04070d" stroke={s.color} strokeWidth={2} />;
          })}
        <rect
          x={M.l}
          y={M.t}
          width={pw}
          height={ph}
          fill="transparent"
          tabIndex={0}
          aria-label="Explore the values"
          onPointerMove={(ev) => {
            const r = ev.currentTarget.getBoundingClientRect();
            setHover(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * xMax);
          }}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(xMax)}
          onBlur={() => setHover(null)}
        />
      </svg>
      {hover != null && hoverX != null && (
        <div className="tip" style={{ left: `${Math.min(58, (x(hoverX) / W) * 100 + 3)}%` }}>
          <div className="h">Step {hoverX}</div>
          {live.map((s) => (
            <div key={s.key} className="tip-row">
              <i className="k" style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{fmt(nearest(s, hover).y)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend-row">
      {items.map((it) => (
        <span key={it.label}>
          <i className="key" style={{ background: it.color, color: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
