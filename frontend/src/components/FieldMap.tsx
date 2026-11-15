import { useEffect, useMemo, useRef, useState } from 'react';
import { ramp, sampleGrid } from '../lib/field';
import { num } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';

export interface Mark {
  u: number;
  v: number;
  kind: 'run' | 'check' | 'pending';
}
export interface Ring {
  u: number;
  v: number;
  state: 'plain' | 'open' | 'hit';
}
export interface Axes {
  x: [number, number];
  y: [number, number];
  xName: string;
  yName: string;
  zName: string;
}

interface Props {
  z: Float32Array | null;
  grid: number;
  lo: number;
  hi: number;
  gamma: number;
  marks?: Mark[];
  rings?: Ring[];
  ghosts?: [number, number][];
  label: string;
  /** Real units for the hover read-out. Without them the read-out shows positions on the unit square. */
  axes?: Axes;
  cols?: number;
}

const SIZE = 560; // drawing units; the canvas is scaled by CSS
const PAD = 10;
const SQ3 = Math.sqrt(3);

interface Hex {
  x: number;
  y: number;
  u: number;
  v: number;
}

/** Pointy-top hexagons covering the square, centre positions in drawing units and on the unit square. */
function layout(cols: number): { hexes: Hex[]; r: number } {
  const inner = SIZE - 2 * PAD;
  const r = inner / (cols * SQ3 + SQ3 / 2);
  const w = SQ3 * r;
  const rows = Math.floor((inner - 2 * r) / (1.5 * r)) + 1;
  const hexes: Hex[] = [];
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      const x = PAD + w / 2 + c * w + (row % 2 ? w / 2 : 0);
      const y = PAD + r + row * 1.5 * r;
      hexes.push({ x, y, u: (x - PAD) / inner, v: 1 - (y - PAD) / inner });
    }
  }
  return { hexes, r };
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

const X = (u: number) => PAD + u * (SIZE - 2 * PAD);
const Y = (v: number) => PAD + (1 - v) * (SIZE - 2 * PAD);

/** A surface drawn as a hexagon heat map, with the paid runs and the features glowing on top. */
export function FieldMap({ z, grid, lo, hi, gamma, marks = [], rings = [], ghosts = [], label, axes, cols = 30 }: Props) {
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { hexes, r } = useMemo(() => layout(cols), [cols]);
  const [hover, setHover] = useState<number | null>(null);
  const revealed = useRef(false);

  useEffect(() => {
    const canvas = base.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const span = hi > lo ? hi - lo : 1;
    const colors = hexes.map((h) => {
      if (!z) return null;
      const c = ramp((sampleGrid(z, grid, h.u, h.v) - lo) / span, gamma);
      return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    });

    const draw = (reveal: number) => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#04070d';
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < hexes.length; i++) {
        const h = hexes[i];
        const d = Math.hypot(h.u - 0.5, h.v - 0.5) / 0.71;
        const a = Math.min(1, Math.max(0, (reveal - d * 0.75) / 0.25));
        if (a <= 0) continue;
        hexPath(ctx, h.x, h.y, r * 0.84 * (0.6 + 0.4 * a));
        ctx.globalAlpha = a;
        ctx.fillStyle = colors[i] ?? '#0d1526';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (reveal < 1) return;
      drawMarks(ctx, marks, rings, ghosts);
    };

    if (revealed.current || prefersReducedMotion() || !z) {
      draw(1);
      if (z) revealed.current = true;
      return;
    }
    revealed.current = true;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0) / 900);
      draw(f);
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [z, grid, lo, hi, gamma, marks, rings, ghosts, hexes, r]);

  useEffect(() => {
    const canvas = over.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (hover == null) return;
    const h = hexes[hover];
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(200,225,255,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(h.x, PAD);
    ctx.lineTo(h.x, SIZE - PAD);
    ctx.moveTo(PAD, h.y);
    ctx.lineTo(SIZE - PAD, h.y);
    ctx.stroke();
    ctx.restore();
    hexPath(ctx, h.x, h.y, r * 0.98);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = 'rgba(160,220,255,.9)';
    ctx.shadowBlur = 12;
    ctx.stroke();
  }, [hover, hexes, r]);

  const pick = (clientX: number, clientY: number) => {
    const el = wrap.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const x = ((clientX - b.left) / b.width) * SIZE;
    const y = ((clientY - b.top) / b.height) * SIZE;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < hexes.length; i++) {
      const d = (hexes[i].x - x) ** 2 + (hexes[i].y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHover(bd <= (r * 1.1) ** 2 ? best : null);
  };

  const h = hover != null ? hexes[hover] : null;
  const val = h && z ? sampleGrid(z, grid, h.u, h.v) : null;
  const tip =
    h &&
    (axes
      ? {
          a: `${axes.xName} ${num(axes.x[0] + h.u * (axes.x[1] - axes.x[0]))}`,
          b: `${axes.yName} ${num(axes.y[0] + h.v * (axes.y[1] - axes.y[0]))}`,
          z: val != null ? `${num(val)} ${axes.zName}` : 'no fit yet',
        }
      : { a: `u ${h.u.toFixed(2)}`, b: `v ${h.v.toFixed(2)}`, z: val != null ? num(val) : 'no fit yet' });

  return (
    <div className="hexmap" ref={wrap} onPointerMove={(e) => pick(e.clientX, e.clientY)} onPointerLeave={() => setHover(null)}>
      <canvas ref={base} width={SIZE} height={SIZE} role="img" aria-label={label} />
      <canvas ref={over} width={SIZE} height={SIZE} aria-hidden="true" className="hex-over" />
      {h && tip && (
        <div
          className={`hex-tip${h.u > 0.6 ? ' left' : ''}${h.v < 0.25 ? ' up' : ''}`}
          style={{ left: `${(h.x / SIZE) * 100}%`, top: `${(h.y / SIZE) * 100}%` }}
          aria-hidden="true"
        >
          <span className="hex-tip-h">
            {tip.a} · {tip.b}
          </span>
          <span className="hex-tip-v">
            {val != null && <i style={{ background: `rgb(${ramp((val - lo) / (hi > lo ? hi - lo : 1), gamma).map((c) => c | 0).join(',')})` }} />}
            {tip.z}
          </span>
        </div>
      )}
    </div>
  );
}

function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 3, 0, 6.2832);
  ctx.fill();
}

function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], rings: Ring[], ghosts: [number, number][]) {
  const css = getComputedStyle(document.documentElement);
  const good = css.getPropertyValue('--good').trim() || '#2ee59d';
  const bad = css.getPropertyValue('--bad').trim() || '#ff5468';
  const verify = css.getPropertyValue('--s-verify').trim() || '#2ff3a0';
  const warn = css.getPropertyValue('--warn').trim() || '#ffc24b';

  for (const m of marks) {
    const x = X(m.u);
    const y = Y(m.v);
    if (m.kind === 'check') {
      glowDot(ctx, x, y, 4, 'rgba(47,243,160,.55)');
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(0.7854);
      ctx.fillStyle = verify;
      ctx.strokeStyle = '#04070d';
      ctx.lineWidth = 1.6;
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.strokeRect(-4.5, -4.5, 9, 9);
      ctx.restore();
    } else if (m.kind === 'pending') {
      glowDot(ctx, x, y, 5, 'rgba(255,194,75,.45)');
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 6.2832);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = warn;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      glowDot(ctx, x, y, 2.6, 'rgba(200,232,255,.5)');
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, 6.2832);
      ctx.fillStyle = '#eef8ff';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(4,7,13,.8)';
      ctx.stroke();
    }
  }
  for (const rg of rings) {
    const x = X(rg.u);
    const y = Y(rg.v);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 6.2832);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(4,7,13,.75)';
    ctx.stroke();
    ctx.lineWidth = rg.state === 'hit' ? 2.8 : 2;
    if (rg.state === 'hit') {
      ctx.shadowColor = good;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = good;
    } else {
      ctx.strokeStyle = '#b9cff5';
      if (rg.state === 'open') ctx.setLineDash([5, 4]);
    }
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, 6.2832);
    ctx.stroke();
    ctx.restore();
  }
  for (const [u, v] of ghosts) {
    const x = X(u);
    const y = Y(v);
    ctx.save();
    ctx.lineCap = 'round';
    for (const [color, width, blur] of [
      ['rgba(4,7,13,.9)', 7, 0],
      [bad, 3.4, 14],
    ] as const) {
      ctx.shadowColor = bad;
      ctx.shadowBlur = blur;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 8);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 8, y - 8);
      ctx.lineTo(x - 8, y + 8);
      ctx.stroke();
    }
    ctx.restore();
  }
}
