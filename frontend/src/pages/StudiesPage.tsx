import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, LiveDot, Num, Panel, Segmented, Sparkline, Tile } from '../components/bits';
import { ActivityIcon, CheckIcon, ChevronIcon, FlaskIcon, LayersIcon, PlusIcon, TargetIcon } from '../components/icons';
import { ago, int } from '../lib/format';
import type { Overview, Simulator, Study, StudyStatus } from '../types';

export const STATUS_TEXT: Record<StudyStatus, string> = {
  collecting: 'Collecting opening runs',
  learning: 'Learning',
  ready: 'Ready to stop',
  out_of_budget: 'Out of budget',
};
export const STATUS_TONE: Record<StudyStatus, 'info' | 'violet' | 'good' | 'bad'> = {
  collecting: 'info',
  learning: 'violet',
  ready: 'good',
  out_of_budget: 'bad',
};

export function StatusPill({ status }: { status: StudyStatus }) {
  return (
    <span className={`pill ${status}`}>
      <i className={`ring-dot ${STATUS_TONE[status]}`} aria-hidden="true" />
      {STATUS_TEXT[status]}
    </span>
  );
}

type Filter = 'all' | StudyStatus;

export function StudiesPage() {
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sims, setSims] = useState<Simulator[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.studies().then(setStudies).catch((e: Error) => setError(e.message));
    api.overview().then(setOverview).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    api.simulators().then(setSims).catch(() => undefined);
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (studies ?? []).filter((s) => (filter === 'all' || s.status === filter) && (!q || s.name.toLowerCase().includes(q) || (s.demo_simulator ?? '').includes(q)));
  }, [studies, query, filter]);
  const now = Date.now();

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <span className="eyebrow">
            <LayersIcon size={13} />
            Study workbench
          </span>
          <h1>
            Your <span className="grad">studies</span>
          </h1>
          <p className="lede">
            A study learns one simulator. You run the simulator; the service names the next runs to buy and tells you when the stand-in is good enough to stop.
          </p>
        </div>
      </header>

      <section className="tiles-row" aria-label="Studies at a glance">
        <Tile icon={<LayersIcon size={18} />} label="Studies" accent="#00d4ff" style={{ ['--i' as string]: 0 }} sub={overview ? `${overview.by_status.collecting} collecting opening runs` : ' '}>
          <Num value={overview?.studies ?? null} />
        </Tile>
        <Tile icon={<ActivityIcon size={18} />} label="Learning" accent="#7c5cff" style={{ ['--i' as string]: 1 }} sub="hunting and checking features">
          <Num value={overview?.by_status.learning ?? null} />
        </Tile>
        <Tile icon={<CheckIcon size={18} />} label="Ready to stop" accent="#2ff3a0" tone="good" style={{ ['--i' as string]: 2 }} sub={overview ? `${overview.by_status.out_of_budget} ran out of budget` : ' '}>
          <Num value={overview?.by_status.ready ?? null} />
        </Tile>
        <Tile icon={<TargetIcon size={18} />} label="Runs reported" accent="#ff8a3d" style={{ ['--i' as string]: 3 }} sub={<Sparkline values={overview?.activity ?? []} w={150} h={24} color="#ff8a3d" label="Runs reported over the last two hours" />}>
          <Num value={overview?.runs_done ?? null} format={int} />
        </Tile>
      </section>

      <ErrorNote message={error} />
      <div className="split wide-left">
        <Panel
          title={
            <>
              Runs <span className="mono muted">{shown.length}/{studies?.length ?? 0}</span>
            </>
          }
          className="rise studies-panel"
          aside={
            <input className="search" type="search" placeholder="Search studies…" aria-label="Search studies" value={query} onChange={(e) => setQuery(e.target.value)} />
          }
        >
          <div className="chips" role="group" aria-label="Filter by status">
            {(['all', 'collecting', 'learning', 'ready', 'out_of_budget'] as Filter[]).map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f !== 'all' && <i className={`ring-dot ${STATUS_TONE[f]}`} aria-hidden="true" />}
                {f === 'all' ? 'All' : STATUS_TEXT[f]}
                <span className="mono muted">{f === 'all' ? (studies?.length ?? 0) : (studies ?? []).filter((s) => s.status === f).length}</span>
              </button>
            ))}
          </div>
          {studies == null ? (
            error ? (
              <p className="muted">The list could not be loaded.</p>
            ) : (
              <div aria-busy="true">
                <span className="sr-only">Loading studies.</span>
                {[68, 52, 60, 44].map((w) => (
                  <div key={w} className="skel" style={{ width: `${w}%`, height: 44, margin: '10px 0' }} />
                ))}
              </div>
            )
          ) : studies.length === 0 ? (
            <div className="empty">
              <span className="art">
                <LayersIcon size={26} />
              </span>
              <h3>No studies yet</h3>
              <p>Create one with the form to point the service at your own simulator, or pick a built-in example to watch it work first.</p>
            </div>
          ) : shown.length === 0 ? (
            <p className="muted empty-filter">No study matches that search.</p>
          ) : (
            <ul className="study-list">
              {shown.map((s, i) => (
                <li key={s.id} style={{ ['--i' as string]: Math.min(i, 12) }}>
                  <Link className="study-row" to={`/studies/${s.id}`}>
                    <i className={`ring-dot lg ${STATUS_TONE[s.status]}${s.status === 'ready' ? ' filled' : ''}`} aria-hidden="true" />
                    <span className="study-id">
                      <span className="name">{s.name}</span>
                      <span className="meta mono">
                        {s.demo_simulator ? `built-in ${s.demo_simulator}` : `${s.inputs[0].name} × ${s.inputs[1].name} → ${s.output_name}`}
                      </span>
                    </span>
                    <span className="study-when muted small">
                      {s.autorun && <LiveDot tone="info" />}
                      {ago(s.created_at, now)}
                    </span>
                    <StatusPill status={s.status} />
                    <span className="runs mono">
                      {s.runs_done} / {s.max_runs}
                      <span className="track" aria-hidden="true">
                        <i style={{ transform: `scaleX(${Math.min(1, s.runs_done / Math.max(1, s.max_runs))})` }} />
                      </span>
                    </span>
                    <ChevronIcon />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <NewStudy sims={sims} onCreated={(s) => navigate(`/studies/${s.id}`)} />
      </div>
    </div>
  );
}

type FieldKey = 'name' | 'depth' | 'max' | `in-name-${number}` | `in-low-${number}` | `in-high-${number}`;

function NewStudy({ sims, onCreated }: { sims: Simulator[]; onCreated: (s: Study) => void }) {
  const [mode, setMode] = useState<'own' | 'demo'>('own');
  const [name, setName] = useState('');
  const [demo, setDemo] = useState('peaks');
  const [inputs, setInputs] = useState([
    { name: 'x1', low: '0', high: '1' },
    { name: 'x2', low: '0', high: '1' },
  ]);
  const [output, setOutput] = useState('output');
  const [depth, setDepth] = useState('5');
  const [maxRuns, setMaxRuns] = useState('400');
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<FieldKey | null>(null);
  const [saving, setSaving] = useState(false);

  const setInput = (i: number, key: 'name' | 'low' | 'high', value: string) =>
    setInputs((prev) => prev.map((row, j) => (j === i ? { ...row, [key]: value } : row)));

  /** Show the message next to the button and put the cursor in the field that needs fixing. */
  const reject = (field: FieldKey, message: string) => {
    setBad(field);
    setError(message);
    const id = field === 'name' ? 'st-name' : field === 'depth' ? 'st-depth' : field === 'max' ? 'st-max' : field;
    document.getElementById(id)?.focus();
  };
  const invalid = (field: FieldKey) => (bad === field ? { 'aria-invalid': true, 'aria-describedby': 'st-error' } : {});

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setBad(null);
    const d = Number(depth);
    const m = Number(maxRuns);
    if (!name.trim()) return reject('name', 'Give the study a name.');
    const parsed = inputs.map((r) => ({ name: r.name.trim(), low: Number(r.low), high: Number(r.high) }));
    if (mode === 'own') {
      for (const [i, r] of parsed.entries()) {
        if (!r.name) return reject(`in-name-${i}`, 'Each input needs a name.');
        if (!Number.isFinite(r.low)) return reject(`in-low-${i}`, `For "${r.name}", the lowest value must be a number.`);
        if (!Number.isFinite(r.high) || r.high <= r.low) return reject(`in-high-${i}`, `For "${r.name}", the highest value must be greater than the lowest value.`);
      }
    }
    if (!(d >= 1 && d <= 50)) return reject('depth', 'The depth to ignore must be between 1% and 50%.');
    if (!(Number.isInteger(m) && m >= 20)) return reject('max', 'The run budget must be a whole number of at least 20.');
    setSaving(true);
    try {
      const study = await api.createStudy(
        mode === 'demo'
          ? { name: name.trim(), demo_simulator: demo, min_depth_rel: d / 100, max_runs: m }
          : { name: name.trim(), inputs: parsed, output_name: output.trim() || 'output', min_depth_rel: d / 100, max_runs: m },
      );
      onCreated(study);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const simNote = sims.find((s) => s.key === demo)?.note;

  return (
    <form className="panel form new-study rise" style={{ ['--i' as string]: 2 }} onSubmit={submit} noValidate aria-labelledby="new-study-title">
      <header className="panel-head">
        <h2 className="panel-title" id="new-study-title">
          <FlaskIcon size={14} /> New study
        </h2>
      </header>
      <Segmented
        id="mode"
        label="What will answer the runs?"
        value={mode}
        options={[
          { value: 'own', label: 'My own simulator' },
          { value: 'demo', label: 'A built-in example' },
        ]}
        onChange={setMode}
      />
      <label htmlFor="st-name">
        Name
        <input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wing drag, coarse mesh" maxLength={120} {...invalid('name')} />
      </label>
      {mode === 'demo' ? (
        <label htmlFor="st-demo">
          Example simulator
          <select id="st-demo" value={demo} onChange={(e) => setDemo(e.target.value)}>
            {sims.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
          {simNote && <span className="hint">{simNote}</span>}
        </label>
      ) : (
        <>
          {inputs.map((row, i) => (
            <fieldset key={i}>
              <legend>Input {i + 1}</legend>
              <label htmlFor={`in-name-${i}`}>
                Name
                <input id={`in-name-${i}`} value={row.name} onChange={(e) => setInput(i, 'name', e.target.value)} maxLength={40} {...invalid(`in-name-${i}`)} />
              </label>
              <label htmlFor={`in-low-${i}`}>
                Lowest
                <input id={`in-low-${i}`} className="num-input" inputMode="decimal" value={row.low} onChange={(e) => setInput(i, 'low', e.target.value)} {...invalid(`in-low-${i}`)} />
              </label>
              <label htmlFor={`in-high-${i}`}>
                Highest
                <input id={`in-high-${i}`} className="num-input" inputMode="decimal" value={row.high} onChange={(e) => setInput(i, 'high', e.target.value)} {...invalid(`in-high-${i}`)} />
              </label>
            </fieldset>
          ))}
          <label htmlFor="st-out">
            Name of the output
            <input id="st-out" value={output} onChange={(e) => setOutput(e.target.value)} maxLength={40} />
          </label>
        </>
      )}
      <div className="row2">
        <label htmlFor="st-depth">
          Ignore features shallower than
          <input id="st-depth" className="num-input" inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} {...invalid('depth')} />
          <span className="hint">% of the output range, 1 to 50</span>
        </label>
        <label htmlFor="st-max">
          Run budget
          <input id="st-max" className="num-input" inputMode="numeric" value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} {...invalid('max')} />
          <span className="hint">most runs you will pay for, 20 or more</span>
        </label>
      </div>
      <ErrorNote id="st-error" message={error} />
      <button className="btn primary block glow" type="submit" disabled={saving}>
        {!saving && <PlusIcon />}
        {saving ? 'Creating study' : 'Create study'}
      </button>
    </form>
  );
}
