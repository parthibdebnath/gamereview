import { describe, expect, it } from 'vitest';
import { formatScore, negate, scoreToCp, toWhite, winPct, winPctFromCp } from '../src/core/winpct';

describe('win probability', () => {
  it('is 50% at equality and symmetric', () => {
    expect(winPctFromCp(0)).toBe(50);
    expect(winPctFromCp(150) + winPctFromCp(-150)).toBeCloseTo(100, 10);
  });
  it('matches the Lichess curve at known points', () => {
    // 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    expect(winPctFromCp(100)).toBeCloseTo(59.1, 1);
    expect(winPctFromCp(300)).toBeCloseTo(75.1, 1);
    expect(winPctFromCp(-500)).toBeCloseTo(13.7, 1);
  });
  it('is monotonic', () => {
    let prev = -1;
    for (let cp = -2000; cp <= 2000; cp += 50) {
      const w = winPctFromCp(cp);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });
  it('maps mates to certainty for the bar/classification', () => {
    expect(winPct({ mate: 3 })).toBe(100);
    expect(winPct({ mate: -1 })).toBe(0);
    expect(winPct({ mate: 0 })).toBe(0); // side to move is mated
  });
  it('maps mates to the cp ceiling in Lichess accuracy mode', () => {
    expect(winPct({ mate: 2 }, 'ceiling')).toBeCloseTo(winPctFromCp(1000), 10);
    expect(winPct({ cp: 5000 }, 'ceiling')).toBeCloseTo(winPctFromCp(1000), 10);
  });
});

describe('score helpers', () => {
  it('negates and converts to White POV', () => {
    expect(negate({ cp: 35 })).toEqual({ cp: -35 });
    expect(negate({ mate: 2 })).toEqual({ mate: -2 });
    expect(toWhite({ cp: 40 }, 'b')).toEqual({ cp: -40 });
    expect(toWhite({ cp: 40 }, 'w')).toEqual({ cp: 40 });
  });
  it('orders mates beyond any cp score', () => {
    expect(scoreToCp({ mate: 5 })).toBeGreaterThan(scoreToCp({ cp: 5000 }));
    expect(scoreToCp({ mate: 1 })).toBeGreaterThan(scoreToCp({ mate: 5 }));
    expect(scoreToCp({ mate: -2 })).toBeLessThan(scoreToCp({ cp: -5000 }));
  });
  it('formats evals', () => {
    expect(formatScore({ cp: 140 })).toBe('+1.4');
    expect(formatScore({ cp: -32 })).toBe('-0.3');
    expect(formatScore({ cp: 3 })).toBe('0.0');
    expect(formatScore({ mate: 3 })).toBe('M3');
    expect(formatScore({ mate: -2 })).toBe('-M2');
    expect(formatScore({ mate: 0 })).toBe('#');
  });
});
