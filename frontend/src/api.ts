import { createSseParser } from './lib/sse';
import type { AppKey, AppModel, AppPrediction, AppReadingIn, AppRetrain, AppState, AppSummary, InitDesignReport, Overview, RaceEvent, RaceInfo, Simulator, Stop, Study, StudyCreate, StudyState, Suggestion } from './types';

const BASE: string = import.meta.env.VITE_API_BASE ?? '';
const KEY_STORE = 'vdc_api_key';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const apiKey = {
  get: (): string => {
    try {
      return localStorage.getItem(KEY_STORE) ?? '';
    } catch {
      return '';
    }
  },
  set: (key: string): void => {
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
    } catch {
      /* storage unavailable: the key lasts for this page only */
    }
  },
};

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const key = apiKey.get();
  if (key) h['X-API-Key'] = key;
  return h;
}

async function fail(res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join('; ');
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, message);
}

async function req<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: init.method ?? 'GET',
      headers: headers(init.body !== undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check that the API is running, then try again.');
  }
  if (!res.ok) return fail(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  health: () => req<{ status: string; version: string; auth_required: boolean }>('/api/health'),
  simulators: () => req<Simulator[]>('/api/simulators'),

  studies: () => req<Study[]>('/api/studies'),
  createStudy: (body: StudyCreate) => req<Study>('/api/studies', { method: 'POST', body }),
  deleteStudy: (id: string) => req<void>(`/api/studies/${id}`, { method: 'DELETE' }),
  state: (id: string, signal?: AbortSignal) => req<StudyState>(`/api/studies/${id}/state`, { signal }),
  ask: (id: string, n: number) =>
    req<{ suggestions: Suggestion[]; message: string | null }>(`/api/studies/${id}/ask`, { method: 'POST', body: { n } }),
  tell: (id: string, results: { run_id?: number; x1?: number; x2?: number; value: number }[]) =>
    req<{ accepted: number; runs_done: number; stop: Stop | null }>(`/api/studies/${id}/tell`, {
      method: 'POST',
      body: { results },
    }),
  startAutorun: (id: string) => req<unknown>(`/api/studies/${id}/autorun`, { method: 'POST', body: { batch: 6 } }),
  stopAutorun: (id: string) => req<unknown>(`/api/studies/${id}/autorun`, { method: 'DELETE' }),

  overview: () => req<Overview>('/api/overview'),

  apps: () => req<AppSummary[]>('/api/apps'),
  app: (key: AppKey, signal?: AbortSignal) => req<AppState>(`/api/apps/${key}`, { signal }),
  appModel: (key: AppKey) => req<AppModel>(`/api/apps/${key}/model`),
  trainApp: (key: AppKey) => req<unknown>(`/api/apps/${key}/train`, { method: 'POST', body: { reset: true, pace_ms: 70 } }),
  predict: (key: AppKey, x1: number, x2: number, signal?: AbortSignal) =>
    req<AppPrediction>(`/api/apps/${key}/predict`, { method: 'POST', body: { x1, x2 }, signal }),
  addReadings: (key: AppKey, readings: AppReadingIn[], source: 'manual' | 'csv' = 'manual') =>
    req<AppRetrain>(`/api/apps/${key}/readings`, { method: 'POST', body: { readings, source } }),
  sampleReadings: (key: AppKey, n: number, source: 'sample' | 'feed') =>
    req<AppRetrain>(`/api/apps/${key}/readings/sample`, { method: 'POST', body: { n, source } }),
  deleteReading: (key: AppKey, id: number) => req<void>(`/api/apps/${key}/readings/${id}`, { method: 'DELETE' }),
  clearReadings: (key: AppKey) => req<{ removed: number }>(`/api/apps/${key}/readings`, { method: 'DELETE' }),
  initDesign: () => req<InitDesignReport>('/api/benchmarks/init-design'),

  /** Start a race. The server caps how many run at once, so a 429 waits briefly and tries again. */
  async createRace(body: { simulator: string; tau: number; budget: number; seed: number }, signal?: AbortSignal): Promise<RaceInfo> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await req<RaceInfo>('/api/races', { method: 'POST', body, signal });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 429 || attempt >= 6) throw err;
        await new Promise((ok) => setTimeout(ok, 700 + attempt * 500));
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      }
    }
  },
  /** Stop a race nobody is watching any more, so it frees its slot. Fire and forget. */
  cancelRace: (id: string) => {
    void fetch(`${BASE}/api/races/${id}`, { method: 'DELETE', headers: headers(false), keepalive: true }).catch(() => undefined);
  },

  /** Follow a race. Uses fetch rather than EventSource so the API key header can be sent. */
  async followRace(id: string, onEvent: (ev: RaceEvent) => void, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${BASE}/api/races/${id}/events`, { headers: headers(false), signal });
    if (!res.ok || !res.body) return fail(res);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const feed = createSseParser();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const payload of feed(decoder.decode(value, { stream: true }))) onEvent(JSON.parse(payload) as RaceEvent);
    }
  },
};
