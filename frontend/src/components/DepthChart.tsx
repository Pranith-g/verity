import { pct } from '../lib/format';

interface Props {
  real: number[] | null; // true depths as shares of the range, when known (benchmarks)
  mine: number[]; // what the learner believes
  tau: number;
  band: number | null; // 2 x worst recent miss, as a share
}

const W = 420;
const H = 250;
const M = { l: 46, r: 12, t: 12, b: 30 };

/** Every feature's depth, deepest first. Dots inside the grey band are too shallow to trust yet. */
export function DepthChart({ real, mine, tau, band }: Props) {
  const top = 1.08;
  const ph = H - M.t - M.b;
  const k = Math.max(real?.length ?? 0, mine.length, 4);
  const x = (i: number) => M.l + 12 + (k === 1 ? 0 : i / (k - 1)) * (W - M.r - M.l - 24);
  const y = (v: number) => M.t + (1 - Math.min(top, Math.max(0, v)) / top) * ph;
  const b = band == null ? null : Math.min(top, band);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Depth of each feature, deepest first">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={M.l - 7} y={y(v) + 4} textAnchor="end">
              {v * 100}%
            </text>
          </g>
        ))}
        {b != null && <rect x={M.l} y={y(b)} width={W - M.r - M.l} height={Math.max(0, y(0) - y(b))} fill="var(--band)" />}
        <line x1={M.l} x2={W - M.r} y1={y(tau)} y2={y(tau)} stroke="var(--warn)" strokeWidth={1.3} strokeDasharray="5 4" />
        {real?.map((v, i) => (
          <circle key={`r${i}`} cx={x(i)} cy={y(v)} r={6.5} fill="none" stroke="#b9cff5" strokeWidth={1.6}>
            <title>{`Real feature ${i + 1}: depth ${pct(v)}`}</title>
          </circle>
        ))}
        {mine.map((v, i) => (
          <circle key={`g${i}`} cx={x(i)} cy={y(v)} r={7} fill="var(--s-verify)" opacity={0.18} />
        ))}
        {mine.map((v, i) => (
          <circle key={`m${i}`} cx={x(i)} cy={y(v)} r={4} fill="var(--s-verify)" stroke="#04070d" strokeWidth={1.5} className="pop" style={{ animationDelay: `${i * 40}ms` }}>
            <title>{`Believed feature ${i + 1}: depth ${pct(v)}`}</title>
          </circle>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" className="lab">
          features, deepest first
        </text>
      </svg>
    </div>
  );
}

export function DepthLegend({ withReal }: { withReal: boolean }) {
  return (
    <div className="legend-row">
      {withReal && (
        <span>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="#b9cff5" strokeWidth="1.6" />
          </svg>
          real depth
        </span>
      )}
      <span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="4" fill="var(--s-verify)" />
        </svg>
        what Verify believes
      </span>
      <span>
        <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
          <path d="M1 8h20" stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        shallower is ignored
      </span>
      <span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="3" width="14" height="10" fill="var(--band)" />
        </svg>
        too shallow to trust yet
      </span>
    </div>
  );
}
