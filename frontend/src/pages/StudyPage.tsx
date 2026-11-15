import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { CopyButton, ErrorNote, Flag, Gauge, LiveDot, MapLegend, Num, Panel, Stepper, StopRule, Tile } from '../components/bits';
import { DepthChart, DepthLegend } from '../components/DepthChart';
import { FieldMap, type Mark, type Ring } from '../components/FieldMap';
import {
  ActivityIcon,
  CameraIcon,
  CheckIcon,
  ChevronIcon,
  CubeIcon,
  DiamondIcon,
  FlaskIcon,
  HexIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ResetIcon,
  RotateIcon,
  SlidersIcon,
  TargetIcon,
  TrashIcon,
  WaveIcon,
} from '../components/icons';
import { Legend, LineChart } from '../components/LineChart';
import { Surface3D, type Beacon, type P3, type Surface3DHandle } from '../components/Surface3D';
import { decodeGrid, displayGamma, OUTPUT_GRADIENT } from '../lib/field';
import { num, pct } from '../lib/format';
import type { StudyState } from '../types';
import { StatusPill } from './StudiesPage';

const REASON: Record<string, string> = {
  init: 'opening run',
  explore: 'random test point',
  verify: 'checks a predicted feature',
  fill: 'fills the biggest blind spot',
  manual: 'your own point',
};

export function StudyPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<StudyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [spin, setSpin] = useState(true);
  const stage = useRef<Surface3DHandle>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const s = await api.state(id);
      if (alive.current) setState(s);
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError && e.status === 404 ? 'This study does not exist any more.' : (e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    setState(null);
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const autorun = state?.study.autorun ?? false;
  useEffect(() => {
    if (!autorun) return;
    const t = setInterval(() => void load(), 900);
    return () => clearInterval(t);
  }, [autorun, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const z = useMemo(() => (state?.z ? decodeGrid(state.z) : null), [state?.z]);
  const gamma = useMemo(() => (z && state?.z_min != null && state.z_max != null ? displayGamma(z, state.z_min, state.z_max) : 1), [z, state?.z_min, state?.z_max]);
  const marks = useMemo<Mark[]>(
    () => (state?.runs ?? []).map((r) => ({ u: r.u, v: r.v, kind: r.status === 'pending' ? 'pending' : r.reason === 'verify' ? 'check' : 'run' })),
    [state?.runs],
  );
  const points = marks as P3[];
  const rings = useMemo<Ring[]>(
    () => (state?.features ?? []).filter((f) => f.deep).map((f) => ({ u: f.u, v: f.v, state: f.checked ? 'hit' : 'open' })),
    [state?.features],
  );
  const beacons = useMemo<Beacon[]>(() => rings.map((r) => ({ u: r.u, v: r.v, state: r.state === 'hit' ? 'hit' : 'open' })), [rings]);

  if (!state) {
    return (
      <div className="page">
        <nav className="crumb" aria-label="Breadcrumb">
          <Link to="/studies">Studies</Link>
        </nav>
        <ErrorNote message={error} />
        {!error && (
          <div className="panel" aria-busy="true">
            <span className="sr-only">Loading the study.</span>
            <div className="skel" style={{ width: '34%', height: 30 }} />
            <div className="skel" style={{ width: '70%' }} />
            <div className="skel" style={{ width: '100%', height: 320 }} />
          </div>
        )}
      </div>
    );
  }

  const { study, stop, history } = state;
  const [a, b] = study.inputs;
  const pending = state.runs.filter((r) => r.status === 'pending');
  const range = state.z_max != null && state.z_min != null ? state.z_max - state.z_min : 0;
  const filled = pending.filter((r) => values[r.id]?.trim() && Number.isFinite(Number(values[r.id])));
  const worstMax = Math.max(1e-9, ...history.map((h) => Math.max(h.worst ?? 0, h.allowed)));
  const deep = state.features.filter((f) => f.deep);
  const deepChecked = deep.filter((f) => f.checked).length;
  const passed = stop ? [stop.features_checked, stop.surprises_small, stop.no_blind_spot].filter(Boolean).length : 0;
  const apiUrl = `${window.location.origin}/api/studies/${study.id}`;
  const lo = state.z_min ?? 0;
  const hi = state.z_max ?? 1;
  const snippet = `import requests

API = "${apiUrl}"

def simulate(${a.name}, ${b.name}):
    ...  # your expensive model goes here; return one number

while True:
    runs = requests.post(f"{API}/ask", json={"n": 6}).json()["suggestions"]
    if not runs:
        break
    results = [{"run_id": r["run_id"], "value": simulate(r["x1"], r["x2"])} for r in runs]
    stop = requests.post(f"{API}/tell", json={"results": results}).json()["stop"]
    if stop and stop["ready"]:
        break`;

  const snapshot = () => {
    const url = stage.current?.snapshot();
    if (!url) return;
    const el = document.createElement('a');
    el.href = url;
    el.download = `vdc-study-${study.id}.png`;
    el.click();
  };

  const st = study.status;
  return (
    <div className="page">
      <nav className="crumb rise" aria-label="Breadcrumb">
        <Link to="/studies">Studies</Link>
        <ChevronIcon size={13} />
        <span aria-current="page">{study.name}</span>
      </nav>
      <header className="page-head study-head rise">
        <div>
          <span className="eyebrow">
            <FlaskIcon size={13} />
            {study.demo_simulator ? `Built-in ${study.demo_simulator}` : 'Your simulator'} · seed {study.seed}
          </span>
          <h1>{study.name}</h1>
          <p className="muted">
            {a.name} from {num(a.low)} to {num(a.high)}, {b.name} from {num(b.low)} to {num(b.high)}. Ignores features shallower than{' '}
            {study.min_depth_abs != null ? `${num(study.min_depth_abs)} ${study.output_name}` : `${Math.round(study.min_depth_rel * 100)}% of the observed ${study.output_name} range`}.
          </p>
        </div>
        <div className="head-stats">
          {autorun && (
            <span className="live-chip running">
              <LiveDot tone="info" />
              Running itself
            </span>
          )}
          <StatusPill status={st} />
        </div>
      </header>
      <ErrorNote message={error} />

      <div className="race-top">
        <Panel className="hero beam rise" style={{ ['--i' as string]: 1 }} label="3D view of the current stand-in">
          <div className="hero-head">
            <span className="panel-title">Stand-in surface · {study.output_name}</span>
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
              z={z}
              grid={state.grid}
              lo={lo}
              hi={hi}
              gamma={gamma}
              points={points}
              pointsKey={study.id}
              beacons={beacons}
              autoRotate={spin}
              label="Current stand-in in 3D with the runs paid for so far"
            />
            <div className="stage-vignette" aria-hidden="true" />
            <div className="stage-legend">
              <span className="overline">{study.output_name}</span>
              <div className="scale">
                <span className="scale-bar" style={{ background: OUTPUT_GRADIENT }} />
                <span className="scale-ticks mono">
                  <span>{z ? num(hi) : '–'}</span>
                  <span>{z ? num(lo + (hi - lo) * 0.66) : '–'}</span>
                  <span>{z ? num(lo + (hi - lo) * 0.33) : '–'}</span>
                  <span>{z ? num(lo) : '–'}</span>
                </span>
              </div>
            </div>
            <div className="stage-status" aria-label="Study status">
              <span className="overline">Simulation status</span>
              <span className={`status-big ${st === 'ready' ? 'done' : st === 'out_of_budget' ? 'bad' : autorun ? 'run' : 'wait'}`}>
                <LiveDot on tone={st === 'ready' ? 'good' : st === 'out_of_budget' ? 'bad' : 'info'} />
                {st === 'ready' ? 'Ready' : st === 'out_of_budget' ? 'Out of budget' : autorun ? 'Running' : st === 'collecting' ? 'Collecting' : 'Learning'}
              </span>
              <dl className="kv mono">
                <dt>Solver</dt>
                <dd>Verify</dd>
                <dt>Runs</dt>
                <dd>{study.runs_done}</dd>
                <dt>Pending</dt>
                <dd>{pending.length}</dd>
                <dt>Features</dt>
                <dd>
                  {deepChecked} / {deep.length}
                </dd>
                <dt>Blind spot</dt>
                <dd>{stop ? pct(stop.largest_gap) : '–'}</dd>
                <dt>Declared at</dt>
                <dd>{study.declared_at ?? '–'}</dd>
              </dl>
            </div>
            {!z && (
              <div className="stage-empty">
                <HexIcon size={22} />
                <span>The first fit appears after 12 opening runs.</span>
              </div>
            )}
            <div className="stage-tiles four">
              <Tile icon={<ActivityIcon size={18} />} label="Runs reported" accent="#00d4ff" progress={study.runs_done / Math.max(1, study.max_runs)} unit={`/ ${study.max_runs}`}>
                <Num value={study.runs_done} />
              </Tile>
              <Tile icon={<TargetIcon size={18} />} label="Features checked" tone={stop?.features_checked ? 'good' : undefined} unit={`/ ${deep.length}`}>
                <Num value={deepChecked} />
              </Tile>
              <Tile icon={<WaveIcon size={18} />} label="Worst recent miss" tone={stop?.surprises_small ? 'good' : undefined} sub={stop ? `allowed ${num(stop.allowed_miss)}` : 'after the first fit'}>
                {num(stop?.worst_recent_miss)}
              </Tile>
              <Tile icon={<DiamondIcon size={18} />} label="Largest blind spot" tone={stop?.no_blind_spot ? 'good' : undefined} sub={stop ? `limit ${pct(stop.max_gap, 0)}` : 'after the first fit'}>
                {stop ? pct(stop.largest_gap) : '–'}
              </Tile>
            </div>
          </div>
        </Panel>

        <div className="right-col">
          <Panel title="Should you stop?" className="rise" style={{ ['--i' as string]: 2 }}>
            <div className="stop-gauge">
              <Gauge value={passed / 3} label={`${passed} of 3 stop tests passed`} size={150} from="#7c5cff" to={passed === 3 ? '#2ff3a0' : '#00d4ff'}>
                <span className="overline">Readiness</span>
                <span className="gauge-v">
                  {passed}
                  <small>/3</small>
                </span>
              </Gauge>
            </div>
            <StopRule stop={stop} show={(m) => `${num(m)} ${study.output_name}`} />
            {st === 'ready' ? (
              <Flag tone="good" boxed>
                All three tests passed at run {study.declared_at}. More runs are unlikely to reveal a new feature deeper than the threshold.
              </Flag>
            ) : st === 'out_of_budget' ? (
              <Flag tone="bad" boxed>
                The run budget is spent and the tests have not all passed. Treat the stand-in as unfinished.
              </Flag>
            ) : (
              <Flag tone="wait" boxed>
                Keep going. The tests have not all passed yet.
              </Flag>
            )}
            {stop?.notes.map((n) => (
              <p key={n} className="small muted">
                {n}
              </p>
            ))}
          </Panel>
        </div>
      </div>

      <Stepper
        label="Study progress"
        steps={[
          { label: 'Setup', icon: <SlidersIcon size={18} />, state: 'done', hint: `${a.name} × ${b.name}` },
          {
            label: 'Opening runs',
            icon: <HexIcon size={18} />,
            state: st === 'collecting' ? 'active' : 'done',
            hint: `${Math.min(12, study.runs_done)} of 12`,
          },
          {
            label: 'Hunt & verify',
            icon: <CubeIcon size={18} />,
            state: st === 'learning' ? 'active' : st === 'collecting' ? 'todo' : 'done',
            hint: deep.length ? `${deepChecked}/${deep.length} features checked` : 'after the first fit',
          },
          {
            label: 'Ready to stop',
            icon: <CheckIcon size={18} />,
            state: st === 'ready' ? 'done' : st === 'out_of_budget' ? 'bad' : 'todo',
            hint: st === 'ready' ? `at run ${study.declared_at}` : st === 'out_of_budget' ? 'budget spent' : `${passed}/3 tests`,
          },
        ]}
      />

      <div className="split wide-left">
        <Panel title="Next runs" className="rise">
          {study.demo_simulator ? (
            <>
              <p className="small muted">This study uses the built-in {study.demo_simulator} simulator, so the server can answer its own runs.</p>
              <div className="btn-row">
                {autorun ? (
                  <button className="btn" type="button" disabled={busy} onClick={() => act(() => api.stopAutorun(study.id))}>
                    <PauseIcon size={14} />
                    Pause
                  </button>
                ) : (
                  <button className="btn primary glow" type="button" disabled={busy || st === 'out_of_budget'} onClick={() => act(() => api.startAutorun(study.id))}>
                    <PlayIcon size={14} />
                    {st === 'ready' ? 'Keep running anyway' : 'Run until it says stop'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="small muted">Run these on your simulator and enter what came back, or let a script do it through the API.</p>
          )}
          {!autorun && (
            <>
              <div className="btn-row">
                <button
                  className="btn"
                  type="button"
                  disabled={busy || st === 'out_of_budget'}
                  onClick={() =>
                    act(async () => {
                      const r = await api.ask(study.id, 6);
                      if (r.message) setNote(r.message);
                    })
                  }
                >
                  <TargetIcon size={15} />
                  Suggest 6 more runs
                </button>
                {pending.length > 0 && (
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy || filled.length === 0}
                    onClick={() =>
                      act(async () => {
                        await api.tell(study.id, filled.map((r) => ({ run_id: r.id, value: Number(values[r.id]) })));
                        setValues({});
                      })
                    }
                  >
                    Report {filled.length || ''} result{filled.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              {note && <p className="small muted">{note}</p>}
              {pending.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="r">{a.name}</th>
                        <th className="r">{b.name}</th>
                        <th>Why</th>
                        <th className="r">Expected</th>
                        <th>{study.output_name}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((r, i) => (
                        <tr key={r.id} style={{ ['--i' as string]: i }}>
                          <td className="r mono">{num(r.x1)}</td>
                          <td className="r mono">{num(r.x2)}</td>
                          <td className="muted">
                            <span className={`reason ${r.reason}`}>{REASON[r.reason] ?? r.reason}</span>
                          </td>
                          <td className="r mono">{num(r.predicted)}</td>
                          <td>
                            <input
                              id={`val-${r.id}`}
                              aria-label={`Result for ${a.name} ${num(r.x1)}, ${b.name} ${num(r.x2)}`}
                              inputMode="decimal"
                              value={values[r.id] ?? ''}
                              onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>
        <Panel title="Hex field · top view" className="rise" aside={<span className="mono small muted">hover to read values</span>}>
          <FieldMap
            z={z}
            grid={state.grid}
            lo={lo}
            hi={hi}
            gamma={gamma}
            marks={marks}
            rings={rings}
            cols={34}
            axes={{ x: [a.low, a.high], y: [b.low, b.high], xName: a.name, yName: b.name, zName: study.output_name }}
            label="Current stand-in seen from above, with the runs paid for so far"
          />
          <MapLegend study />
        </Panel>
      </div>

      <section className="reads two-up">
        <Panel title={<span className="mono-title">verify/worst_recent_miss</span>} className="rise">
          <p className="small muted">
            Largest gap between what it expected and what came back over the latest 24 runs, in {study.output_name} units. It may stop once the solid line is under the dashed one.
          </p>
          <Legend
            items={[
              { label: 'worst recent miss', color: 'var(--s-verify)' },
              { label: 'allowed', color: 'var(--warn)' },
            ]}
          />
          <LineChart
            aria="Worst recent miss against runs, with the allowed level"
            xMax={Math.max(60, study.runs_done)}
            xLabel="runs reported"
            scale={{ type: 'linear', min: 0, max: worstMax * 1.08 }}
            ticks={[0, 0.5, 1].map((f) => ({ v: f * worstMax, label: num(f * worstMax) }))}
            fmt={num}
            series={[
              { key: 'worst', label: 'miss', color: 'var(--s-verify)', pts: history.filter((h) => h.worst != null).map((h) => ({ x: h.n, y: h.worst! })) },
              { key: 'allowed', label: 'allowed', color: 'var(--warn)', dashed: true, pts: history.map((h) => ({ x: h.n, y: h.allowed })) },
            ]}
          />
        </Panel>
        <Panel title={<span className="mono-title">verify/depth_profile</span>} className="rise">
          <p className="small muted">Depth as a share of the stand-in's output range, deepest first.</p>
          <DepthLegend withReal={false} />
          <DepthChart
            real={null}
            mine={range > 0 ? state.features.map((f) => f.depth / range) : []}
            tau={stop && range > 0 ? stop.depth / range : study.min_depth_rel}
            band={stop?.worst_recent_miss != null && range > 0 ? (2 * stop.worst_recent_miss) / range : null}
          />
        </Panel>
      </section>

      <div className="split">
        <Panel title="Features found" className="rise" aside={<span className="mono small muted">{deep.length} deep</span>}>
          {deep.length === 0 ? (
            <p className="muted">None yet. Deep peaks and valleys show up here after the first fit.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th className="r">{a.name}</th>
                    <th className="r">{b.name}</th>
                    <th className="r">{study.output_name}</th>
                    <th className="r">Depth</th>
                    <th>Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {deep.map((f, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`kind ${f.kind}`}>{f.kind === 'min' ? '▼ Valley' : '▲ Peak'}</span>
                      </td>
                      <td className="r mono">{num(f.x1)}</td>
                      <td className="r mono">{num(f.x2)}</td>
                      <td className="r mono">{num(f.value)}</td>
                      <td className="r mono">{num(f.depth)}</td>
                      <td>{f.checked ? <span className="pill ready">Checked</span> : <span className="pill">Not yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Drive it from a script" className="rise">
          <p className="small muted">The same loop the buttons use. Add an X-API-Key header if the server requires one.</p>
          <div className="code">
            <pre tabIndex={0} aria-label="Python example">
              <code>{snippet}</code>
            </pre>
            <CopyButton text={snippet} />
          </div>
          <div className="danger-zone">
            {confirmDelete ? (
              <>
                <span className="small" role="alert">
                  Delete this study and its {study.runs_done} runs? This cannot be undone.
                </span>
                <span className="btn-row">
                  <button
                    className="btn danger"
                    type="button"
                    onClick={async () => {
                      try {
                        await api.deleteStudy(study.id);
                        navigate('/studies');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Delete study
                  </button>
                  <button className="btn" type="button" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                </span>
              </>
            ) : (
              <>
                <span className="small muted">Removes the study and every run reported to it.</span>
                <button className="btn ghost danger-text" type="button" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon size={15} />
                  Delete study
                </button>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
