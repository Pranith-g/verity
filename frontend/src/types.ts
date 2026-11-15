export type Kind = 'random' | 'chase' | 'verify';
export const KINDS: Kind[] = ['random', 'chase', 'verify'];
export const KIND_NAME: Record<Kind, string> = { random: 'Random', chase: 'Chase', verify: 'Verify' };

export interface Simulator {
  key: string;
  name: string;
  note: string;
  box: [number, number, number, number];
}

export interface Stop {
  ready: boolean;
  features_checked: boolean;
  surprises_small: boolean;
  no_blind_spot: boolean;
  unchecked: number;
  deep_features: number;
  worst_recent_miss: number | null;
  typical_miss: number | null;
  allowed_miss: number;
  largest_gap: number;
  max_gap: number;
  depth: number;
  notes: string[];
}

export interface InputSpec {
  name: string;
  low: number;
  high: number;
}

export type StudyStatus = 'collecting' | 'learning' | 'ready' | 'out_of_budget';

export interface Study {
  id: string;
  name: string;
  created_at: string;
  inputs: [InputSpec, InputSpec];
  output_name: string;
  min_depth_rel: number;
  min_depth_abs: number | null;
  max_runs: number;
  seed: number;
  demo_simulator: string | null;
  runs_done: number;
  runs_pending: number;
  declared_at: number | null;
  status: StudyStatus;
  autorun: boolean;
}

export interface StudyCreate {
  name: string;
  inputs?: InputSpec[];
  output_name?: string;
  min_depth_rel?: number;
  max_runs?: number;
  demo_simulator?: string;
}

export interface Suggestion {
  run_id: number;
  x1: number;
  x2: number;
  reason: string;
  predicted: number | null;
}

export interface Run {
  id: number;
  status: 'pending' | 'done';
  seq: number | null;
  u: number;
  v: number;
  x1: number;
  x2: number;
  reason: string;
  predicted: number | null;
  value: number | null;
}

export interface Feature {
  kind: 'min' | 'max';
  u: number;
  v: number;
  x1: number;
  x2: number;
  value: number;
  depth: number;
  deep: boolean;
  checked: boolean;
}

export interface HistoryPoint {
  n: number;
  unchecked: number;
  deep: number;
  worst: number | null;
  allowed: number;
  gap: number;
  ready: boolean;
}

export interface StudyState {
  study: Study;
  grid: number;
  z: string | null;
  z_min: number | null;
  z_max: number | null;
  runs: Run[];
  features: Feature[];
  stop: Stop | null;
  history: HistoryPoint[];
}

export interface RaceInfo {
  id: string;
  simulator: string;
  tau: number;
  budget: number;
  seed: number;
  status: string;
}

export interface TruthEvent {
  type: 'truth';
  simulator: string;
  grid: number;
  z: string;
  lo: number;
  hi: number;
  tau: number;
  budget: number;
  features: { kind: 'min' | 'max'; u: number; v: number; depth: number }[];
  depths: number[];
  init: [number, number][];
}

export interface Audit {
  captured: number;
  total: number;
  ghosts: number;
  rmse: number;
  worst: number;
  at_features: number;
  hit: boolean[];
  ghost_points: [number, number][];
}

export interface StepEvent {
  type: 'step';
  kind: Kind;
  n: number;
  z: string;
  points: [number, number, string][];
  audit: Audit;
  done_at: number | null;
  declared_at: number | null;
  declared_correct: boolean | null;
  stop?: Stop;
  depths?: number[];
}

export type RaceEvent =
  | TruthEvent
  | StepEvent
  | { type: 'done'; summary: Record<string, unknown> }
  | { type: 'error'; message: string };

export interface Overview {
  version: string;
  uptime_s: number;
  studies: number;
  by_status: Record<StudyStatus, number>;
  runs_done: number;
  runs_pending: number;
  races_total: number;
  races_running: number;
  autoruns_active: number;
  activity: number[];
  activity_bucket_min: number;
}
