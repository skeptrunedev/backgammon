import type { BoardState, HintMove, CubeHint } from '../engine/types';

export interface CheckerDecision {
  kind: 'checker';
  gameNo: number;
  moveNo: number;
  snapshot: BoardState;
  dice: [number, number];
  hints: HintMove[];
  playedMove: string;
  playedEquity: number | null;
  playedRank: number | null;
  bestMove: string;
  bestEquity: number;
  loss: number;
  lossIsEstimate: boolean;
  winPctBest: number | null;
  winPctPlayed: number | null;
  explanation?: string;
}

export interface CubeDecision {
  kind: 'cube';
  sub: 'offer' | 'response';
  gameNo: number;
  moveNo: number;
  snapshot: BoardState;
  hint: CubeHint;
  action: string;
  proper: string;
  loss: number;
  explanation?: string;
}

export type Decision = CheckerDecision | CubeDecision;

export interface MatchRecord {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  matchLength: number;
  playerName: string;
  opponentName: string;
  myScore: number;
  oppScore: number;
  winner: 'me' | 'opponent' | null;
  decisions: Decision[];
  matText: string | null;
  /** gnubg AI ply level, so resume restores the same strength. */
  aiPlies?: number;
  /** gnubg SGF snapshot (`save match`) of the latest stable position, for resume. */
  resumeState?: string;
}

export const BLUNDER = 0.08;
export const ERROR = 0.04;
export const DUBIOUS = 0.02;

export function severity(loss: number): 'blunder' | 'error' | 'dubious' | 'ok' {
  if (loss >= BLUNDER) return 'blunder';
  if (loss >= ERROR) return 'error';
  if (loss >= DUBIOUS) return 'dubious';
  return 'ok';
}

export function decisionLoss(d: Decision): number {
  return d.loss;
}

export function matchStats(rec: MatchRecord) {
  const losses = rec.decisions.map(decisionLoss);
  const total = losses.reduce((a, b) => a + b, 0);
  const counts = { blunder: 0, error: 0, dubious: 0, ok: 0 };
  for (const l of losses) counts[severity(l)]++;
  return {
    decisions: rec.decisions.length,
    totalLoss: total,
    perDecision: rec.decisions.length ? total / rec.decisions.length : 0,
    ...counts,
  };
}

export function buildCheckerDecision(
  snapshot: BoardState,
  hints: HintMove[],
  playedHints: HintMove | null,
  playedMove: string,
  gameNo: number,
  moveNo: number,
): CheckerDecision {
  const best = hints[0] ?? null;
  const bestEquity = best ? best.equity : 0;
  let loss: number;
  let lossIsEstimate = false;
  if (playedHints) {
    loss = Math.max(0, bestEquity - playedHints.equity);
  } else if (hints.length > 0) {
    loss = Math.max(0, bestEquity - hints[hints.length - 1].equity);
    lossIsEstimate = true;
  } else {
    loss = 0;
  }
  return {
    kind: 'checker',
    gameNo,
    moveNo,
    snapshot,
    dice: snapshot.dice,
    hints: hints.slice(0, 8),
    playedMove,
    playedEquity: playedHints ? playedHints.equity : null,
    playedRank: playedHints ? playedHints.rank : null,
    bestMove: best ? best.move : '',
    bestEquity,
    loss,
    lossIsEstimate,
    winPctBest: best?.probs ? best.probs[0] * 100 : null,
    winPctPlayed: playedHints?.probs ? playedHints.probs[0] * 100 : null,
  };
}

function optionEquity(hint: CubeHint, labels: RegExp): number | null {
  const opt = hint.options.find((o) => labels.test(o.label));
  return opt ? opt.equity : null;
}

export function cubeOfferLoss(hint: CubeHint, action: 'roll' | 'double'): number {
  const nd = optionEquity(hint, /^No (re)?double/i);
  const dt = optionEquity(hint, /^(Re)?double, take/i);
  const dp = optionEquity(hint, /^(Re)?double, pass/i);
  if (nd === null || (dt === null && dp === null)) return 0;
  const doubleEq = Math.min(dt ?? Infinity, dp ?? Infinity);
  const bestEq = Math.max(nd, doubleEq);
  const actionEq = action === 'roll' ? nd : doubleEq;
  return Math.max(0, bestEq - actionEq);
}

export function cubeResponseLoss(hint: CubeHint, action: 'take' | 'pass'): number {
  const take = optionEquity(hint, /^(Take|Accept)/i);
  const pass = optionEquity(hint, /^(Pass|Reject)/i);
  if (take === null || pass === null) return 0;
  const bestEq = Math.max(take, pass);
  const actionEq = action === 'take' ? take : pass;
  return Math.max(0, bestEq - actionEq);
}
