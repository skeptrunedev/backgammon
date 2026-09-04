import { get, set } from 'idb-keyval';

export const DEFAULT_REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;
export type PipMethod = 'urquhart' | '321' | 'criss-cross';

export interface ReviewProgress {
  stage: number;
  dueAt: number;
  mastered: boolean;
  failures: number;
  updatedAt: number;
}

export interface TrainingSettings {
  intervals: number[];
  severities: ('inaccuracy' | 'mistake' | 'blunder')[];
  decisionTypes: ('checker' | 'cube')[];
  sessionSize: number;
}

export interface PipPreferences {
  method: PipMethod | 'mixed';
  answer: 'relative' | 'counts' | 'both';
  seconds: number | null;
}

export interface PipStats {
  attempts: number;
  correct: number;
  totalMs: number;
  bestMs: number | null;
  updatedAt: number;
}

export interface Stamped<T> {
  value: T;
  updatedAt: number;
}

export interface TrainingState {
  version: 1;
  reviews: Record<string, ReviewProgress>;
  settings: Stamped<TrainingSettings>;
  pipPreferences: Stamped<PipPreferences>;
  pipStats: Record<PipMethod, PipStats>;
}

const KEY = 'training:v1';

// Zero lets an existing account preference beat a never-edited local default.
export function defaultTrainingState(now = 0): TrainingState {
  const empty = (): PipStats => ({ attempts: 0, correct: 0, totalMs: 0, bestMs: null, updatedAt: now });
  return {
    version: 1,
    reviews: {},
    settings: {
      value: {
        intervals: [...DEFAULT_REVIEW_INTERVALS],
        severities: ['inaccuracy', 'mistake', 'blunder'],
        decisionTypes: ['checker', 'cube'],
        sessionSize: 10,
      },
      updatedAt: now,
    },
    pipPreferences: {
      value: { method: 'mixed', answer: 'relative', seconds: null },
      updatedAt: now,
    },
    pipStats: { urquhart: empty(), '321': empty(), 'criss-cross': empty() },
  };
}

export function validIntervals(values: number[]): boolean {
  return values.length >= 1 && values.length <= 12 && values.every(
    (v, i) => Number.isInteger(v) && v >= 1 && v <= 365 && (i === 0 || v > values[i - 1]),
  );
}

export function nextReviewProgress(
  previous: ReviewProgress | undefined,
  intervals: number[],
  cleanFirstTry: boolean,
  now = Date.now(),
): ReviewProgress {
  if (!cleanFirstTry) {
    return { stage: 0, dueAt: now + 86_400_000, mastered: false, failures: (previous?.failures ?? 0) + 1, updatedAt: now };
  }
  const stage = previous?.stage ?? 0;
  return stage >= intervals.length
    ? { stage, dueAt: 0, mastered: true, failures: previous?.failures ?? 0, updatedAt: now }
    : { stage: stage + 1, dueAt: now + intervals[stage] * 86_400_000, mastered: false, failures: previous?.failures ?? 0, updatedAt: now };
}

function newer<T extends { updatedAt: number }>(a: T, b: T): T {
  return b.updatedAt > a.updatedAt ? b : a;
}

export function mergeTrainingState(local: TrainingState, remote: TrainingState): TrainingState {
  const reviews = { ...local.reviews };
  for (const [id, progress] of Object.entries(remote.reviews)) {
    reviews[id] = reviews[id] ? newer(reviews[id], progress) : progress;
  }
  return {
    version: 1,
    reviews,
    settings: newer(local.settings, remote.settings),
    pipPreferences: newer(local.pipPreferences, remote.pipPreferences),
    pipStats: {
      urquhart: newer(local.pipStats.urquhart, remote.pipStats.urquhart),
      '321': newer(local.pipStats['321'], remote.pipStats['321']),
      'criss-cross': newer(local.pipStats['criss-cross'], remote.pipStats['criss-cross']),
    },
  };
}

export async function loadTrainingState(): Promise<TrainingState> {
  return (await get<TrainingState>(KEY)) ?? defaultTrainingState();
}

async function pushTrainingState(state: TrainingState): Promise<void> {
  try {
    const res = await fetch('/api/training', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
    });
    if (!res.ok) console.debug(`[training] push skipped (HTTP ${res.status})`);
  } catch (error) {
    console.debug('[training] push failed (offline?)', error);
  }
}

/** Persist locally before attempting account sync, so every action works offline. */
export async function saveTrainingState(state: TrainingState): Promise<void> {
  await set(KEY, state);
  void pushTrainingState(state);
}

export async function updateTrainingState(
  update: (state: TrainingState) => TrainingState,
): Promise<TrainingState> {
  const next = update(await loadTrainingState());
  await saveTrainingState(next);
  return next;
}

/** Pull, merge per entry timestamp, cache, and push the merged account state. */
export async function syncTrainingState(): Promise<TrainingState> {
  const local = await get<TrainingState>(KEY);
  try {
    const res = await fetch('/api/training');
    if (!res.ok) return local ?? defaultTrainingState();
    const body = await res.json() as { state: TrainingState | null };
    const merged = local && body.state
      ? mergeTrainingState(local, body.state)
      : local ?? body.state ?? defaultTrainingState();
    await set(KEY, merged);
    void pushTrainingState(merged);
    return merged;
  } catch (error) {
    console.debug('[training] pull failed (offline?)', error);
    return local ?? defaultTrainingState();
  }
}
