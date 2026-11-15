import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, Flag, Gauge, LiveDot, MapLegend, Num, Panel, Segmented, Sparkline, Stepper, StopRule, Tile } from '../components/bits';
import { DepthChart, DepthLegend } from '../components/DepthChart';
import { FieldMap, type Mark, type Ring } from '../components/FieldMap';
import {
  ActivityIcon,
  CameraIcon,
  CheckIcon,
  CubeIcon,
  DiamondIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FlaskIcon,
  GaugeIcon,
  GhostIcon,
  MinusIcon,
  PlusIcon,
  ResetIcon,
  RotateIcon,
  RulerIcon,
  ShuffleIcon,
  SlidersIcon,
  TargetIcon,
  WaveIcon,
} from '../components/icons';
import { Legend, LineChart } from '../components/LineChart';
import { ALL_LAYERS, Surface3D, type Beacon, type Layers, type Surface3DHandle } from '../components/Surface3D';
import { decodeGrid, displayGamma, ERROR_GRADIENT, errorField, OUTPUT_GRADIENT } from '../lib/field';
import { num, pct } from '../lib/format';
import { KIND_NAME, KINDS, type Audit, type Kind, type RaceEvent, type Simulator, type Stop, type TruthEvent } from '../types';

interface LearnerView {
  n: number;
  z: Float32Array | null;
  marks: Mark[];
  audit: Audit | null;
  stop: Stop | null;
  depths: number[];
  doneAt: number | null;
  declaredAt: number | null;
  declaredCorrect: boolean | null;
  history: { n: number; captured: number; rmse: number }[];
}
interface RaceView {
  truth: (TruthEvent & { zArr: Float32Array; gamma: number }) | null;
  learners: Record<Kind, LearnerView>;
  finished: boolean;
  token: number;
}
type Source = 'truth' | Kind;

const blank = (): LearnerView => ({
  n: 0, z: null, marks: [], audit: null, stop: null, depths: [], doneAt: null, declaredAt: null,
  declaredCorrect: null, history: [],
}); // prettier-ignore
const fresh = (token: number): RaceView => ({ truth: null, learners: { random: blank(), chase: blank(), verify: blank() }, finished: false, token });

const COPY: Record<Kind, string> = {
  random: 'Buys runs anywhere on the map. The usual baseline.',
  chase: 'Sends an optimizer up and down the real simulator. Every step of the climb costs a run. Follows the 2024 paper, simplified.',
  verify: 'Finds peaks and valleys on its own free stand-in, then pays only to check them. Stops itself when three tests pass.',
};
const SOURCE_NAME: Record<Source, string> = { truth: 'Real simulator', ...KIND_NAME };
const LAYER_ROWS: [keyof Layers, string][] = [
  ['surface', 'Surface'],
  ['contours', 'Contour lines'],
  ['grid', 'Mesh grid'],
  ['runs', 'Paid runs'],
  ['features', 'Feature beacons'],
];

export function RacePage() {
  const [params] = useSearchParams();
  const sim = params.get('sim') ?? 'peaks';
  const [sims, setSims] = useState<Simulator[]>([]);
  const [tau, setTau] = useState(0.05);
  const [budgetPick, setBudget] = useState(360);
  const budget = sim === 'rastrigin' ? Math.max(480, budgetPick) : budgetPick;
  const [seed, setSeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Source>('verify');
  const [fieldMode, setFieldMode] = useState<'output' | 'error'>('output');
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS);
  const [spin, setSpin] = useState(true);
  const view = useRef<RaceView>(fresh(0));
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const frame = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const raceId = useRef<string | null>(null);
  const stage = useRef<Surface3DHandle>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  const onEvent = useCallback((ev: RaceEvent) => {
    const v = view.current;
    if (ev.type === 'truth') {
      const zArr = decodeGrid(ev.z);
      v.truth = { ...ev, zArr, gamma: displayGamma(zArr, ev.lo, ev.hi) };
      for (const k of KINDS) v.learners[k].marks = ev.init.map(([u, w]) => ({ u, v: w, kind: 'run' as const }));
    } else if (ev.type === 'step') {
      const l = v.learners[ev.kind];
      l.n = ev.n;
      l.z = decodeGrid(ev.z);
      l.marks = l.marks.concat(ev.points.map(([u, w, tag]) => ({ u, v: w, kind: tag === 'verify' ? ('check' as const) : ('run' as const) })));
      l.audit = ev.audit;
      l.doneAt = ev.done_at;
      l.declaredAt = ev.declared_at;
      l.declaredCorrect = ev.declared_correct;
      if (ev.stop) l.stop = ev.stop;
      if (ev.depths) l.depths = ev.depths;
      l.history.push({ n: ev.n, captured: ev.audit.captured, rmse: ev.audit.rmse });
    } else if (ev.type === 'done') v.finished = true;
    else if (ev.type === 'error') setError(`The race stopped on the server: ${ev.message}`);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(redraw);
  }, []);

  const start = useCallback(
    async (simulator: string, t: number, b: number, s: number) => {
      abort.current?.abort();
      if (raceId.current && !view.current.finished) api.cancelRace(raceId.current);
      raceId.current = null;
      const ctl = new AbortController();
      abort.current = ctl;
      view.current = fresh(view.current.token + 1);
      setError(null);
      setBusy(true);
      redraw();
      try {
        const race = await api.createRace({ simulator, tau: t, budget: b, seed: s }, ctl.signal);
        if (ctl.signal.aborted) {
          api.cancelRace(race.id);
          return;
        }
        raceId.current = race.id;
        await api.followRace(race.id, onEvent, ctl.signal);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      } finally {
        if (abort.current === ctl) setBusy(false);
      }
    },
    [onEvent],
  );

  useEffect(() => {
    api.simulators().then(setSims).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    void start(sim, tau, budget, seed);
    return () => {
      abort.current?.abort();
      if (raceId.current && !view.current.finished) api.cancelRace(raceId.current);
    };
  }, [sim, tau, budget, seed, start]);

  const v = view.current;
  const T = v.truth;
  const total = T?.features.length ?? 0;
  const simInfo = sims.find((s) => s.key === sim);
  const running = Boolean(T) && !v.finished;
  const lv = source === 'truth' ? null : v.learners[source];

  /* ---------- what the 3D stage shows ---------- */
  const stageZ = source === 'truth' ? (T?.zArr ?? null) : (lv?.z ?? null);
  const tint = useMemo(
    () => (fieldMode === 'error' && lv?.z && T ? errorField(lv.z, T.zArr, T.lo, T.hi) : null),
    [fieldMode, lv?.z, T],
  );
  const beacons = useMemo<Beacon[]>(() => {
    if (!T) return [];
    if (!lv) return T.features.map((f) => ({ u: f.u, v: f.v, state: 'plain' }));
    const a = lv.audit;
    const real: Beacon[] = T.features.map((f, i) => ({ u: f.u, v: f.v, state: a?.hit[i] ? 'hit' : 'open' }));
    return real.concat((a?.ghost_points ?? []).map(([u, w]) => ({ u, v: w, state: 'ghost' as const })));
  }, [T, lv, lv?.audit]);
  const stagePoints = source === 'truth' ? [] : (lv?.marks ?? []);

  const truthRings = useMemo<Ring[]>(() => (T ? T.features.map((f) => ({ u: f.u, v: f.v, state: 'plain' as const })) : []), [T]);
  const capTicks = useMemo(() => {
    const st = total <= 6 ? 1 : total <= 12 ? 2 : total <= 24 ? 4 : 10;
    const t = [];
    for (let i = 0; i <= total; i += st) t.push({ v: i, label: String(i) });
    if (total && t[t.length - 1].v !== total) t.push({ v: total, label: String(total) });
    return t;
  }, [total]);

  const ls = KINDS.map((k) => ({ k, l: v.learners[k] }));
  const done = ls.filter((x) => x.l.doneAt != null).sort((a, b) => a.l.doneAt! - b.l.doneAt!);
  const leader = done[0]?.k ?? [...ls].sort((a, b) => (b.l.audit?.captured ?? 0) - (a.l.audit?.captured ?? 0))[0].k;
  const nMin = Math.min(...ls.map((x) => x.l.n));
  const vs = v.learners.verify;
  const passed = vs.stop ? [vs.stop.features_checked, vs.stop.surprises_small, vs.stop.no_blind_spot].filter(Boolean).length : 0;

  const snapshot = () => {
    const url = stage.current?.snapshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `vdc-${sim}-${source}-seed${seed}.png`;
    a.click();
  };
  const focus = (s: Source) => {
    setSource(s);
    heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="page race-page">
      <header className="page-head rise">
        <div>
          <span className="eyebrow">
            <LiveDot on={busy && !v.finished} tone="info" />
            Live benchmark · {simInfo?.name ?? sim}
          </span>
          <h1>
            Three strategies, <span className="grad">one budget</span>
          </h1>
          <p className="lede">
            A crash test, a climate model or a nuclear-matter calculation can take hours for one run, so engineers train a fast stand-in from a handful of runs.{' '}
            <b>Watch which strategy finds every peak and valley first, and which one knows when to stop.</b>
          </p>
        </div>
      </header>

      <ErrorNote message={error} />

      <div className="race-top" ref={heroRef}>
        <Panel className="hero beam rise" style={{ ['--i' as string]: 1 }} label="3D view of the selected surface">
          <div className="hero-head">
            <span className="panel-title">Multi-strategy overview</span>
            <div className="tabs" role="tablist" aria-label="Surface to show">
              {(['truth', ...KINDS] as Source[]).map((s) => (
                <button
                  key={s}
                  role="tab"
                  type="button"
                  aria-selected={source === s}
                  className={`tab ${s}`}
                  onClick={() => setSource(s)}
                >
                  {s !== 'truth' && <i className="key" style={{ background: `var(--s-${s})` }} />}
                  {s === 'truth' ? 'Real' : KIND_NAME[s]}
                </button>
              ))}
            </div>
            <div className="toolbar" role="toolbar" aria-label="3D view">
              <button className={`tool${spin ? ' on' : ''}`} type="button" aria-pressed={spin} title="Auto-rotate" aria-label="Auto-rotate" onClick={() => setSpin((x) => !x)}>
                <RotateIcon size={16} />
              </button>
              <button className="tool" type="button" title="Zoom in" aria-label="Zoom in" onClick={() => stage.current?.zoom(0.85)}>
                <PlusIcon size={16} />
              </button>
              <button className="tool" type="button" title="Zoom out" aria-label="Zoom out" onClick={() => stage.current?.zoom(1.18)}>
                <MinusIcon size={16} />
              </button>
              <button className="tool" type="button" title="Reset view" aria-label="Reset view" onClick={() => stage.current?.resetView()}>
                <ResetIcon size={16} />
              </button>
              <button className="tool" type="button" title="Save a snapshot" aria-label="Save a snapshot" onClick={snapshot}>
                <CameraIcon size={16} />
              </button>
            </div>
          </div>

          <div className="stage">
            <Surface3D
              ref={stage}
              z={stageZ}
              grid={T?.grid ?? 49}
              lo={T?.lo ?? 0}
              hi={T?.hi ?? 1}
              gamma={T?.gamma ?? 1}
              tint={tint}
              points={stagePoints}
              pointsKey={`${v.token}-${source}`}
              beacons={beacons}
              layers={layers}
              autoRotate={spin}
              label={`${SOURCE_NAME[source]}: 3D surface${source === 'truth' ? '' : ' with the runs it bought'}`}
            />
            <div className="stage-vignette" aria-hidden="true" />
            <div className="stage-legend">
              <span className="overline">{tint ? 'Error vs real' : 'Output'}</span>
              <div className="scale">
                <span className="scale-bar" style={{ background: tint ? ERROR_GRADIENT : OUTPUT_GRADIENT }} />
                <span className="scale-ticks mono">
                  {tint ? (
                    <>
                      <span>25%+</span>
                      <span>6%</span>
                      <span>1.6%</span>
                      <span>0</span>
                    </>
                  ) : (
                    <>
                      <span>{num(T?.hi)}</span>
                      <span>{T ? num(T.lo + (T.hi - T.lo) * 0.66) : '–'}</span>
                      <span>{T ? num(T.lo + (T.hi - T.lo) * 0.33) : '–'}</span>
                      <span>{num(T?.lo)}</span>
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="stage-status" aria-label="Race status">
              <span className="overline">Race status</span>
              <span className={`status-big ${running ? 'run' : v.finished ? 'done' : 'wait'}`}>
                <LiveDot on={running || v.finished} tone={v.finished ? 'good' : 'info'} />
                {running ? 'Running' : v.finished ? 'Completed' : 'Starting'}
              </span>
              <dl className="kv mono">
                <dt>Simulator</dt>
                <dd>{simInfo?.name ?? sim}</dd>
                <dt>Seed</dt>
                <dd>{seed}</dd>
                <dt>Budget</dt>
                <dd>{budget}</dd>
                <dt>Runs</dt>
                <dd>
                  {nMin} / {budget}
                </dd>
                <dt>Leader</dt>
                <dd style={{ color: T ? `var(--s-${leader})` : undefined }}>{T ? KIND_NAME[leader] : '–'}</dd>
                <dt>Stop rule</dt>
                <dd>{passed} / 3</dd>
              </dl>
              <span className="overline">Convergence · rmse (log)</span>
              <Sparkline values={vs.history.map((h) => h.rmse)} log w={168} h={46} color="#2ff3a0" label="Verify's typical error over the race, log scale" />
            </div>

            <div className="stage-caption mono" aria-live="off">
              <span style={{ color: source === 'truth' ? '#9ec5ff' : `var(--s-${source})` }}>{SOURCE_NAME[source].toUpperCase()}</span>
              {source === 'truth' ? ' · ground truth, hidden from every learner' : ` · learned stand-in after ${lv?.n ?? 0} runs`}
              {tint && ' · coloured by error'}
            </div>

            <div className="stage-tiles">
              {lv ? (
                <>
                  <Tile icon={<TargetIcon size={18} />} label="Captured" accent={`var(--s-${source})`} progress={total ? (lv.audit?.captured ?? 0) / total : 0} unit={`/ ${total || '–'}`}>
                    <Num value={lv.audit?.captured ?? 0} />
                  </Tile>
                  <Tile icon={<ActivityIcon size={18} />} label="Runs bought" accent={`var(--s-${source})`} progress={lv.n / budget} unit={`/ ${budget}`}>
                    <Num value={lv.n} />
                  </Tile>
                  <Tile icon={<WaveIcon size={18} />} label="Typical error" unit="%">
                    <Num value={lv.audit ? lv.audit.rmse * 100 : null} format={(x) => x.toFixed(2)} />
                  </Tile>
                  <Tile icon={<DiamondIcon size={18} />} label="Error at features" unit="%">
                    <Num value={lv.audit ? lv.audit.at_features * 100 : null} format={(x) => x.toFixed(2)} />
                  </Tile>
                  <Tile icon={<GhostIcon size={18} />} label="Ghost features" tone={lv.audit && lv.audit.ghosts > 0 ? 'bad' : undefined}>
                    <Num value={lv.audit?.ghosts ?? null} />
                  </Tile>
                </>
              ) : (
                <>
                  <Tile icon={<TargetIcon size={18} />} label="Real features" accent="#9ec5ff">
                    <Num value={T ? total : null} />
                  </Tile>
                  <Tile icon={<RulerIcon size={18} />} label="Output range">
                    <Num value={T ? T.hi - T.lo : null} format={num} />
                  </Tile>
                  <Tile icon={<SlidersIcon size={18} />} label="Depth threshold" unit="%">
                    {Math.round(tau * 100)}
                  </Tile>
                  <Tile icon={<CubeIcon size={18} />} label="Grid" unit="nodes">
                    {T ? `${T.grid}×${T.grid}` : '–'}
                  </Tile>
                  <Tile icon={<FlaskIcon size={18} />} label="Budget each" unit="runs">
                    {budget}
                  </Tile>
                </>
              )}
            </div>
          </div>
        </Panel>

        <div className="right-col">
          <Panel title="Race settings" className="rise" style={{ ['--i' as string]: 2 }}>
            <p className="small muted sim-note">
              <b>{simInfo?.name ?? sim}.</b> {simInfo?.note ?? ''} <span className="only-wide">Pick another simulator in the sidebar.</span>
            </p>
            <Segmented
              id="tau"
              compact
              label="Ignore features shallower than"
              value={tau}
              options={[0.03, 0.05, 0.1].map((t) => ({ value: t, label: `${Math.round(t * 100)}%` }))}
              onChange={setTau}
            />
            <Segmented
              id="bud"
              compact
              label="Runs each strategy may buy"
              value={budget}
              options={[240, 360, 480].map((b) => ({ value: b, label: String(b), disabled: sim === 'rastrigin' && b < 480 }))}
              onChange={setBudget}
            />
            <div className="seed-row">
              <span className="mono small muted">seed {seed}</span>
              <button className="btn primary sm" type="button" onClick={() => setSeed((s) => s + 1)}>
                <ShuffleIcon size={14} />
                New starting points
              </button>
            </div>
          </Panel>

          <Panel title="Scene layers" className="rise" style={{ ['--i' as string]: 3 }}>
            <ul className="layer-list">
              {LAYER_ROWS.map(([k, name]) => (
                <li key={k}>
                  <button type="button" className={`layer${layers[k] ? ' on' : ''}`} aria-pressed={layers[k]} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>
                    <span className="layer-name">
                      <ChevronMini />
                      {name}
                    </span>
                    {layers[k] ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Result field" className="rise" style={{ ['--i' as string]: 4 }}>
            <div className="radio-list" role="radiogroup" aria-label="Colour the surface by">
              {(
                [
                  ['output', 'Output', <WaveIcon key="o" size={15} />],
                  ['error', 'Error vs real', <TargetIcon key="e" size={15} />],
                ] as const
              ).map(([k, name, ic]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={fieldMode === k}
                  disabled={k === 'error' && source === 'truth'}
                  className="radio"
                  onClick={() => setFieldMode(k)}
                >
                  <span className="radio-name">
                    {ic}
                    {name}
                  </span>
                  <i className="radio-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
            {source === 'truth' && <p className="small muted">Pick a strategy tab to compare its stand-in with the real surface.</p>}
            <button className="btn block export" type="button" onClick={snapshot}>
              <CameraIcon size={15} />
              Export snapshot
            </button>
          </Panel>
        </div>
      </div>

      <Stepper
        label="Race progress"
        steps={[
          { label: 'Setup', icon: <SlidersIcon size={18} />, state: 'done', hint: `${simInfo?.name ?? sim} · ${Math.round(tau * 100)}%` },
          { label: 'Race', icon: <CubeIcon size={18} />, state: v.finished ? 'done' : 'active', hint: T ? `run ${nMin} of ${budget}` : 'starting' },
          { label: 'Referee', icon: <GaugeIcon size={18} />, state: v.finished ? 'done' : 'todo', hint: 'every feature, no ghosts' },
          {
            label: 'Verdict',
            icon: <FileIcon size={18} />,
            state: v.finished ? (done.length ? 'done' : 'bad') : 'todo',
            hint: v.finished ? (done.length ? `${KIND_NAME[done[0].k]} first` : 'nobody finished') : 'pending',
          },
        ]}
      />

      <Scoreline view={v} budget={budget} busy={busy} />

      <section className="maps" aria-label="The simulator and three learners">
        <Panel
          as="article"
          className="inst rise"
          style={{ ['--i' as string]: 0 }}
          title={
            <>
              <i className="key" style={{ background: '#9ec5ff' }} />
              The real simulator
            </>
          }
          aside={
            <button className="link-btn" type="button" onClick={() => focus('truth')}>
              <CubeIcon size={14} /> 3D
            </button>
          }
        >
          <p className="small muted inst-copy">{simInfo?.note ?? ''} The learners never see this map; they only get the value at the points they pay for.</p>
          {simInfo?.kind === 'real' && (
            <p className="small muted inst-copy sim-source">
              Real data: {simInfo.inputs[0]} × {simInfo.inputs[1]} → {simInfo.output}. {simInfo.source}
            </p>
          )}
          <FieldMap z={T?.zArr ?? null} grid={T?.grid ?? 49} lo={T?.lo ?? 0} hi={T?.hi ?? 1} gamma={T?.gamma ?? 1} rings={truthRings} label="Map of the real simulator output" />
          <div className="cap">
            <span className="big">
              <Num value={T ? total : null} />
            </span>
            <span className="muted small">peaks and valleys deeper than {Math.round(tau * 100)}% of the range</span>
          </div>
        </Panel>
        {KINDS.map((k, i) => (
          <LearnerCard key={k} kind={k} l={v.learners[k]} truth={T} budget={budget} index={i + 1} onFocus={() => focus(k)} />
        ))}
      </section>

      <div className="legend-bar">
        <MapLegend />
      </div>

      <section className="reads" aria-label="Read-outs">
        <Panel title={<span className="mono-title">race/features_captured</span>} className="rise">
          <p className="small muted">Real peaks and valleys the stand-in reproduces, against runs bought.</p>
          <Legend items={KINDS.map((k) => ({ label: KIND_NAME[k], color: `var(--s-${k})` }))} />
          <LineChart
            key={`c${v.token}`}
            aria="Features captured against runs bought, one line per strategy"
            xMax={budget}
            xLabel="runs bought"
            scale={{ type: 'linear', min: 0, max: Math.max(1, total) }}
            ticks={capTicks}
            fmt={(x) => `${x} of ${total}`}
            mark={vs.declaredAt != null ? { x: vs.declaredAt, label: 'Verify stops itself', color: 'var(--s-verify)' } : null}
            series={KINDS.map((k) => ({ key: k, label: KIND_NAME[k], color: `var(--s-${k})`, pts: v.learners[k].history.map((h) => ({ x: h.n, y: h.captured })) }))}
          />
        </Panel>
        <Panel title={<span className="mono-title">race/rmse_log</span>} className="rise">
          <p className="small muted">Root-mean-square error as a share of the output range. Log scale; lower is better.</p>
          <Legend items={KINDS.map((k) => ({ label: KIND_NAME[k], color: `var(--s-${k})` }))} />
          <LineChart
            key={`e${v.token}`}
            aria="Typical error against runs bought, one line per strategy, log scale"
            xMax={budget}
            xLabel="runs bought"
            scale={{ type: 'log', min: 0.0003, max: 0.5 }}
            ticks={[0.001, 0.01, 0.1].map((x) => ({ v: x, label: `${x * 100}%` }))}
            fmt={(x) => pct(x, 2)}
            series={KINDS.map((k) => ({ key: k, label: KIND_NAME[k], color: `var(--s-${k})`, pts: v.learners[k].history.map((h) => ({ x: h.n, y: h.rmse })) }))}
          />
        </Panel>
        <Panel title={<span className="mono-title">verify/depth_profile</span>} className="rise">
          <p className="small muted">Depth as a share of the output range, deepest first. Verify is done when its dots sit inside the rings.</p>
          <DepthLegend withReal />
          <DepthChart
            real={T?.depths ?? null}
            mine={vs.depths}
            tau={tau}
            band={vs.stop?.worst_recent_miss != null ? 2 * vs.stop.worst_recent_miss : null}
          />
        </Panel>
      </section>
    </div>
  );
}

function ChevronMini() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 2l3.5 3L3 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Scoreline({ view, budget, busy }: { view: RaceView; budget: number; busy: boolean }) {
  const ls = KINDS.map((k) => ({ k, l: view.learners[k] }));
  const n = Math.min(...ls.map((x) => x.l.n));
  const total = view.truth?.features.length ?? 0;
  const best = Math.max(...ls.map((x) => x.l.audit?.captured ?? 0));
  const done = ls.filter((x) => x.l.doneAt != null).sort((a, b) => a.l.doneAt! - b.l.doneAt!);
  const winner = done[0]?.k ?? null;
  let text: JSX.Element;
  if (!view.truth) text = <span className="muted">{busy ? 'Starting the race on the server.' : 'No race is running.'}</span>;
  else if (!view.finished)
    text = winner ? (
      <>
        <b>{KIND_NAME[winner]} has every feature</b> after {done[0].l.doneAt} runs. The others are still buying.
      </>
    ) : (
      <>
        <b>No strategy has every feature yet.</b> Each has bought {n} of {budget} runs.
      </>
    );
  else {
    const not = ls.filter((x) => x.l.doneAt == null);
    text = done.length ? (
      <>
        <b>{KIND_NAME[done[0].k]} captured every feature first, after {done[0].l.doneAt} runs. </b>
        {done.length > 1 && `${done.slice(1).map((x) => `${KIND_NAME[x.k]} needed ${x.l.doneAt}`).join(', ')}. `}
        {not.length > 0 && `${not.map((x) => KIND_NAME[x.k]).join(' and ')} ${not.length > 1 ? 'were' : 'was'} still missing features after ${budget}.`}
      </>
    ) : (
      <b>Nobody captured every feature in {budget} runs. Try a larger budget or a coarser depth.</b>
    );
  }
  const running = Boolean(view.truth) && !view.finished;
  return (
    <section className="panel scoreboard rise" aria-label="Score">
      <div className="score-main">
        <div className="score-top">
          <span className={`live-chip${running ? ' running' : ''}`}>
            <LiveDot on={running} tone="info" />
            {running ? 'Race running' : view.finished ? 'Race finished' : 'Starting'}
          </span>
          <span className="mono small muted">
            run {n} / {budget}
          </span>
        </div>
        <p>{text}</p>
        <span className="sr-only" role="status">
          {view.finished ? text : ''}
        </span>
        <div className="track big" role="progressbar" aria-label="Runs bought" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={n}>
          <i style={{ transform: `scaleX(${Math.min(1, n / budget)})` }} />
        </div>
      </div>
      <ol className="lanes" aria-label="Features captured by each strategy">
        {ls.map(({ k, l }) => {
          const cap = l.audit?.captured ?? 0;
          const lead = winner ? winner === k : total > 0 && cap > 0 && cap === best;
          return (
            <li key={k} className={`lane${lead ? ' lead' : ''}`} style={{ ['--k' as string]: `var(--s-${k})` }}>
              <span className="lane-top">
                <i className="key" style={{ background: `var(--s-${k})` }} />
                {KIND_NAME[k]}
                {lead && <span className="pill lead-pill">Leading</span>}
              </span>
              <span className="lane-val">
                <Num value={cap} />
                <small> / {total || '–'}</small>
              </span>
              <div className="track" aria-hidden="true">
                <i style={{ transform: `scaleX(${total ? cap / total : 0})` }} />
              </div>
              {l.doneAt != null ? (
                <span className="lane-status good">
                  <CheckIcon size={13} />
                  all found at run {l.doneAt}
                </span>
              ) : l.n >= budget ? (
                <span className="lane-status bad">not finished in {budget}</span>
              ) : (
                <span className="lane-status">{l.n ? 'still learning' : 'waiting'}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function LearnerCard({ kind, l, truth, budget, index, onFocus }: {
  kind: Kind;
  l: LearnerView;
  truth: RaceView['truth'];
  budget: number;
  index: number;
  onFocus: () => void;
}) {
  const a = l.audit;
  const rings = useMemo<Ring[]>(
    () => (truth ? truth.features.map((f, i) => ({ u: f.u, v: f.v, state: a?.hit[i] ? ('hit' as const) : ('open' as const) })) : []),
    [truth, a],
  );
  const passed = l.stop ? [l.stop.features_checked, l.stop.surprises_small, l.stop.no_blind_spot].filter(Boolean).length : 0;
  return (
    <Panel
      as="article"
      className={`inst rise${kind === 'verify' ? ' ours' : ''}`}
      style={{ ['--i' as string]: index, ['--k' as string]: `var(--s-${kind})` }}
      title={
        <>
          <i className="key" style={{ background: `var(--s-${kind})` }} />
          {KIND_NAME[kind]}
          {kind === 'verify' && <span className="pill brand">This project</span>}
        </>
      }
      aside={
        <button className="link-btn" type="button" onClick={onFocus}>
          <CubeIcon size={14} /> 3D
        </button>
      }
    >
      <p className="small muted inst-copy">{COPY[kind]}</p>
      <FieldMap
        z={l.z}
        grid={truth?.grid ?? 49}
        lo={truth?.lo ?? 0}
        hi={truth?.hi ?? 1}
        gamma={truth?.gamma ?? 1}
        marks={l.marks}
        rings={rings}
        ghosts={a?.ghost_points}
        label={`${KIND_NAME[kind]} strategy: learned map and sampled points`}
      />
      <div className="cap">
        <span className="big" style={{ color: `var(--s-${kind})` }}>
          <Num value={a?.captured ?? 0} />
          <small> / {a?.total ?? truth?.features.length ?? '–'}</small>
        </span>
        <span className="muted small">features captured</span>
      </div>
      <div className="pips" aria-hidden="true">
        {Array.from({ length: a?.total ?? 0 }, (_, i) => (
          <i key={i} className={i < a!.captured ? 'on' : ''} />
        ))}
      </div>
      <dl className="stats">
        <dt>Ghost features</dt>
        <dd className={a && a.ghosts > 0 ? 'bad' : undefined}>{a?.ghosts ?? '–'}</dd>
        <dt>Typical error</dt>
        <dd>{a ? pct(a.rmse, 2) : '–'}</dd>
        <dt>Error at the real peaks and valleys</dt>
        <dd>{a ? pct(a.at_features, 2) : '–'}</dd>
        <dt>Runs bought</dt>
        <dd>{l.n || '–'}</dd>
      </dl>
      {l.doneAt != null ? (
        <Flag tone="good">Every feature captured, no ghosts, at run {l.doneAt}</Flag>
      ) : l.n >= budget ? (
        <Flag tone="bad">Not finished after {budget} runs</Flag>
      ) : (
        <Flag tone="wait">Still learning</Flag>
      )}
      {kind === 'verify' && (
        <div className="rule">
          <div className="rule-head">
            <Gauge value={passed / 3} label={`Stop rule: ${passed} of 3 tests passed`} size={112} from="#00d4ff" to="#2ff3a0">
              <span className="gauge-v">
                {passed}
                <small>/3</small>
              </span>
              <span className="overline">tests</span>
            </Gauge>
            <div>
              <h4>Its own stop rule</h4>
              <p className="small muted">Verify will only say stop when all three pass.</p>
            </div>
          </div>
          <StopRule stop={l.stop} show={(m) => pct(m, 2)} />
          {l.declaredAt != null ? (
            <Flag tone={l.declaredCorrect ? 'good' : 'bad'}>
              Declared itself done at run {l.declaredAt}. Referee:{' '}
              {l.declaredCorrect ? 'correct, every feature was there.' : 'too early, something was still missing.'}
            </Flag>
          ) : (
            <Flag tone="wait">{l.n >= budget ? 'It never declared itself done, so it would ask for more runs.' : 'Not ready to stop.'}</Flag>
          )}
        </div>
      )}
    </Panel>
  );
}
