import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { decodeGrid, displayGamma, ramp } from '../lib/field';
import type { AppKey, AppModel } from '../types';
import { ErrorNote, Panel } from './bits';
import { ArrowIcon, CheckIcon, FlaskIcon, XIcon } from './icons';

/** A small heat map of a gridded surface (node a*grid + b at (a, b)/(grid - 1); the first input runs left to right). */
export function Thumb({ b64, grid, label, size = 'sm' }: { b64: string; grid: number; label: string; size?: 'sm' | 'lg' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const z = useMemo(() => decodeGrid(b64), [b64]);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of z) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const gamma = displayGamma(z, lo, hi);
    const img = ctx.createImageData(grid, grid);
    for (let a = 0; a < grid; a++)
      for (let b = 0; b < grid; b++) {
        const [r, g, bl] = ramp((z[a * grid + b] - lo) / (hi - lo || 1), gamma);
        const k = ((grid - 1 - b) * grid + a) * 4;
        img.data[k] = r;
        img.data[k + 1] = g;
        img.data[k + 2] = bl;
        img.data[k + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, [z, grid]);
  return <canvas ref={ref} className={`thumb ${size}`} width={grid} height={grid} role="img" aria-label={label} />;
}

/** Which function the application runs on, written out, and why none of the benchmark functions is used. */
export function ModelPanel({ appKey, name }: { appKey: AppKey; name: string }) {
  const [m, setM] = useState<AppModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .appModel(appKey)
      .then((x) => alive && setM(x))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [appKey]);

  return (
    <Panel
      className="model-panel rise"
      style={{ ['--i' as string]: 5 }}
      title={
        <>
          <FlaskIcon size={14} /> Model function
        </>
      }
      aside={
        <span className="pill no-bench">
          <XIcon size={12} /> No benchmark function used
        </span>
      }
    >
      <ErrorNote message={error} />
      {!m ? (
        !error && <div className="skel model-skel" aria-hidden="true" />
      ) : (
        <div className="model-grid">
          <div className="model-left">
            <div className="fn-head">
              <Thumb b64={m.landscape.thumb} grid={m.thumb_grid} size="lg" label={`Map of the ${name} reference function`} />
              <div className="fn-copy">
                <span className="overline">{name} runs on its own function</span>
                <h3>{m.function_name}</h3>
                <p className="small">{m.shape}</p>
                <span className="fn-chips mono">
                  <span>▲ {m.landscape.peaks} peaks</span>
                  <span>▼ {m.landscape.valleys} valleys</span>
                </span>
              </div>
            </div>
            <ol className="formula mono" aria-label="Equations">
              {m.formula.map((line, i) => {
                const at = line.indexOf(' = ');
                return (
                  <li key={i} style={{ ['--i' as string]: i }}>
                    {at > 0 ? (
                      <>
                        <b>{line.slice(0, at)}</b>
                        {line.slice(at)}
                      </>
                    ) : (
                      line
                    )}
                  </li>
                );
              })}
            </ol>
            <dl className="terms">
              {m.terms.map((t) => (
                <div key={t.symbol}>
                  <dt className="mono">{t.symbol}</dt>
                  <dd>{t.meaning}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="model-right">
            <h3 className="why-h">Why not Rastrigin, Peaks or the other benchmark functions?</h3>
            <p className="small muted why-general">{m.general}</p>
            <ul className="bench-grid">
              {m.benchmarks.map((b, i) => (
                <li key={b.key} className={`bench-card${b.closest ? ' closest' : ''}`} style={{ ['--i' as string]: i }}>
                  <div className="bench-top">
                    <Thumb b64={b.landscape.thumb} grid={m.thumb_grid} label={`Map of the ${b.name} function`} />
                    <div className="bench-id">
                      <b>{b.name}</b>
                      <span className="mono small muted">
                        ▲{b.landscape.peaks} ▼{b.landscape.valleys}
                      </span>
                      {b.closest ? (
                        <span className="bench-flag near">
                          <CheckIcon size={11} /> Closest shape
                        </span>
                      ) : (
                        <span className="bench-flag">Not used</span>
                      )}
                    </div>
                  </div>
                  <p className="bench-why">{b.reason}</p>
                </li>
              ))}
            </ul>
            <p className="small muted model-foot">
              "Closest shape" compares the number of peaks and valleys deeper than 5% of the range: {name} has {m.landscape.peaks} and {m.landscape.valleys}. Being
              closest does not make a benchmark usable: it still has no units and no link to the real process.{' '}
              <Link to="/?sim=peaks" className="link-arrow">
                See the benchmarks race <ArrowIcon size={12} />
              </Link>
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
