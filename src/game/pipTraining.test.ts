import { describe, expect, it } from 'vitest';
import { pipBreakdown } from './pipTraining';
import { pipCounts } from './rules';

const methods = ['urquhart', '321', 'criss-cross'] as const;

describe('pip counting methods', () => {
  it.each(methods)('%s resolves to the exact relative count', (method) => {
    const points = Array(26).fill(0);
    points[24] = 2;
    points[13] = 5;
    points[8] = 3;
    points[6] = 5;
    points[1] = -2;
    points[12] = -5;
    points[17] = -3;
    points[19] = -5;
    const exact = pipCounts(points);
    expect(pipBreakdown(points, method).difference).toBe(exact.mine - exact.theirs);
  });

  it.each(methods)('%s handles bars and borne off checkers', (method) => {
    const points = Array(26).fill(0);
    points[25] = 2;
    points[0] = -1;
    points[3] = 4;
    points[22] = -3;
    const exact = pipCounts(points);
    expect(pipBreakdown(points, method).difference).toBe(exact.mine - exact.theirs);
  });

  it.each(methods)('%s stays exact across varied legal checker layouts', (method) => {
    let seed = 17;
    const random = (max: number) => { seed = (seed * 48271) % 2147483647; return seed % max; };
    for (let sample = 0; sample < 500; sample++) {
      const points = Array(26).fill(0);
      for (const sign of [1, -1]) {
        let placed = 0;
        while (placed < 15) {
          const p = random(26);
          if (points[p] !== 0 && Math.sign(points[p]) !== sign) continue;
          points[p] += sign;
          placed++;
        }
      }
      const exact = pipCounts(points);
      expect(pipBreakdown(points, method).difference).toBe(exact.mine - exact.theirs);
    }
  });
});
