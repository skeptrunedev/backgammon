import type { BoardState, HintMove, CubeHint, CheckerHop } from './types';
import { BAR, OFF } from './types';

export function parseBoard(line: string): BoardState {
  const f = line.split(':');
  const num = (i: number) => parseInt(f[i], 10);
  const dice: [number, number] =
    num(33) > 0 ? [num(33), num(34)] : [num(35), num(36)];
  return {
    playerName: f[1],
    opponentName: f[2],
    matchLength: num(3),
    myScore: num(4),
    oppScore: num(5),
    points: f.slice(6, 32).map((x) => parseInt(x, 10)),
    turn: num(32),
    dice,
    cubeValue: num(37),
    iMayDouble: num(38) === 1,
    oppMayDouble: num(39) === 1,
    wasDoubled: num(40) !== 0,
    myOff: Math.abs(num(45)),
    oppOff: Math.abs(num(46)),
    crawford: num(51) === 1,
  };
}

const HINT_MOVE_RE =
  /^\s*(\d+)\.\s+(Cubeful|Cubeless)\s+(\S+)\s+(.+?)\s+(?:Eq\.|MWC):\s*([-+]?\d*\.?\d+)%?(?:\s*\(\s*([-+]?\d*\.?\d+)%?\s*\))?\s*$/;
const PROBS_RE =
  /^\s*(\d\.\d+)\s+(\d\.\d+)\s+(\d\.\d+)\s+-\s+(\d\.\d+)\s+(\d\.\d+)\s+(\d\.\d+)\s*$/;

export function parseCheckerHints(lines: string[]): HintMove[] {
  const hints: HintMove[] = [];
  for (const line of lines) {
    const m = HINT_MOVE_RE.exec(line);
    if (m) {
      hints.push({
        rank: parseInt(m[1], 10),
        evalDesc: `${m[2]} ${m[3]}`,
        move: m[4].trim(),
        equity: parseFloat(m[5]),
        diff: m[6] !== undefined ? parseFloat(m[6]) : 0,
        probs: null,
      });
      continue;
    }
    const p = PROBS_RE.exec(line);
    if (p && hints.length > 0 && hints[hints.length - 1].probs === null) {
      hints[hints.length - 1].probs = p.slice(1, 7).map(parseFloat);
    }
  }
  return hints;
}

const CUBE_OPTION_RE =
  /^\s*\d+\.\s+(No (?:re)?double|(?:Re)?[Dd]ouble, (?:pass|take)|Take|Pass|Accept|Reject)\s+([-+]?\d*\.?\d+)(?:\s*\(\s*([-+]?\d*\.?\d+)\s*\))?\s*$/;

export function parseCubeHint(lines: string[]): CubeHint | null {
  const options: CubeHint['options'] = [];
  let proper = '';
  let cubelessEquity: number | null = null;
  let probs: number[] | null = null;
  for (const line of lines) {
    const opt = CUBE_OPTION_RE.exec(line);
    if (opt) {
      options.push({
        label: opt[1],
        equity: parseFloat(opt[2]),
        diff: opt[3] !== undefined ? parseFloat(opt[3]) : 0,
      });
      continue;
    }
    const ce = /cubeless equity\s+([-+]?\d*\.?\d+)/.exec(line);
    if (ce) cubelessEquity = parseFloat(ce[1]);
    const p = PROBS_RE.exec(line);
    if (p && probs === null) probs = p.slice(1, 7).map(parseFloat);
    const pa = /Proper cube action:\s*(.+?)\s*(?:\(.*)?$/.exec(line);
    if (pa) proper = pa[1].trim();
    const ct = /Correct response:\s*(.+?)\s*(?:\(.*)?$/.exec(line);
    if (ct) proper = ct[1].trim();
  }
  if (options.length === 0 && !proper) return null;
  return { cubelessEquity, probs, options, proper };
}

export function parseMoveString(move: string): CheckerHop[] {
  const hops: CheckerHop[] = [];
  for (const part of move.trim().split(/[\s,]+/)) {
    if (!part) continue;
    const repeat = /\((\d+)\)\s*$/.exec(part);
    const n = repeat ? parseInt(repeat[1], 10) : 1;
    const core = part.replace(/\(\d+\)\s*$/, '');
    const segs = core.split('/').map((s) => s.replace(/\*/g, ''));
    const toPoint = (s: string): number => {
      if (/^b(ar)?$/i.test(s)) return BAR;
      if (/^o(ff)?$/i.test(s)) return OFF;
      return parseInt(s, 10);
    };
    for (let r = 0; r < n; r++) {
      for (let i = 0; i + 1 < segs.length; i++) {
        hops.push({ from: toPoint(segs[i]), to: toPoint(segs[i + 1]) });
      }
    }
  }
  return hops;
}

export function hopsToMoveCommand(hops: CheckerHop[]): string {
  return hops
    .map((h) => {
      const from = h.from === BAR ? 'bar' : String(h.from);
      const to = h.to === OFF ? 'off' : String(h.to);
      return `${from}/${to}`;
    })
    .join(' ');
}

export function applyHopsToPoints(points: number[], hops: CheckerHop[]): number[] {
  const p = points.slice();
  for (const h of hops) {
    p[h.from] -= 1;
    if (h.to !== OFF) {
      if (p[h.to] === -1) {
        p[h.to] = 0;
        p[0] -= 1;
      }
      p[h.to] += 1;
    }
  }
  return p;
}

/**
 * Apply one of gnubg's hops (its own point numbering, opponent = negative
 * checkers) to the human-perspective points array. gnubg point N maps to human
 * index 25-N; its bar is index 0. Used to replay gnubg's move hop-by-hop for
 * animation. The final frame always uses the engine's authoritative board, so
 * any reconstruction drift is invisible.
 */
export function applyOppHop(points: number[], hop: CheckerHop): number[] {
  const p = points.slice();
  if (hop.from === BAR) p[0] += 1;
  else p[25 - hop.from] += 1;
  if (hop.to !== OFF) {
    const idx = 25 - hop.to;
    if (p[idx] === 1) {
      p[idx] = 0;
      p[25] += 1;
    }
    p[idx] -= 1;
  }
  return p;
}

export function sameCheckerPlay(
  points: number[],
  a: CheckerHop[],
  b: CheckerHop[],
): boolean {
  const pa = applyHopsToPoints(points, a);
  const pb = applyHopsToPoints(points, b);
  return pa.every((v, i) => v === pb[i]);
}
