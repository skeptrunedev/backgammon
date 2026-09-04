import type { BoardState } from '../engine/types';
import { pipCounts } from './rules';

export type PipMethod = 'urquhart' | '321' | 'criss-cross';

export interface PipBreakdown {
  method: PipMethod;
  stages: { label: string; value: number }[];
  difference: number;
}

function count(points: number[], from: number, to: number): number {
  let n = 0;
  for (let p = from; p <= to; p++) n += Math.abs(points[p] ?? 0);
  return n;
}

/** Named methods use the XG convention: positive means the player is trailing. */
export function pipBreakdown(points: number[], method: PipMethod): PipBreakdown {
  const exact = pipCounts(points).mine - pipCounts(points).theirs;
  let stages: PipBreakdown['stages'];
  if (method === 'urquhart') {
    // Make the 30 checker locations colorless. Borne off player checkers sit at
    // 0 and borne off opponent checkers at 25, just like the published method.
    const locations: number[] = [];
    let mine = 0;
    let theirs = 0;
    for (let p = 0; p <= 25; p++) {
      const n = points[p] ?? 0;
      mine += Math.max(0, n);
      theirs += Math.max(0, -n);
      for (let i = 0; i < Math.abs(n); i++) locations.push(p);
    }
    locations.push(...Array(Math.max(0, 15 - mine)).fill(0));
    locations.push(...Array(Math.max(0, 15 - theirs)).fill(25));
    locations.sort((a, b) => a - b);
    const black = locations.slice(0, 15);
    const white = locations.slice(15, 30);
    const blackCrossovers = black.reduce((n, p) => n + Math.max(0, Math.floor((p - 1) / 6)), 0);
    const whiteCrossovers = white.reduce((n, p) => n + Math.max(0, Math.floor((24 - p) / 6)), 0);
    const crossovers = (blackCrossovers - whiteCrossovers) * 6;
    const nearTriads = count(points, 1, 3) + count(points, 7, 9) + count(points, 13, 15) + count(points, 19, 21);
    const semi = (15 - nearTriads) * 3;
    stages = [
      { label: 'Colorless crossovers', value: crossovers },
      { label: 'Semi crossovers', value: semi },
      { label: 'Unit crossovers', value: exact - crossovers - semi },
    ];
  } else if (method === '321') {
    const opponentBar = Math.max(0, -(points[0] ?? 0));
    const quadrant321 = (count(points, 1, 6) + opponentBar) * 3 + count(points, 7, 12) * 2 + count(points, 13, 18);
    const doubled = quadrant321 * 2;
    const diagonals = count(points, 1, 3) + opponentBar + count(points, 7, 9) + count(points, 13, 15) + count(points, 19, 21);
    const approximate = (105 - doubled - diagonals) * 3;
    stages = [
      { label: `321 quadrants (${quadrant321}), doubled`, value: doubled },
      { label: `Clockwise triads (${diagonals})`, value: diagonals },
      { label: '105 minus tally, times 3', value: approximate },
      { label: 'Unit adjustment', value: exact - approximate },
    ];
  } else {
    // Coefficients for the eight consecutive triads are the criss cross
    // diagram: four ±1 zones and the two midpoint ±2 zones.
    const myBar = Math.max(0, points[25] ?? 0);
    const opponentBar = Math.max(0, -(points[0] ?? 0));
    const triads = -(count(points, 1, 3) + opponentBar) + count(points, 7, 9) - count(points, 16, 18) + count(points, 22, 24) + myBar;
    const midpoints = 2 * (count(points, 10, 12) - count(points, 13, 15));
    let myStrays = myBar;
    let oppStrays = opponentBar;
    for (let p = 13; p <= 24; p++) myStrays += Math.max(0, points[p] ?? 0);
    for (let p = 1; p <= 12; p++) oppStrays += Math.max(0, -(points[p] ?? 0));
    const strays = 5 * (myStrays - oppStrays);
    const approximate = (triads + midpoints + strays) * 3;
    stages = [
      { label: 'Four signed triads', value: triads },
      { label: 'Midpoint triads, times 2', value: midpoints },
      { label: 'Stray difference, times 5', value: strays },
      { label: 'Criss cross tally, times 3', value: approximate },
      { label: 'Unit adjustment', value: exact - approximate },
    ];
  }
  return { method, stages, difference: exact };
}

export function pipAnswer(board: BoardState) {
  const { mine, theirs } = pipCounts(board.points);
  return {
    mine,
    theirs,
    difference: theirs - mine,
    leader: mine === theirs ? 'Tied' : mine < theirs ? 'You' : 'Opponent',
    margin: Math.abs(theirs - mine),
  } as const;
}
