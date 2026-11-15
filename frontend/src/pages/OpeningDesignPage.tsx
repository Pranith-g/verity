import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { ErrorNote, Panel, Tile } from '../components/bits';
import { CheckIcon, ClockIcon, GridIcon, RulerIcon, TargetIcon } from '../components/icons';
import { Legend, LineChart } from '../components/LineChart';
import { pct, when } from '../lib/format';
import type { InitArm, InitDesignExample, InitDesignReport, InitTiming, PairedTest } from '../types';

const ARMS: InitArm[] = ['random', 'lhs'];
const COLOR: Record<InitArm, string> = { random: 'var(--s-random)', lhs: 'var(--s-verify)' };
const SHORT: Record<InitArm, string> = { random: 'Euclidean', lhs: '+ LHS' }; // end-of-line labels have ~70px
const ZOOM = 150; // runs shown in the curves: the opening design only matters early

/** Which arm a pair of numbers favours, or null when they are level or missing. */
function better(a: number | null, b: number | null, lowerBetter = true): InitArm | null {
  if (a == null && b == null) return null;
  if (a == null) return 'lhs';
  if (b == null) return 'random';
  if (Math.abs(a - b) < 1e-12) return null;
  return (a < b) === lowerBetter ? 'random' : 'lhs';
}

function pval(p: number) {
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toPrecision(2)}`;
}

function Paired({ t }: { t: PairedTest }) {
  const lead: InitArm | null = t.lhs_wins > t.random_wins ? 'lhs' : t.lhs_wins < t.random_wins ? 'random' : null;
  return (
    <span className={`paired${lead ? ` lead-${lead}` : ''}`} title={`LHS better in ${t.lhs_wins}, random better in ${t.random_wins}, ${t.ties} level; ${pval(t.p)}`}>
      <b>{t.lhs_wins}</b>
      <span className="muted">–</span>
      <b>{t.random_wins}</b>
      {t.ties > 0 && <small className="muted"> ({t.ties} level)</small>}
    </span>
  );
}

/** Two numbers side by side, the better one lit. */
function Pair({ a, b, fmt, lowerBetter = true }: { a: number | null; b: number | null; fmt: (v: number | null) => string; lowerBetter?: boolean }) {
  const win = better(a, b, lowerBetter);
  return (
    <span className="pair mono">
      <span className={win === 'random' ? 'win random' : ''}>{fmt(a)}</span>
      <span className="muted">/</span>
      <span className={win === 'lhs' ? 'win lhs' : ''}>{fmt(b)}</span>
    </span>
  );
}

/** The 12 opening runs on the unit square, with the biggest hole drawn as a circle. */
function DesignPlot({ ex, arm, label }: { ex: InitDesignExample; arm: InitArm; label: string }) {
  const S = 200;
  const n = ex.points.length;
  return (
    <figure className="design-plot">
      <svg viewBox={`-6 -6 ${S + 12} ${S + 12}`} role="img" aria-label={`${label}: ${n} opening runs; closest pair ${ex.min_dist.toFixed(2)} apart; biggest hole radius ${ex.gap.toFixed(2)}`}>
        <rect x={0} y={0} width={S} height={S} fill="rgba(8,14,26,.6)" stroke="var(--line-2)" />
        {arm === 'lhs' &&
          Array.from({ length: n - 1 }, (_, i) => (i + 1) / n).map((t) => (
            <g key={t} stroke="var(--line)">
              <line x1={t * S} x2={t * S} y1={0} y2={S} />
              <line y1={t * S} y2={t * S} x1={0} x2={S} />
            </g>
          ))}
        <clipPath id={`sq-${arm}`}>
          <rect x={0} y={0} width={S} height={S} />
        </clipPath>
        <circle
          clipPath={`url(#sq-${arm})`}
          cx={ex.gap_at[0] * S}
          cy={(1 - ex.gap_at[1]) * S}
          r={ex.gap * S}
          fill="var(--bad-tint)"
          stroke="var(--bad)"
          strokeOpacity=".55"
          strokeDasharray="4 4"
        />
        {ex.points.map(([u, v], i) => (
          <circle key={i} cx={u * S} cy={(1 - v) * S} r={4.2} fill={COLOR[arm]} stroke="#04070d" strokeWidth={1.5} />
        ))}
      </svg>
      <figcaption>
        <b style={{ color: COLOR[arm] }}>{label}</b>
        <span className="mono small">
          closest pair {ex.min_dist.toFixed(2)} · biggest hole {ex.gap.toFixed(2)}
        </span>
      </figcaption>
    </figure>
  );
}

const secs = (s: number | null) => (s == null ? '–' : s < 10 ? `${s.toFixed(2)} s` : `${s.toFixed(1)} s`);
const msec = (m: number | null) => (m == null ? '–' : `${m.toFixed(m < 10 ? 1 : 0)} ms`);

/** One measure, both arms, as two bars on a shared scale; the shorter (faster) one is lit. */
function TimeRow({ label, sub, a, b, fmt }: { label: string; sub?: string; a: number | null; b: number | null; fmt: (v: number | null) => string }) {
  const max = Math.max(a ?? 0, b ?? 0) || 1;
  // a gap under 2% is timing noise, not a winner
  const level = a != null && b != null && Math.abs(a - b) <= 0.02 * Math.max(a, b);
  const win = level ? null : better(a, b);
  return (
    <div className="time-row">
      <div className="time-label">
        <span>{label}</span>
        {sub && <small className="muted">{sub}</small>}
      </div>
      {ARMS.map((arm) => {
        const v = arm === 'random' ? a : b;
        return (
          <div key={arm} className={`time-bar${win === arm ? ' win' : ''}`}>
            <span className="time-track" aria-hidden="true">
              <i style={{ width: `${v == null ? 0 : Math.max(2, (100 * v) / max)}%`, background: COLOR[arm] }} />
            </span>
            <b className="mono">{fmt(v)}</b>
          </div>
        );
      })}
    </div>
  );
}

/** Time taken by each arm: to find every feature, for the whole budget, and to build the opening points. */
function TimeBox({ t, labels, budget, nInit }: { t: InitTiming; labels: Record<InitArm, string>; budget: number; nInit: number }) {
  const ra = t.arms.random;
  const la = t.arms.lhs;
  const delta = ra.finish_s && la.finish_s ? (la.finish_s - ra.finish_s) / ra.finish_s : null;
  const lead: InitArm | null = t.finish.lhs_wins > t.finish.random_wins ? 'lhs' : t.finish.lhs_wins < t.finish.random_wins ? 'random' : null;
  const sure = t.finish.p < 0.05;
  return (
    <Panel title={<span className="mono-title">opening/time_taken</span>} className="rise time-box">
      <div className="time-legend">
        {ARMS.map((arm) => (
          <span key={arm}>
            <i className="key" style={{ background: COLOR[arm] }} />
            {labels[arm]}
          </span>
        ))}
      </div>
      <TimeRow
        label="Time to find every feature"
        sub={`median start · ${ra.finish_runs ?? '–'} vs ${la.finish_runs ?? '–'} runs`}
        a={ra.finish_s}
        b={la.finish_s}
        fmt={secs}
      />
      <TimeRow label={`Total time for ${budget} runs`} sub="median start" a={ra.compute_s} b={la.compute_s} fmt={secs} />
      <TimeRow label={`Building the ${nInit} opening points`} sub="once per study" a={ra.design_ms} b={la.design_ms} fmt={msec} />
      <div className="time-verdict">
        <b className={lead && sure ? `lead-${lead}` : ''}>
          {delta == null
            ? 'Not enough finished starts to compare.'
            : !sure
              ? `About the same: ${Math.abs(delta * 100).toFixed(0)}% ${delta < 0 ? 'less' : 'more'} time with LHS, within noise.`
              : `${labels[lead ?? 'lhs']} finishes faster (${Math.abs(delta * 100).toFixed(0)}% ${delta < 0 ? 'less' : 'more'} time with LHS).`}
        </b>
        <span className="small muted">
          LHS finished sooner in {t.finish.lhs_wins}, random in {t.finish.random_wins} of the paired starts ({pval(t.finish.p)}). Learner time on this
          machine with {t.workers} starts running in parallel; the test simulators cost almost nothing. With a real simulator, its own run time dominates:
          at 1 minute per run, finishing takes about {ra.finish_runs ?? '–'} vs {la.finish_runs ?? '–'} minutes.
        </span>
      </div>
    </Panel>
  );
}

export function OpeningDesignPage() {
  const [r, setR] = useState<InitDesignReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 'missing': the endpoint exists but nothing is saved; 'stale': the server predates the endpoint
  const [missing, setMissing] = useState<false | 'missing' | 'stale'>(false);

  useEffect(() => {
    api
      .initDesign()
      .then(setR)
      .catch((e: Error) => {
        // FastAPI's own "Not Found" means the route itself is unknown: an API process started before this page existed
        if (e instanceof ApiError && e.status === 404) setMissing(e.message === 'Not Found' ? 'stale' : 'missing');
        else setError(e.message);
      });
  }, []);

  const L = r?.labels ?? { random: 'Euclidean', lhs: 'Euclidean + LHS' };
  const v = r?.overall.verdict;
  const pairs = r ? r.seeds * r.simulators.length : 0;
  const o = r?.overall;
  const legend = ARMS.map((a) => ({ label: L[a], color: COLOR[a] }));
  const runsFmt = (x: number | null) => (x == null ? '–' : r && x > r.budget ? `>${r.budget}` : String(Math.round(x)));

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <span className="eyebrow">
            <GridIcon size={13} />
            Method comparison
          </span>
          <h1>
            Opening design: <span className="grad">Euclidean vs Euclidean + LHS</span>
          </h1>
          <p className="lede">
            Both arms measure distance the same way, with plain Euclidean distance, for duplicate checks, feature checks and filling blind spots. The only
            difference is where the first {r?.n_init ?? 12} runs go: <b>uniform random</b>, or a <b>maximin Latin hypercube</b> (one run in every row and
            column of a {r?.n_init ?? 12}×{r?.n_init ?? 12} grid, spread as far apart as possible). Everything after that is the same Verify learner.
          </p>
        </div>
      </header>

      <ErrorNote message={error} />
      {missing === 'stale' && (
        <div className="panel gate empty">
          <span className="art">
            <GridIcon size={26} />
          </span>
          <h2>The API server needs a restart</h2>
          <p>
            The running API was started before this comparison was added, so it does not know this page yet. Stop it and start it again with{' '}
            <code className="mono">uvicorn app.main:app --port 8000</code> in the backend folder, then reload.
          </p>
        </div>
      )}
      {missing === 'missing' && (
        <div className="panel gate empty">
          <span className="art">
            <GridIcon size={26} />
          </span>
          <h2>No comparison has been measured yet</h2>
          <p>
            Run <code className="mono">python -m scripts.compare_init</code> in the backend folder (a few minutes on a multi-core machine), then reload this
            page.
          </p>
        </div>
      )}
      {!r && !missing && !error && (
        <div aria-busy="true">
          <span className="sr-only">Loading the comparison.</span>
          <div className="skel" style={{ height: 140, margin: '0 0 18px' }} />
          <div className="skel" style={{ height: 260 }} />
        </div>
      )}

      {r && v && o && (
        <>
          <section className={`panel verdict rise ${v.winner}`} aria-label="Verdict">
            <div className="verdict-head">
              <span className="overline">Verdict · {pairs} paired starts</span>
              <h2>
                {v.winner !== 'tie' && <CheckIcon size={22} />}
                {v.headline}
              </h2>
            </div>
            <ul className="verdict-why">
              {v.reasons.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="small muted">
              {r.simulators.length} simulators × {r.seeds} seeds, {r.budget} runs each, batches of {r.batch}. Each seed runs both arms with the same learner
              random stream, so a pair differs only in its opening runs. Measured {when(r.generated_at)}.
            </p>
          </section>

          <section className="tiles-row" aria-label="Headline numbers">
            <Tile icon={<TargetIcon size={18} />} label="Finished" accent="#2ff3a0" style={{ ['--i' as string]: 0 }} sub={`${L.random} / ${L.lhs}, of ${pairs}`}>
              <Pair a={o.arms.random.finished} b={o.arms.lhs.finished} fmt={(x) => String(x)} lowerBetter={false} />
            </Tile>
            <Tile icon={<ClockIcon size={18} />} label="Median runs to finish" accent="#00d4ff" style={{ ['--i' as string]: 1 }} sub="unfinished counted as over budget">
              <Pair a={o.arms.random.median_finish} b={o.arms.lhs.median_finish} fmt={runsFmt} />
            </Tile>
            <Tile icon={<CheckIcon size={18} />} label="Stop rule right" accent="#7c5cff" style={{ ['--i' as string]: 2 }} sub="correct / times it fired">
              <span className="pair mono">
                {o.arms.random.stop_correct}/{o.arms.random.stop_fired}
                <span className="muted"> · </span>
                {o.arms.lhs.stop_correct}/{o.arms.lhs.stop_fired}
              </span>
            </Tile>
            <Tile icon={<RulerIcon size={18} />} label="Opening spread" accent="#ff8a3d" style={{ ['--i' as string]: 3 }} sub="closest pair of the 12 opening runs">
              <Pair a={o.arms.random.init_min_dist} b={o.arms.lhs.init_min_dist} fmt={(x) => (x == null ? '–' : x.toFixed(2))} lowerBetter={false} />
            </Tile>
          </section>

          <div className="split">
            <Panel title={<span className="mono-title">opening/designs</span>} className="rise">
              <p className="small muted">The opening runs of the first benchmark start. The red circle is the biggest blind spot each design leaves.</p>
              {r.examples ? (
                <div className="design-pair">
                  {ARMS.map((a) => (
                    <DesignPlot key={a} ex={r.examples![a]} arm={a} label={L[a]} />
                  ))}
                </div>
              ) : (
                <p className="muted">Not available from this server.</p>
              )}
            </Panel>
            <div className="stack">
            <Panel title={<span className="mono-title">opening/paired_tests</span>} className="rise">
              <p className="small muted">Starts where LHS did better – starts where random did better, over all {pairs} pairs. Exact two-sided sign test.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Measure</th>
                      <th className="r">LHS – random</th>
                      <th className="r">Significance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['Finished sooner', o.finish],
                        [`Lower error at ${r.early_at} runs`, o.early],
                        [`Lower error at ${r.budget} runs`, o.final],
                        ['Wider opening spread', o.spread],
                      ] as [string, PairedTest][]
                    ).map(([label, t], i) => (
                      <tr key={label} style={{ ['--i' as string]: i }}>
                        <td>{label}</td>
                        <td className="r">
                          <Paired t={t} />
                        </td>
                        <td className={`r mono small ${t.p < 0.05 ? 'sig' : 'muted'}`}>{pval(t.p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            {o.timing && <TimeBox t={o.timing} labels={L} budget={r.budget} nInit={r.n_init} />}
            </div>
          </div>

          <section className="reads two-up" aria-label="Curves">
            <Panel title={<span className="mono-title">opening/features_captured</span>} className="rise">
              <p className="small muted">Share of real peaks and valleys the stand-in reproduces, averaged over every simulator and seed. First {ZOOM} runs, where the two differ; after that the curves sit on top of each other.</p>
              <Legend items={legend} />
              <LineChart
                aria="Share of features captured against runs bought, Euclidean against Euclidean plus LHS"
                xMax={ZOOM}
                xLabel="runs bought"
                scale={{ type: 'linear', min: 0, max: 1 }}
                ticks={[0, 0.25, 0.5, 0.75, 1].map((x) => ({ v: x, label: pct(x, 0) }))}
                fmt={(x) => pct(x, 1)}
                series={ARMS.map((a) => ({ key: a, label: SHORT[a], color: COLOR[a], pts: o.arms[a].curve.filter((p) => p.n <= ZOOM).map((p) => ({ x: p.n, y: p.captured })) }))}
              />
            </Panel>
            <Panel title={<span className="mono-title">opening/rmse_log</span>} className="rise">
              <p className="small muted">Typical error as a share of the output range (geometric mean over simulators of the median seed). Log scale; lower is better. First {ZOOM} runs.</p>
              <Legend items={legend} />
              <LineChart
                aria="Typical error against runs bought, Euclidean against Euclidean plus LHS, log scale"
                xMax={ZOOM}
                xLabel="runs bought"
                scale={{ type: 'log', min: 0.0005, max: 0.5 }}
                ticks={[0.001, 0.01, 0.1].map((x) => ({ v: x, label: `${x * 100}%` }))}
                fmt={(x) => pct(x, 2)}
                series={ARMS.map((a) => ({ key: a, label: SHORT[a], color: COLOR[a], pts: o.arms[a].curve.filter((p) => p.n <= ZOOM).map((p) => ({ x: p.n, y: p.rmse })) }))}
              />
            </Panel>
          </section>

          <Panel title={<span className="mono-title">opening/by_simulator</span>} className="rise">
            <p className="small muted">
              Each cell reads {L.random} / {L.lhs}; the better value is lit. “Finished first” counts paired starts where LHS finished sooner – where random did.
            </p>
            <div className="table-wrap">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th>Simulator</th>
                    <th className="r">Features</th>
                    <th className="r">Finished</th>
                    <th className="r">Median runs</th>
                    <th className="r">Finished first</th>
                    <th className="r">Error @ {r.early_at}</th>
                    <th className="r">Error @ {r.budget}</th>
                    <th className="r">Stop right</th>
                  </tr>
                </thead>
                <tbody>
                  {r.simulators.map((s, i) => {
                    const a = s.arms.random;
                    const b = s.arms.lhs;
                    return (
                      <tr key={s.key} style={{ ['--i' as string]: i }}>
                        <td>{s.name}</td>
                        <td className="r mono">{s.features}</td>
                        <td className="r">
                          <Pair a={a.finished} b={b.finished} fmt={(x) => `${x}/${r.seeds}`} lowerBetter={false} />
                        </td>
                        <td className="r">
                          <Pair a={a.median_done_at} b={b.median_done_at} fmt={runsFmt} />
                        </td>
                        <td className="r">
                          <Paired t={s.finish} />
                        </td>
                        <td className="r">
                          <Pair a={a.rmse_early} b={b.rmse_early} fmt={(x) => (x == null ? '–' : pct(x, 2))} />
                        </td>
                        <td className="r">
                          <Pair a={a.rmse_final} b={b.rmse_final} fmt={(x) => (x == null ? '–' : pct(x, 2))} />
                        </td>
                        <td className="r mono">
                          {a.stop_correct}/{a.stop_fired} <span className="muted">/</span> {b.stop_correct}/{b.stop_fired}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
