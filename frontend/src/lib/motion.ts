import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion(): boolean {
  return Boolean(query?.matches);
}

/** True when the person asked the system for less motion. Every animation in the app checks it. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      query?.addEventListener('change', cb);
      return () => query?.removeEventListener('change', cb);
    },
    () => Boolean(query?.matches),
    () => false,
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** A number that glides to each new target instead of jumping. Interruptible: a new target starts from where it is. */
export function useTween(target: number, ms = 750): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reduced || !Number.isFinite(target) || !Number.isFinite(current.current)) {
      current.current = target;
      setShown(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / ms);
      const v = from + (target - from) * easeOut(f);
      current.current = v;
      setShown(v);
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return shown;
}

/** Wall-clock time, refreshed every second. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
