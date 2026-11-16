import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { AppHero3D } from '../components/AppHero3D';
import { AppGlyph, BandScale, TiltCard } from '../components/AppBits';
import { ModelPanel } from '../components/AppModel';
import { ErrorNote, LiveDot, Num, Panel, Segmented, StopRule } from '../components/bits';
import { FieldMap, type Mark, type Ring } from '../components/FieldMap';
import {
  ActivityIcon,
  ArrowIcon,
  BoltIcon,
  CameraIcon,
  ChartIcon,
  CpuIcon,
  FileIcon,
  GaugeIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ResetIcon,
  RotateIcon,
  TargetIcon,
  TrashIcon,
  WaveIcon,
} from '../components/icons';
import { LineChart } from '../components/LineChart';
import { Surface3D, type Beacon, type P3, type Surface3DHandle } from '../components/Surface3D';
import { WEEKDAYS, gauss, inputLabel, outLabel, parseCsv, perUnit } from '../lib/appfmt';
import { OUTPUT_GRADIENT, decodeGrid, displayGamma } from '../lib/field';
import { ago, int } from '../lib/format';
import type { AppInput, AppKey, AppPoint, AppPrediction, AppReadingIn, AppRetrain, AppState, AppSummary } from '../types';

const KEYS: AppKey[] = ['air-quality', 'traffic', 'weather'];
const REASON: Record<string, string> = {
  verify: 'Check a peak or valley',
  fill: 'Fill the biggest blind spot',
  explore: 'Random spot-check',
  init: 'Opening layout',
};

const pctR2 = (r2: number | null | undefined) => (r2 == null ? '–' : `${(Math.max(0, r2) * 100).toFixed(r2 > 0.999 ? 2 : 1)}%`);

/* ====================================================================== page */
export function AppsPage() {
  const params = useParams();
  const active: AppKey = KEYS.includes(params.key as AppKey) ? (params.key as AppKey) : 'air-quality';
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const section = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      api
        .apps()
        .then((a) => {
          if (!alive) return;
          setApps(a);
          setError(null);
        })
        .catch((e: Error) => alive && setError(e.message));
    void pull();
    const t = setInterval(pull, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = section.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [active]);

  const orbits = useMemo(() => (apps ?? []).map((a) => ({ key: a.key, hue: a.hue })), [apps]);
  const totals = useMemo(() => {
    if (!apps) return null;
    const r2 = apps.map((a) => a.metrics.r2).filter((x): x is number => x != null);
    return {
      runs: apps.reduce((s, a) => s + a.runs, 0),
      readings: apps.reduce((s, a) => s + a.observations, 0),
      r2: r2.length ? r2.reduce((s, x) => s + x, 0) / r2.length : null,
      learning: apps.filter((a) => a.status === 'training').length,
    };
  }, [apps]);

  return (
    <div className="page apps-page">
      <section className="apps-hero panel rise" aria-labelledby="apps-title">
        <div className="apps-hero-copy">
          <span className="eyebrow">
            <LiveDot tone="info" /> Real-world applications
          </span>
          <h1 id="apps-title">
            Forecast the city with <span className="grad">a fraction of the simulations</span>
          </h1>
          <p className="lede">
            Three prediction services built on the Verify learner. It decides which expensive reference-model runs to buy, stops when its own evidence says the
            forecast is good enough, then answers in microseconds. <b>Add a new reading and the model retrains on the spot.</b>
          </p>
          <div className="hero-stats">
            <div>
              <span className="overline">Reference runs</span>
              <b className="mono">
                <Num value={totals?.runs} format={int} />
              </b>
            </div>
            <div>
              <span className="overline">Field readings</span>
              <b className="mono">
                <Num value={totals?.readings} format={int} />
              </b>
            </div>
            <div>
              <span className="overline">Mean accuracy (R²)</span>
              <b className="mono">{pctR2(totals?.r2)}</b>
            </div>
            <div>
              <span className="overline">Learning now</span>
              <b className="mono">
                {totals && totals.learning > 0 && <LiveDot tone="info" />}
                {totals?.learning ?? '–'}
              </b>
            </div>
          </div>
        </div>
        <div className="apps-hero-art">
          {orbits.length > 0 && <AppHero3D orbits={orbits} focus={hover ?? active} label="A turning globe with one orbit per application" />}
          <div className="hero-art-glow" aria-hidden="true" />
        </div>
      </section>

      <ErrorNote message={error} />

      <nav className="app-cards" aria-label="Applications">
        {(apps ?? KEYS.map(() => null as AppSummary | null)).map((a, i) =>
          a ? (
            <TiltCard key={a.key} to={`/apps/${a.key}`} current={a.key === active} hue={a.hue} onHover={(on) => setHover(on ? a.key : null)} style={{ ['--i' as string]: i }}>
              <span className="tc-top">
                <span className="tc-glyph">
                  <AppGlyph app={a.key} />
                </span>
                <StatusChip app={a} />
              </span>
              <span className="tc-name">{a.name}</span>
              <span className="tc-tag">{a.tagline}</span>
              <span className="tc-stats mono">
                <span>
                  <small>R²</small>
                  {pctR2(a.metrics.r2)}
                </span>
                <span>
                  <small>runs</small>
                  {a.runs}
                </span>
                <span>
                  <small>readings</small>
                  {a.observations}
                </span>
              </span>
              <span className="tc-bar" aria-hidden="true">
                <i style={{ transform: `scaleX(${Math.min(1, a.runs / a.budget)})` }} />
              </span>
            </TiltCard>
          ) : (
            <div key={KEYS[i]} className="tilt-card skel" aria-hidden="true" />
          ),
        )}
      </nav>

      <div ref={section} className="app-anchor">
        <AppSection key={active} appKey={active} />
      </div>
    </div>
  );
}

function StatusChip({ app }: { app: Pick<AppSummary, 'status' | 'runs' | 'budget'> }) {
  if (app.status === 'training')
    return (
      <span className="pill learning">
        <LiveDot tone="info" /> Learning {app.runs}/{app.budget}
      </span>
    );
  if (app.status === 'ready')
    return (
      <span className="pill ready">
        <LiveDot tone="good" /> Certified
      </span>
    );
  if (app.status === 'budget') return <span className="pill">Budget used</span>;
  return <span className="pill">Starting</span>;
}

/* ====================================================================== one application */
function AppSection({ appKey }: { appKey: AppKey }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [spin, setSpin] = useState(true);
  const [x, setX] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<AppRetrain | null>(null);
  const [changeTint, setChangeTint] = useState<Float32Array | null>(null);
  const [form, setForm] = useState<{ x1: string; x2: string; value: string } | null>(null);
  const stage = useRef<Surface3DHandle>(null);
  const prevZ = useRef<Float32Array | null>(null);
  const tintTimer = useRef<number>(0);

  const refresh = useCallback(
    (signal?: AbortSignal) =>
      api
        .app(appKey, signal)
        .then((s) => {
          setState(s);
          setError(null);
        })
        .catch((e: Error) => e.name !== 'AbortError' && setError(e.message)),
    [appKey],
  );

  const training = state?.status === 'training' || state?.status === 'idle';
  useEffect(() => {
    const ctl = new AbortController();
    void refresh(ctl.signal);
    const t = setInterval(() => void refresh(), training || !state ? 380 : 6000);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
  }, [refresh, training, state == null]); // eslint-disable-line react-hooks/exhaustive-deps

  // pick the first example as the starting what-if point
  useEffect(() => {
    if (state && !x) setX([state.examples[0]?.x1 ?? state.inputs[0].low, state.examples[0]?.x2 ?? state.inputs[1].low]);
  }, [state, x]);

  const z = useMemo(() => (state?.z ? decodeGrid(state.z) : null), [state?.z]);
  const lo = state?.z_min ?? 0;
  const hi = state?.z_max ?? 1;
  const gamma = useMemo(() => (z ? displayGamma(z, lo, hi) : 1), [z, lo, hi]);

  // after a retrain, light up where the surface moved, then fade back to the output colours
  useEffect(() => {
    const before = prevZ.current;
    if (!z || !before || before.length !== z.length) return;
    prevZ.current = null;
    let m = 0;
    const d = new Float32Array(z.length);
    for (let i = 0; i < z.length; i++) {
      d[i] = Math.abs(z[i] - before[i]);
      m = Math.max(m, d[i]);
    }
    if (m <= 1e-9) return;
    for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i] / m);
    setChangeTint(d);
    window.clearTimeout(tintTimer.current);
    tintTimer.current = window.setTimeout(() => setChangeTint(null), 5200);
  }, [z]);
  useEffect(() => () => window.clearTimeout(tintTimer.current), []);

  const onRetrained = (res: AppRetrain) => {
    prevZ.current = z;
    setResult(res);
    void refresh();
  };

  if (!state) {
    return (
      <section className="app-section">
        <ErrorNote message={error} />
        <div className="panel app-loading" aria-busy="true">
          <span className="boot-bar">
            <i />
          </span>
          <span className="overline">Loading application</span>
        </div>
      </section>
    );
  }

  const [in1, in2] = state.inputs;
  const toU = (v: number, inp: AppInput) => (v - inp.low) / (inp.high - inp.low);
  const lastIds = new Set(result?.items.map((i) => i.id) ?? []);
  const points: P3[] = [
    ...state.sim_runs.map((r) => ({ u: r.u, v: r.v, kind: 'run' as const })),
    ...state.readings.map((r) => ({ u: r.u, v: r.v, kind: lastIds.has(r.id) ? ('pending' as const) : ('check' as const) })),
  ];
  const beacons: Beacon[] = [
    ...state.suggestions.map((s) => ({ u: s.u, v: s.v, state: 'open' as const })),
    ...(x ? [{ u: toU(x[0], in1), v: toU(x[1], in2), state: 'hit' as const }] : []),
  ];
  const marks: Mark[] = points.map((p) => ({ u: p.u, v: p.v, kind: p.kind }));
  const rings: Ring[] = [
    ...state.suggestions.map((s) => ({ u: s.u, v: s.v, state: 'open' as const })),
    ...(x ? [{ u: toU(x[0], in1), v: toU(x[1], in2), state: 'hit' as const }] : []),
  ];

  const useSuggestion = (p: AppPoint | { x1: number; x2: number }) => setForm({ x1: String(round(p.x1, in1)), x2: String(round(p.x2, in2)), value: '' });

  return (
    <section className="app-section" style={{ ['--h' as string]: state.hue }} aria-labelledby={`app-${appKey}`}>
      <header className="app-head rise">
        <span className="app-head-glyph">
          <AppGlyph app={appKey} size={52} />
        </span>
        <div className="app-head-copy">
          <h2 id={`app-${appKey}`}>{state.name}</h2>
          <p className="muted">{state.description}</p>
        </div>
        <div className="app-head-side">
          <StatusChip app={state} />
          <span className="pill mono">model v{state.version}</span>
          <button className="btn" type="button" disabled={training} onClick={() => api.trainApp(appKey).then(() => refresh()).catch((e: Error) => setError(e.message))}>
            <ResetIcon size={15} />
            Retrain from scratch
          </button>
        </div>
      </header>
      <ErrorNote message={error} />

      <div className="app-grid main">
        {/* ---------- stage ---------- */}
        <Panel className="hero beam rise app-stage" style={{ ['--i' as string]: 1 }} label={`${state.name} forecast surface`}>
          <div className="hero-head">
            <span className="panel-title">
              {state.output_label} surface · {state.output_unit}
            </span>
            <div className="tabs" role="tablist" aria-label="View">
              <button className="tab" role="tab" type="button" aria-selected={view === '3d'} onClick={() => setView('3d')}>
                3D
              </button>
              <button className="tab" role="tab" type="button" aria-selected={view === '2d'} onClick={() => setView('2d')}>
                Map
              </button>
            </div>
            {view === '3d' && (
              <div className="toolbar" role="toolbar" aria-label="3D view">
                <button className={`tool${spin ? ' on' : ''}`} type="button" aria-pressed={spin} title="Auto-rotate" aria-label="Auto-rotate" onClick={() => setSpin((s) => !s)}>
                  <RotateIcon size={16} />
                </button>
                <button className="tool" type="button" title="Zoom in" aria-label="Zoom in" onClick={() => stage.current?.zoom(0.85)}>
                  <PlusIcon size={16} />
                </button>
                <button className="tool" type="button" title="Reset view" aria-label="Reset view" onClick={() => stage.current?.resetView()}>
                  <ResetIcon size={16} />
                </button>
                <button
                  className="tool"
                  type="button"
                  title="Save a snapshot"
                  aria-label="Save a snapshot"
                  onClick={() => {
                    const url = stage.current?.snapshot();
                    if (!url) return;
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${appKey}-v${state.version}.png`;
                    a.click();
                  }}
                >
                  <CameraIcon size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="stage app-stage-body">
            {view === '3d' ? (
              <Surface3D
                ref={stage}
                z={z}
                grid={state.grid}
                lo={lo}
                hi={hi}
                gamma={gamma}
                tint={changeTint}
                points={points}
                pointsKey={appKey}
                beacons={beacons}
                autoRotate={spin}
                label={`${state.output_label} predicted over ${in1.label.toLowerCase()} and ${in2.label.toLowerCase()}, with the reference runs and field readings`}
              />
            ) : (
              <div className="app-map">
                <FieldMap
                  z={z}
                  grid={state.grid}
                  lo={lo}
                  hi={hi}
                  gamma={gamma}
                  marks={marks}
                  rings={rings}
                  label={`Map of ${state.output_label} over ${in1.label} and ${in2.label}`}
                  axes={{ x: [in1.low, in1.high], y: [in2.low, in2.high], xName: in1.label, yName: in2.label, zName: state.output_label }}
                />
              </div>
            )}
            <div className="stage-vignette" aria-hidden="true" />
            <div className="stage-legend">
              <span className="overline">{changeTint ? 'What changed' : `${state.output_label} (${state.output_unit})`}</span>
              <div className="scale">
                <span className="scale-bar" style={{ background: changeTint ? 'linear-gradient(to top, #0a0e1e, #481e96, #c828b4, #ff783c, #fff0c8)' : OUTPUT_GRADIENT }} />
                <span className="scale-ticks mono">
                  {changeTint ? (
                    <>
                      <span>most</span>
                      <span />
                      <span />
                      <span>none</span>
                    </>
                  ) : (
                    <>
                      <span>{z ? outLabel(hi) : '–'}</span>
                      <span>{z ? outLabel(lo + (hi - lo) * 0.66) : '–'}</span>
                      <span>{z ? outLabel(lo + (hi - lo) * 0.33) : '–'}</span>
                      <span>{z ? outLabel(lo) : '–'}</span>
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="axis-chips" aria-hidden="true">
              <span>
                <ArrowIcon size={12} /> {in1.label}
              </span>
              <span className="y">
                <ArrowIcon size={12} /> {in2.label}
              </span>
            </div>
            <div className="app-legend-pts small">
              <span>
                <i className="dot run" /> {state.reference_name} runs <b className="mono">{state.runs}</b>
              </span>
              <span>
                <i className="dot read" /> Field readings <b className="mono">{state.observations}</b>
              </span>
              <span>
                <i className="dot sug" /> Measure next
              </span>
              <span>
                <i className="dot q" /> Your query
              </span>
            </div>
            {training && (
              <div className="train-overlay" role="status">
                <span className="overline">
                  <LiveDot tone="info" /> Verify is learning
                </span>
                <b className="mono">
                  {state.runs} <small>/ {state.budget} runs</small>
                </b>
                <span className="track">
                  <i style={{ transform: `scaleX(${Math.min(1, state.runs / state.budget)})` }} />
                </span>
                <span className="small muted">Choosing which {state.reference_name.toLowerCase()} runs to buy next</span>
              </div>
            )}
          </div>
        </Panel>

        {/* ---------- predictor ---------- */}
        <Predictor state={state} x={x} setX={setX} onUseAsReading={(p) => setForm({ x1: String(round(p.x1, in1)), x2: String(round(p.x2, in2)), value: outLabel(p.value) })} />
      </div>

      <div className="app-grid two">
        <AddData state={state} form={form} setForm={setForm} onRetrained={onRetrained} />
        <RetrainResult state={state} result={result} onUse={useSuggestion} />
      </div>

      <ModelPanel appKey={appKey} name={state.name} />

      <div className="app-grid three">
        <Panel title={<><ChartIcon size={14} /> Learning curve</>} className="rise" style={{ ['--i' as string]: 2 }}>
          <LearningCurve state={state} />
        </Panel>
        <Panel title={<><GaugeIcon size={14} /> Stop rule</>} aside={state.stop?.ready ? <span className="pill ready">Passed</span> : <span className="pill">Checking</span>} className="rise" style={{ ['--i' as string]: 3 }}>
          <StopRule stop={state.stop} show={(m) => `${outLabel(m)} ${state.output_unit}`} />
          <p className="small muted rule-note">The learner stops buying {state.reference_name.toLowerCase()} runs only when all three pass. No ground truth is used.</p>
        </Panel>
        <Panel title={<><TargetIcon size={14} /> Insights</>} className="rise" style={{ ['--i' as string]: 4 }}>
          <Insights state={state} onInspect={(a, b) => setX([a, b])} />
        </Panel>
      </div>

      <Readings state={state} onChanged={() => void refresh()} setError={setError} />
    </section>
  );
}

function round(v: number, inp: AppInput): number {
  if (inp.fmt === 'weekday') return Math.round(v);
  if (inp.fmt === 'doy') return Math.round(v);
  return Math.round(v * 100) / 100;
}

/* ====================================================================== predictor */
function InputControl({ input, value, onChange, id }: { input: AppInput; value: number; onChange: (v: number) => void; id: string }) {
  if (input.fmt === 'weekday')
    return (
      <Segmented
        id={id}
        label={input.label}
        value={Math.round(value)}
        compact
        options={WEEKDAYS.map((d, i) => ({ value: i, label: d }))}
        onChange={(v) => onChange(v)}
      />
    );
  const f = (value - input.low) / (input.high - input.low);
  return (
    <label className="slider-field" htmlFor={id}>
      <span className="slider-top">
        <span className="overline">{input.label}</span>
        <b className="mono">{inputLabel(input, value)}</b>
      </span>
      <input
        id={id}
        className="range"
        type="range"
        min={input.low}
        max={input.high}
        step={input.step}
        value={value}
        style={{ ['--f' as string]: f }}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={inputLabel(input, value)}
      />
      <span className="slider-ends mono">
        <span>{inputLabel(input, input.low)}</span>
        <span>{inputLabel(input, input.high)}</span>
      </span>
    </label>
  );
}

function Predictor({
  state,
  x,
  setX,
  onUseAsReading,
}: {
  state: AppState;
  x: [number, number] | null;
  setX: (x: [number, number]) => void;
  onUseAsReading: (p: AppPrediction) => void;
}) {
  const [pred, setPred] = useState<AppPrediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [in1, in2] = state.inputs;
  const ready = state.z != null;

  useEffect(() => {
    if (!x || !ready) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .predict(state.key, x[0], x[1], ctl.signal)
        .then((p) => {
          setPred(p);
          setError(null);
        })
        .catch((e: Error) => e.name !== 'AbortError' && setError(e.message));
    }, 80);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [x?.[0], x?.[1], state.version, ready, state.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const color = pred?.band.color ?? 'var(--cyan)';
  const mult = (inp: AppInput) => (inp.fmt === 'doy' ? 10 : 1);
  const unitLabel = (inp: AppInput) => (inp.fmt === 'doy' ? '+10 days' : perUnit(inp));

  return (
    <Panel
      className="predictor rise"
      style={{ ['--i' as string]: 2, ['--band' as string]: color }}
      title={
        <>
          <BoltIcon size={14} /> Live forecast
        </>
      }
      aside={pred ? <span className="mono small muted">{pred.micros < 1000 ? `${pred.micros.toFixed(0)} µs` : `${(pred.micros / 1000).toFixed(1)} ms`}</span> : null}
    >
      {!ready || !x ? (
        <div className="pred-wait">
          <span className="boot-bar">
            <i />
          </span>
          <p className="small muted">The forecast opens once the first reference runs are in.</p>
        </div>
      ) : (
        <>
          <div className="pred-inputs">
            <InputControl id={`${state.key}-x1`} input={in1} value={x[0]} onChange={(v) => setX([v, x[1]])} />
            <InputControl id={`${state.key}-x2`} input={in2} value={x[1]} onChange={(v) => setX([x[0], v])} />
          </div>
          <div className="chips scenario-chips" role="group" aria-label="Example scenarios">
            {state.examples.map((e) => (
              <button key={e.label} type="button" className="chip" aria-pressed={x[0] === e.x1 && x[1] === e.x2} onClick={() => setX([e.x1, e.x2])}>
                {e.label}
              </button>
            ))}
          </div>

          <div className="pred-hero" aria-live="polite">
            <div className="pred-orb" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="pred-read">
              <span className="overline">{state.output_label}</span>
              <span className="pred-value mono">
                <Num value={pred?.value} format={outLabel} ms={500} />
                <small>{state.output_unit}</small>
              </span>
              {pred && (
                <span className="small muted mono">
                  95% range {outLabel(pred.low)}–{outLabel(pred.high)}
                </span>
              )}
            </div>
            {pred && (
              <span className="band-chip" style={{ color: pred.band.color, borderColor: pred.band.color }}>
                {pred.band.label}
              </span>
            )}
          </div>
          {pred && <p className="pred-advice">{pred.band.advice}</p>}
          <BandScale bands={state.bands} value={pred?.value ?? null} />

          {pred && (
            <>
              <dl className="pred-details">
                {pred.details.map((d) => (
                  <div key={d.label}>
                    <dt>{d.label}</dt>
                    <dd className="mono">{d.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="pred-sens">
                <span className="overline">What moves it</span>
                {[in1, in2].map((inp, i) => {
                  const s = pred.sensitivity[i] * mult(inp);
                  return (
                    <span key={inp.key} className="sens-row">
                      <span>
                        {unitLabel(inp)} {inp.label.toLowerCase()}
                      </span>
                      <b className={`mono ${s > 0 ? 'up' : 'down'}`}>
                        {s >= 0 ? '+' : '−'}
                        {outLabel(Math.abs(s))} {state.output_unit}
                      </b>
                    </span>
                  );
                })}
              </div>
              <div className="pred-check">
                <span>
                  <CpuIcon size={13} /> {state.reference_name} says <b className="mono">{outLabel(pred.reference)}</b>
                </span>
                <span className={`mono ${Math.abs(pred.error) <= (pred.high - pred.low) / 2 ? 'ok' : 'off'}`}>
                  error {pred.error >= 0 ? '+' : '−'}
                  {outLabel(Math.abs(pred.error))}
                </span>
              </div>
              <button className="btn block" type="button" onClick={() => onUseAsReading(pred)}>
                <PlusIcon size={15} /> Report a reading at this point
              </button>
            </>
          )}
          <ErrorNote message={error} />
        </>
      )}
    </Panel>
  );
}

/* ====================================================================== add data */
type Tab = 'single' | 'csv' | 'feed';
const MAX_BATCH = 500; // the API accepts up to 500 readings per request

function AddData({
  state,
  form,
  setForm,
  onRetrained,
}: {
  state: AppState;
  form: { x1: string; x2: string; value: string } | null;
  setForm: (f: { x1: string; x2: string; value: string }) => void;
  onRetrained: (r: AppRetrain) => void;
}) {
  const [in1, in2] = state.inputs;
  const [tab, setTab] = useState<Tab>('single');
  const [kind, setKind] = useState<'sensor' | 'verified'>('sensor');
  const [csv, setCsv] = useState('');
  const [csvName, setCsvName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState(false);
  const [feedLog, setFeedLog] = useState<AppRetrain['items']>([]);
  const inFlight = useRef(false);
  const f = form ?? { x1: '', x2: '', value: '' };
  const ready = state.z != null;

  useEffect(() => {
    if (form) setTab('single');
  }, [form]);

  // live sensor feed: a simulated reading every couple of seconds, each one retraining the model
  useEffect(() => {
    if (!feed || !ready) return;
    const tick = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      api
        .sampleReadings(state.key, 1, 'feed')
        .then((r) => {
          onRetrained(r);
          setFeedLog((log) => [...r.items, ...log].slice(0, 7));
        })
        .catch((e: Error) => {
          setError(e.message);
          setFeed(false);
        })
        .finally(() => (inFlight.current = false));
    };
    tick();
    const t = setInterval(tick, 2200);
    return () => clearInterval(t);
  }, [feed, ready, state.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (readings: AppReadingIn[], source: 'manual' | 'csv') => {
    setBusy(true);
    setError(null);
    try {
      onRetrained(await api.addReadings(state.key, readings, source));
      if (source === 'csv') {
        setCsv('');
        setCsvName(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // a file from disk goes into the same box, so it can be checked (and edited) before it is added
  const onCsvFile = async (file: File | undefined, input: HTMLInputElement) => {
    input.value = ''; // picking the same file again still fires a change
    if (!file) return;
    setError(null);
    try {
      setCsv(await file.text());
      setCsvName(file.name);
    } catch {
      setError(`Could not read ${file.name}.`);
    }
  };

  const onSingle = (ev: FormEvent) => {
    ev.preventDefault();
    const r = { x1: Number(f.x1), x2: Number(f.x2), value: Number(f.value), kind };
    if (![r.x1, r.x2, r.value].every((n) => Number.isFinite(n)) || f.x1 === '' || f.x2 === '' || f.value === '') {
      setError('Fill in both inputs and the measured value.');
      return;
    }
    void submit([r], 'manual');
  };

  const fillSimulated = async () => {
    const pick = (inp: AppInput) => {
      const v = inp.low + Math.random() * (inp.high - inp.low);
      return inp.fmt === 'weekday' || inp.fmt === 'doy' ? Math.round(v) : Math.round(v * 4) / 4;
    };
    const a = pick(in1);
    const b = pick(in2);
    try {
      const p = await api.predict(state.key, a, b);
      const noisy = p.reference * (1 + 0.06 * gauss()) + gauss();
      setForm({ x1: String(a), x2: String(b), value: outLabel(noisy) });
      setKind('sensor');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const csvPlaceholder = [
    `# ${in1.key}, ${in2.key}, ${state.output_label} [, verified]`,
    ...state.examples.map((e, i) => `${e.x1}, ${e.x2}, ${[42, 18.5, 27][i] ?? 30}${i === 1 ? ', verified' : ''}`),
  ].join('\n');

  const hint = (inp: AppInput, raw: string) => {
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return `${inp.low}–${inp.high}${inp.unit ? ` ${inp.unit}` : ''}`;
    if (n < inp.low || n > inp.high) return 'outside the model range';
    return inputLabel(inp, n);
  };

  return (
    <Panel
      className="add-data rise"
      style={{ ['--i' as string]: 3 }}
      title={
        <>
          <PlusIcon size={14} /> Add new data
        </>
      }
      aside={<span className="small muted">the model retrains instantly</span>}
    >
      <div className="tabs add-tabs" role="tablist" aria-label="How to add data">
        {(
          [
            ['single', 'One reading'],
            ['csv', 'Paste CSV'],
            ['feed', 'Live sensors'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className="tab" role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === 'feed' && feed && <LiveDot tone="good" />}
            {label}
          </button>
        ))}
      </div>

      {tab === 'single' && (
        <form className="form add-form" onSubmit={onSingle}>
          <div className="row3">
            <label>
              {in1.label}
              <input className="num-input" inputMode="decimal" value={f.x1} placeholder={String(in1.low)} onChange={(e) => setForm({ ...f, x1: e.target.value })} />
              <span className="hint">{hint(in1, f.x1)}</span>
            </label>
            <label>
              {in2.label}
              <input className="num-input" inputMode="decimal" value={f.x2} placeholder={String(in2.low)} onChange={(e) => setForm({ ...f, x2: e.target.value })} />
              <span className="hint">{hint(in2, f.x2)}</span>
            </label>
            <label>
              Measured {state.output_label}
              <input className="num-input" inputMode="decimal" value={f.value} placeholder={state.output_unit} onChange={(e) => setForm({ ...f, value: e.target.value })} />
              <span className="hint">{state.output_unit}</span>
            </label>
          </div>
          <Segmented
            id={`${state.key}-kind`}
            label="Reading type"
            value={kind}
            options={[
              { value: 'sensor', label: 'Field sensor (noisy)' },
              { value: 'verified', label: 'Verified (exact)' },
            ]}
            onChange={setKind}
          />
          <div className="btn-row">
            <button className="btn primary glow" type="submit" disabled={busy || !ready}>
              <BoltIcon size={15} />
              {busy ? 'Retraining…' : 'Add & retrain'}
            </button>
            <button className="btn" type="button" disabled={!ready} onClick={() => void fillSimulated()}>
              <WaveIcon size={15} /> Fill with a simulated sensor reading
            </button>
          </div>
        </form>
      )}

      {tab === 'csv' && (
        <div className="form">
          <label>
            One reading per line: {in1.label.toLowerCase()}, {in2.label.toLowerCase()}, {state.output_label} and optionally <code>verified</code>
            <textarea className="csv-box mono" rows={6} value={csv} spellCheck={false} placeholder={csvPlaceholder} onChange={(e) => setCsv(e.target.value)} />
          </label>
          <label className="btn csv-file">
            <FileIcon size={14} /> {csvName ? `Loaded ${csvName}` : 'Choose a .csv file'}
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onCsvFile(e.target.files?.[0], e.target)} />
          </label>
          <div className="csv-meta small">
            <span>
              <FileIcon size={13} /> {parsed.rows.length} reading{parsed.rows.length === 1 ? '' : 's'} ready
            </span>
            {parsed.rows.length > MAX_BATCH && <span className="danger-text">at most {MAX_BATCH} readings per batch; split the file</span>}
            {parsed.errors.length > 0 && <span className="danger-text">{parsed.errors.slice(0, 2).join(' · ')}</span>}
          </div>
          <button className="btn primary" type="button" disabled={busy || !ready || parsed.rows.length === 0 || parsed.rows.length > MAX_BATCH} onClick={() => void submit(parsed.rows, 'csv')}>
            <BoltIcon size={15} /> {busy ? 'Retraining…' : `Add ${parsed.rows.length || ''} & retrain`}
          </button>
        </div>
      )}

      {tab === 'feed' && (
        <div className="feed">
          <p className="small muted">
            Simulates a network of field sensors: every two seconds a noisy reading arrives from a random {in1.label.toLowerCase()} and {in2.label.toLowerCase()}, and the
            model retrains on it. Watch the surface and the numbers move.
          </p>
          <button className={`btn ${feed ? '' : 'primary glow'}`} type="button" disabled={!ready} onClick={() => setFeed((v) => !v)}>
            {feed ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
            {feed ? 'Stop the feed' : 'Start the live feed'}
          </button>
          <ul className="feed-log" aria-live="polite">
            {feedLog.map((it) => (
              <li key={it.id}>
                <LiveDot tone={it.surprise ? 'warn' : 'good'} />
                <span className="mono">
                  {inputLabel(in1, it.x1)} · {inputLabel(in2, it.x2)}
                </span>
                <b className="mono">{outLabel(it.value)}</b>
                <span className="mono muted">
                  {outLabel(it.before)} <ArrowIcon size={11} /> {outLabel(it.after)}
                </span>
              </li>
            ))}
            {feedLog.length === 0 && <li className="muted small">No readings yet.</li>}
          </ul>
        </div>
      )}
      <ErrorNote message={error} />
    </Panel>
  );
}

/* ====================================================================== retrain result */
function Delta({ before, after, better, fmt }: { before: number | null; after: number | null; better: 'up' | 'down'; fmt: (v: number) => string }) {
  if (before == null || after == null) return <span className="mono">–</span>;
  const diff = after - before;
  const good = better === 'up' ? diff >= 0 : diff <= 0;
  return (
    <span className="delta mono">
      {fmt(before)} <ArrowIcon size={11} /> <b>{fmt(after)}</b>
      {Math.abs(diff) > 1e-9 && <em className={good ? 'up' : 'down'}>{good ? '▲' : '▼'}</em>}
    </span>
  );
}

function RetrainResult({ state, result, onUse }: { state: AppState; result: AppRetrain | null; onUse: (p: AppPoint) => void }) {
  const [in1, in2] = state.inputs;
  const suggestions = result?.suggestions ?? state.suggestions;
  return (
    <Panel
      className="retrain rise"
      style={{ ['--i' as string]: 4 }}
      title={
        <>
          <ActivityIcon size={14} /> Retrain output
        </>
      }
      aside={result ? <span className="pill mono">v{result.version} · {result.retrain_ms.toFixed(1)} ms</span> : null}
    >
      {!result ? (
        <ol className="how">
          <li>
            <b>Enter a reading</b> you measured, or let the simulated sensors send one.
          </li>
          <li>
            <b>The model retrains</b> in milliseconds: a field sensor pulls the surface towards it, a verified reading pins it exactly.
          </li>
          <li>
            <b>See the before and after</b> here, and the surface lights up where it changed.
          </li>
        </ol>
      ) : (
        <div className="retrain-body" key={result.version}>
          <ul className="retrain-items">
            {result.items.slice(0, 4).map((it) => (
              <li key={it.id} className={it.surprise ? 'surprise' : ''}>
                <span className="ri-where mono">
                  {inputLabel(in1, it.x1)} · {inputLabel(in2, it.x2)}
                </span>
                <span className="ri-flow">
                  <span>
                    <small>before</small>
                    <b className="mono">{outLabel(it.before)}</b>
                  </span>
                  <ArrowIcon size={14} />
                  <span className="reading">
                    <small>reading</small>
                    <b className="mono">{outLabel(it.value)}</b>
                  </span>
                  <ArrowIcon size={14} />
                  <span className="after">
                    <small>after</small>
                    <b className="mono">{outLabel(it.after)}</b>
                  </span>
                </span>
                <span className={`ri-verdict small ${it.surprise ? 'warn' : 'ok'}`}>
                  {it.surprise
                    ? `Surprise: the model was off by ${outLabel(Math.abs(it.value - it.before))} (tolerance ±${outLabel(it.tolerance)}). It bent to fit.`
                    : `As expected: within ±${outLabel(it.tolerance)} ${state.output_unit}${it.tolerance > result.allowed_miss ? ', allowing for sensor noise' : ''}.`}
                </span>
              </li>
            ))}
            {result.items.length > 4 && <li className="small muted">and {result.items.length - 4} more</li>}
          </ul>
          <dl className="retrain-metrics">
            <div>
              <dt>Accuracy (R²) vs {state.reference_name.toLowerCase()}</dt>
              <dd>
                <Delta before={result.metrics_before.r2} after={result.metrics_after.r2} better="up" fmt={(v) => pctR2(v)} />
              </dd>
            </div>
            <div>
              <dt>RMSE ({state.output_unit})</dt>
              <dd>
                <Delta before={result.metrics_before.rmse} after={result.metrics_after.rmse} better="down" fmt={(v) => v.toFixed(2)} />
              </dd>
            </div>
            <div>
              <dt>Largest shift of the surface</dt>
              <dd className="mono">
                {outLabel(result.max_shift)} {state.output_unit}
              </dd>
            </div>
          </dl>
          <p className="small muted">
            Accuracy is measured against the {state.reference_name.toLowerCase()}. Readings that disagree with it (a local event, a faulty sensor) lower it, which is the
            honest outcome.
          </p>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="next-pts">
          <span className="overline">Where to measure next</span>
          <ul>
            {suggestions.map((s, i) => (
              <li key={`${s.u}-${s.v}-${i}`}>
                <i className="dot sug" aria-hidden="true" />
                <span className="mono">
                  {inputLabel(in1, s.x1)} · {inputLabel(in2, s.x2)}
                </span>
                <span className="small muted">{REASON[s.reason] ?? s.reason}</span>
                <button className="link-btn" type="button" onClick={() => onUse(s)}>
                  Use
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ====================================================================== telemetry */
function LearningCurve({ state }: { state: AppState }) {
  const h = state.history;
  if (h.length < 2) return <p className="small muted">The curve appears after the first fits.</p>;
  const top = Math.max(...h.map((p) => p.rmse)) * 1.08 || 1;
  const ready = h.find((p) => p.ready);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: f * top, label: (f * top).toFixed(top < 5 ? 1 : 0) }));
  return (
    <>
      <LineChart
        aria={`Error of the ${state.name.toLowerCase()} surrogate against the reference model, by number of reference runs`}
        xMax={Math.max(state.budget, h[h.length - 1].runs)}
        xLabel="reference runs"
        series={[{ key: 'rmse', label: 'RMSE', color: 'var(--s-verify)', pts: h.map((p) => ({ x: p.runs, y: p.rmse })) }]}
        scale={{ type: 'linear', min: 0, max: top }}
        ticks={ticks}
        fmt={(v) => `${v.toFixed(2)} ${state.output_unit}`}
        mark={ready ? { x: ready.runs, label: 'stop', color: 'var(--good)' } : null}
      />
      <div className="curve-foot small">
        <span>
          R² <b className="mono">{pctR2(state.metrics.r2)}</b>
        </span>
        <span>
          typical miss <b className="mono">{state.metrics.typical_miss != null ? `±${outLabel(state.metrics.typical_miss)}` : '–'}</b>
        </span>
        <span>
          trained in <b className="mono">{state.train_ms != null ? `${(state.train_ms / 1000).toFixed(1)} s` : '…'}</b>
        </span>
      </div>
    </>
  );
}

function Insights({ state, onInspect }: { state: AppState; onInspect: (x1: number, x2: number) => void }) {
  const [in1, in2] = state.inputs;
  if (!state.features.length) return <p className="small muted">Peaks and lows appear once the surface takes shape.</p>;
  return (
    <ul className="insights">
      {state.features.slice(0, 6).map((f, i) => (
        <li key={i} style={{ ['--i' as string]: i }}>
          <span className={`ins-kind ${f.kind}`}>{f.kind === 'max' ? '▲' : '▼'}</span>
          <span className="ins-body">
            <b>
              {f.kind === 'max' ? 'Peak' : 'Low'} {outLabel(f.value)} {state.output_unit}
            </b>
            <span className="small muted mono">
              {inputLabel(in1, f.x1)} · {inputLabel(in2, f.x2)}
            </span>
          </span>
          <button className="link-btn" type="button" onClick={() => onInspect(round(f.x1, in1), round(f.x2, in2))}>
            Inspect
          </button>
        </li>
      ))}
    </ul>
  );
}

function Readings({ state, onChanged, setError }: { state: AppState; onChanged: () => void; setError: (m: string | null) => void }) {
  const [in1, in2] = state.inputs;
  const del = (id: number) =>
    api
      .deleteReading(state.key, id)
      .then(onChanged)
      .catch((e: Error) => setError(e.message));
  const clear = () =>
    api
      .clearReadings(state.key)
      .then(onChanged)
      .catch((e: Error) => setError(e.message));
  return (
    <Panel
      className="rise"
      style={{ ['--i' as string]: 5 }}
      title={
        <>
          <FileIcon size={14} /> Field readings <span className="mono muted">{state.observations}</span>
        </>
      }
      aside={
        state.observations > 0 ? (
          <button className="btn sm" type="button" onClick={() => void clear()}>
            <TrashIcon size={14} /> Remove all
          </button>
        ) : null
      }
    >
      {state.readings.length === 0 ? (
        <p className="small muted">No readings yet. Everything the model knows comes from {state.runs} {state.reference_name.toLowerCase()} runs.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>{in1.label}</th>
                <th>{in2.label}</th>
                <th>Reading</th>
                <th>Model before</th>
                <th>Model now</th>
                <th>Type</th>
                <th>Source</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.readings.slice(0, 40).map((r, i) => (
                <tr key={r.id} style={{ ['--i' as string]: Math.min(i, 10) }}>
                  <td className="muted">{ago(r.created_at)}</td>
                  <td className="mono">{inputLabel(in1, r.x1)}</td>
                  <td className="mono">{inputLabel(in2, r.x2)}</td>
                  <td className="mono">
                    <b>{outLabel(r.value)}</b>
                  </td>
                  <td className="mono muted">{outLabel(r.before)}</td>
                  <td className="mono">{outLabel(r.now)}</td>
                  <td>
                    <span className={`pill ${r.kind === 'verified' ? 'ready' : ''}`}>{r.kind}</span>
                  </td>
                  <td className="muted">{r.source}</td>
                  <td>
                    <button className="icon-btn" type="button" aria-label={`Remove reading ${r.id}`} onClick={() => void del(r.id)}>
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
