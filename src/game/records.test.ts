import { describe, expect, it } from 'vitest';
import type { BoardState, HintMove } from '../engine/types';
import { buildCheckerDecision } from './records';

const board = { dice: [6, 1], points: [] } as unknown as BoardState;
const hint = (rank: number, equity: number): HintMove => ({
  rank, equity, move: `${rank}/off`, evalDesc: '', diff: 0, probs: null,
});

describe('checker decision grading data', () => {
  it('keeps every acceptable candidate while limiting rich hints', () => {
    const hints = Array.from({ length: 12 }, (_, i) => hint(i + 1, 1 - i * 0.002));
    const decision = buildCheckerDecision(board, hints, hints[0], hints[0].move, 1, 0);
    expect(decision.hints).toHaveLength(8);
    expect(decision.acceptableMoves).toHaveLength(10);
    expect(decision.acceptableMoves?.at(-1)?.move).toBe('10/off');
  });
});
