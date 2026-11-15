import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { api, apiKey } from './api';
import { AppGlyph } from './components/AppBits';
import { ErrorNote, LiveDot, Num, Sparkline } from './components/bits';
import {
  AlertIcon,
  BoltIcon,
  BookIcon,
  ClockIcon,
  CubeIcon,
  ExternalIcon,
  GridIcon,
  HexIcon,
  KeyIcon,
  LayersIcon,
  Logo,
  MenuIcon,
  PlugIcon,
  XIcon,
} from './components/icons';
import { duration, int } from './lib/format';
import { useClock } from './lib/motion';
import { AppsPage } from './pages/AppsPage';
import { OpeningDesignPage } from './pages/OpeningDesignPage';
import { RacePage } from './pages/RacePage';
import { StudiesPage, STATUS_TONE } from './pages/StudiesPage';
import { StudyPage } from './pages/StudyPage';
import type { Overview, Simulator, Study } from './types';

type Gate = 'checking' | 'open' | 'locked' | 'down';

const SERVER_TEXT: Record<Gate, string> = {
  checking: 'Connecting',
  open: 'API online',
  locked: 'Key needed',
  down: 'API offline',
};

export function App() {
  const [gate, setGate] = useState<Gate>('checking');
  const [version, setVersion] = useState('');
  const [key, setKey] = useState('');
  const [wrong, setWrong] = useState(false);

  const check = async () => {
    try {
      const h = await api.health();
      setVersion(h.version);
      if (!h.auth_required) return setGate('open');
      if (!apiKey.get()) return setGate('locked');
      await api.studies();
      setGate('open');
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        setWrong(Boolean(apiKey.get()));
        apiKey.set('');
        setGate('locked');
      } else setGate('down');
    }
  };
  useEffect(() => {
    void check();
  }, []);

  const unlock = (ev: FormEvent) => {
    ev.preventDefault();
    apiKey.set(key.trim());
    setGate('checking');
    void check();
  };

  return (
    <BrowserRouter>
      <Shell gate={gate} version={version}>
        {gate === 'checking' && (
          <div className="panel gate" aria-busy="true">
            <span className="sr-only">Connecting to the server.</span>
            <div className="boot">
              <Logo size={54} />
              <span className="boot-bar">
                <i />
              </span>
              <span className="overline">Linking to the simulation service</span>
            </div>
          </div>
        )}
        {gate === 'down' && (
          <div className="panel gate empty">
            <span className="art">
              <PlugIcon size={26} />
            </span>
            <h2>The server is not answering</h2>
            <p>
              The web app could not reach the API. Start it with <code className="mono">uvicorn app.main:app</code> in the backend folder, then try
              again.
            </p>
            <button className="btn primary" type="button" onClick={() => void check()}>
              Try again
            </button>
          </div>
        )}
        {gate === 'locked' && (
          <form className="panel gate form narrow" onSubmit={unlock}>
            <span className="art sm">
              <KeyIcon size={20} />
            </span>
            <h2>This server needs an API key</h2>
            <p className="small muted">Ask whoever runs the server for the key. It is stored in this browser only.</p>
            <label htmlFor="api-key">
              API key
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                value={key}
                aria-invalid={wrong || undefined}
                aria-describedby={wrong ? 'api-key-error' : undefined}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            {wrong && <ErrorNote id="api-key-error" message="That key was not accepted. Check it and try again." />}
            <button className="btn primary block" type="submit" disabled={!key.trim()}>
              Continue
            </button>
          </form>
        )}
        {gate === 'open' && (
          <Routes>
            <Route path="/" element={<RacePage />} />
            <Route path="/studies" element={<StudiesPage />} />
            <Route path="/studies/:id" element={<StudyPage />} />
            <Route path="/opening-design" element={<OpeningDesignPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/apps/:key" element={<AppsPage />} />
            <Route
              path="*"
              element={
                <div className="panel gate empty">
                  <span className="art">
                    <HexIcon size={26} />
                  </span>
                  <h2>Nothing lives at this address</h2>
                  <p>The page may have moved, or the link was mistyped.</p>
                  <Link className="btn primary" to="/">
                    Go to the benchmark
                  </Link>
                </div>
              }
            />
          </Routes>
        )}
      </Shell>
    </BrowserRouter>
  );
}

function Shell({ gate, version, children }: { gate: Gate; version: string; children: React.ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [sims, setSims] = useState<Simulator[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const now = useClock();
  const open = gate === 'open';

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const pull = () => {
      api
        .overview()
        .then((o) => {
          if (!alive) return;
          setOverview(o);
          setFetchedAt(Date.now());
        })
        .catch(() => undefined);
      api
        .studies()
        .then((s) => alive && setStudies(s))
        .catch(() => undefined);
    };
    pull();
    const t = setInterval(pull, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, location.pathname]);
  useEffect(() => {
    if (open) api.simulators().then(setSims).catch(() => undefined);
  }, [open]);
  useEffect(() => setDrawer(false), [location.pathname, location.search]);

  const uptime = overview ? overview.uptime_s + Math.max(0, (now.getTime() - fetchedAt) / 1000) : 0;
  const live = overview ? overview.races_running + overview.autoruns_active : 0;
  const context = location.pathname.startsWith('/studies/')
    ? 'Study workbench'
    : location.pathname === '/studies'
      ? 'Studies'
      : location.pathname === '/opening-design'
        ? 'Opening design'
        : location.pathname.startsWith('/apps')
          ? 'Applications'
          : 'Live benchmark';

  return (
    <div className={`shell${drawer ? ' drawer-open' : ''}`}>
      <div className="backdrop" aria-hidden="true">
        <i className="orb a" />
        <i className="orb b" />
        <i className="orb c" />
      </div>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <button className="icon-btn only-narrow" type="button" aria-label={drawer ? 'Close menu' : 'Open menu'} onClick={() => setDrawer((d) => !d)}>
          {drawer ? <XIcon size={18} /> : <MenuIcon size={18} />}
        </button>
        <Link to="/" className="brand">
          <Logo />
          <span className="brand-name">
            VERIFY<span className="brand-sep">//</span>DON'T CHASE
          </span>
        </Link>
        <span className="topbar-div" aria-hidden="true" />
        <span className="topbar-mod">Simulation Hub</span>
        <span className="topbar-ctx mono">
          <span className="muted">Module:</span> {context}
        </span>
        <div className="hud" aria-label="Service at a glance">
          {open && overview && (
            <>
              <span className="hud-item">
                <span className="overline">Studies</span>
                <b className="mono">
                  <Num value={overview.studies} />
                </b>
              </span>
              <span className="hud-item">
                <span className="overline">Runs</span>
                <b className="mono">
                  <Num value={overview.runs_done} format={int} />
                </b>
              </span>
              <span className="hud-item">
                <span className="overline">Live jobs</span>
                <b className="mono">
                  {live > 0 && <LiveDot tone="info" />}
                  {live}
                </b>
              </span>
              <span className="hud-item spark-item" title={`Runs reported per ${overview.activity_bucket_min} minutes, last 2 hours`}>
                <span className="overline">Throughput</span>
                <Sparkline values={overview.activity} w={84} h={22} color="#7c5cff" label="Runs reported over the last two hours" />
              </span>
              <span className="hud-item">
                <span className="overline">Uptime</span>
                <b className="mono">{duration(uptime)}</b>
              </span>
            </>
          )}
        </div>
        <span className="clock mono" aria-label="Local time">
          <ClockIcon size={13} />
          {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
        <span className={`server ${gate}`} role="status">
          <LiveDot on={gate === 'open'} tone={gate === 'open' ? 'good' : gate === 'down' ? 'bad' : 'warn'} />
          <span>
            {SERVER_TEXT[gate]}
            {gate === 'open' && version ? <span className="mono muted"> v{version}</span> : ''}
          </span>
        </span>
      </header>

      <aside className="sidebar" aria-label="Navigation">
        <div className="side-block">
          <span className="side-h">Workspace</span>
          <nav aria-label="Main">
            <NavLink to="/" end className="side-link">
              <CubeIcon size={16} />
              Live benchmark
            </NavLink>
            <NavLink to="/apps" className="side-link apps-link">
              <BoltIcon size={16} />
              Applications
              <span className="side-new mono">LIVE</span>
            </NavLink>
            <NavLink to="/studies" className="side-link">
              <LayersIcon size={16} />
              Studies
              {overview && overview.studies > 0 && <span className="side-count mono">{overview.studies}</span>}
            </NavLink>
            <NavLink to="/opening-design" className="side-link">
              <GridIcon size={16} />
              Opening design
            </NavLink>
            <a href="/docs" className="side-link">
              <BookIcon size={16} />
              API reference
              <ExternalIcon size={12} />
            </a>
          </nav>
        </div>
        <div className="side-block">
          <span className="side-h">Applications</span>
          <ul className="side-sims">
            {(
              [
                ['air-quality', 'Air quality'],
                ['traffic', 'Traffic flow'],
                ['weather', 'Weather'],
              ] as const
            ).map(([k, name]) => (
              <li key={k}>
                <NavLink to={`/apps/${k}`} className="side-link sim side-app">
                  <AppGlyph app={k} size={16} />
                  {name}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
        {open && <SimList sims={sims} />}
        {open && studies.length > 0 && (
          <div className="side-block">
            <span className="side-h">
              Recent studies <span className="mono muted">{Math.min(6, studies.length)}/{studies.length}</span>
            </span>
            <ul className="side-runs">
              {studies.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <NavLink to={`/studies/${s.id}`} className="side-run">
                    <i className={`ring-dot ${STATUS_TONE[s.status]}`} aria-hidden="true" />
                    <span className="side-run-name">{s.name}</span>
                    <span className="mono muted side-run-n">{s.runs_done}</span>
                    {s.autorun && <LiveDot tone="info" />}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="side-foot">
          {overview && (
            <div className="side-status">
              <span className="overline">Data status</span>
              <span className="side-status-v mono">
                {overview.by_status.ready} / {overview.studies} <small>studies ready to stop</small>
              </span>
              <span className="track" aria-hidden="true">
                <i style={{ transform: `scaleX(${overview.studies ? overview.by_status.ready / overview.studies : 0})` }} />
              </span>
              <span className="small muted">{int(overview.runs_pending)} runs suggested, waiting for results</span>
            </div>
          )}
          <p className="caveat">
            <AlertIcon size={14} />
            Verify's stop rule is a heuristic, not a proof.
          </p>
          <p className="cite">
            Chase follows Diaw et al.,{' '}
            <a href="https://arxiv.org/abs/2207.12855">Nature Machine Intelligence, 2024</a>, re-implemented with a plain Nelder-Mead optimizer.
          </p>
        </div>
      </aside>
      <button className="scrim" type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setDrawer(false)} />

      <main id="main" className="main">
        {children}
      </main>
    </div>
  );
}

function SimList({ sims }: { sims: Simulator[] }) {
  const location = useLocation();
  const [params] = useSearchParams();
  const active = location.pathname === '/' ? params.get('sim') ?? 'peaks' : null;
  const tests = sims.filter((s) => s.kind !== 'real');
  const real = sims.filter((s) => s.kind === 'real');
  const row = (s: { key: string; name: string; note: string }, i: number, glyph: ReactNode) => (
    <li key={s.key} style={{ ['--i' as string]: i }}>
      <Link to={`/?sim=${s.key}`} className={`side-link sim${active === s.key ? ' active' : ''}`} aria-current={active === s.key ? 'true' : undefined} title={s.note}>
        {glyph}
        {s.name}
        {active === s.key && <span className="side-check" aria-hidden="true" />}
      </Link>
    </li>
  );
  return (
    <>
      <div className="side-block">
        <span className="side-h">Test functions</span>
        <ul className="side-sims">{(tests.length ? tests : [{ key: 'peaks', name: 'Peaks', note: '' }]).map((s, i) => row(s, i, <SimGlyph seed={i} />))}</ul>
      </div>
      {real.length > 0 && (
        <div className="side-block">
          <span className="side-h">Real data</span>
          <ul className="side-sims">{real.map((s, i) => row(s, tests.length + i, <TerrainGlyph />))}</ul>
        </div>
      )}
    </>
  );
}

/** Contour lines over a ridge: marks a measured dataset, not a formula. */
function TerrainGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="sim-glyph">
      <path d="M1 13.5 6 4l3 5 2-3 4 7.5z" fill="hsl(28 85% 52%)" opacity="0.35" />
      <path d="M1 13.5 6 4l3 5 2-3 4 7.5" fill="none" stroke="hsl(28 90% 62%)" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4.2 9.5h3.6M9.6 10.5h2.6" stroke="hsl(28 90% 62%)" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** A tiny hex cluster, tinted per simulator, so the list reads like a set of instruments. */
function SimGlyph({ seed }: { seed: number }) {
  const hues = [190, 150, 265, 30, 330, 210, 95];
  const h = hues[seed % hues.length];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="sim-glyph">
      {[
        [5, 4.5],
        [11, 4.5],
        [8, 9.7],
        [2, 9.7],
        [14, 9.7],
      ].map(([x, y], k) => (
        <path
          key={k}
          d={`M${x} ${y - 2.6}l2.25 1.3v2.6L${x} ${y + 2.6}l-2.25-1.3v-2.6z`}
          fill={`hsl(${h + k * 12} 90% ${k === 2 ? 62 : 45}%)`}
          opacity={k === 2 ? 1 : 0.55}
        />
      ))}
    </svg>
  );
}
