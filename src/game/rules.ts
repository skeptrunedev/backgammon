import type { CheckerHop } from '../engine/types';
import { BAR, OFF } from '../engine/types';
import { applyHopsToPoints } from '../engine/parse';

function singleHops(points: number[], die: number): CheckerHop[] {
  const hops: CheckerHop[] = [];
  if (points[BAR] > 0) {
    const to = BAR - die;
    if (points[to] >= -1) hops.push({ from: BAR, to });
    return hops;
  }
  const highest = highestPoint(points);
  const allHome = highest <= 6;
  for (let from = 1; from <= 24; from++) {
    if (points[from] <= 0) continue;
    const to = from - die;
    if (to >= 1) {
      if (points[to] >= -1) hops.push({ from, to });
    } else if (allHome) {
      if (from === die || (from < die && from === highest)) {
        hops.push({ from, to: OFF });
      }
    }
  }
  return hops;
}

function highestPoint(points: number[]): number {
  if (points[BAR] > 0) return BAR;
  for (let i = 24; i >= 1; i--) if (points[i] > 0) return i;
  return 0;
}

function gen(
  points: number[],
  dice: number[],
  prefix: CheckerHop[],
  out: CheckerHop[][],
): void {
  if (dice.length === 0) {
    out.push(prefix);
    return;
  }
  const hops = singleHops(points, dice[0]);
  if (hops.length === 0) {
    out.push(prefix);
    return;
  }
  for (const hop of hops) {
    gen(
      applyHopsToPoints(points, [hop]),
      dice.slice(1),
      [...prefix, hop],
      out,
    );
  }
}

export function legalSequences(
  points: number[],
  dice: [number, number],
): CheckerHop[][] {
  const [a, b] = dice;
  const raw: CheckerHop[][] = [];
  if (a === b) {
    gen(points, [a, a, a, a], [], raw);
  } else {
    gen(points, [a, b], [], raw);
    gen(points, [b, a], [], raw);
  }
  const maxLen = raw.reduce((m, s) => Math.max(m, s.length), 0);
  let seqs = raw.filter((s) => s.length === maxLen);
  if (maxLen === 1 && a !== b) {
    const hi = Math.max(a, b);
    const hiHops = singleHops(points, hi);
    const hiOnly = seqs.filter((s) =>
      hiHops.some((h) => h.from === s[0].from && h.to === s[0].to),
    );
    if (hiOnly.length > 0) seqs = hiOnly;
  }
  const seen = new Set<string>();
  return seqs.filter((s) => {
    const key = s.map((h) => `${h.from}>${h.to}`).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function continuations(
  sequences: CheckerHop[][],
  played: CheckerHop[],
): CheckerHop[] {
  const nexts: CheckerHop[] = [];
  const seen = new Set<string>();
  for (const seq of sequences) {
    if (seq.length <= played.length) continue;
    let match = true;
    for (let i = 0; i < played.length; i++) {
      if (seq[i].from !== played[i].from || seq[i].to !== played[i].to) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const h = seq[played.length];
    const key = `${h.from}>${h.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      nexts.push(h);
    }
  }
  return nexts;
}

export function isComplete(
  sequences: CheckerHop[][],
  played: CheckerHop[],
): boolean {
  return sequences.some(
    (seq) =>
      seq.length === played.length &&
      seq.every(
        (h, i) => h.from === played[i].from && h.to === played[i].to,
      ),
  );
}

export function hopIsHit(points: number[], hop: CheckerHop): boolean {
  return hop.to !== OFF && points[hop.to] === -1;
}

export function pipCounts(points: number[]): { mine: number; theirs: number } {
  let mine = 0;
  let theirs = 0;
  for (let i = 1; i <= 24; i++) {
    const v = points[i];
    if (v > 0) mine += v * i;
    else if (v < 0) theirs += -v * (25 - i);
  }
  mine += points[BAR] * 25;
  theirs += -points[0] * 25;
  return { mine, theirs };
}
