import { describe, expect, it } from 'vitest';
import { gameAccuracy, moveAccuracy } from '../src/core/accuracy';

describe('move accuracy', () => {
  it('is 100 when the move loses nothing (or gains)', () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(40, 55)).toBe(100);
  });
  it('follows the Lichess curve with the +1 uncertainty bonus', () => {
    // 103.1668 * exp(-0.04354 * 10) - 3.1669 + 1 = 64.6
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.6, 1);
    expect(moveAccuracy(50, 49)).toBeCloseTo(96.6, 1);
  });
  it('bottoms out at 0 for huge drops', () => {
    expect(moveAccuracy(100, 0)).toBe(0);
  });
});

describe('game accuracy', () => {
  it('is null for a side without moves', () => {
    const r = gameAccuracy([50, 50]);
    expect(r.white).not.toBeNull();
    expect(r.black).toBeNull();
  });
  it('is ~100 when nobody loses anything', () => {
    const r = gameAccuracy(new Array(41).fill(52));
    expect(r.white).toBeCloseTo(100, 5);
    expect(r.black).toBeCloseTo(100, 5);
  });
  it('a single blunder costs far more than its share of the average (harmonic mean)', () => {
    const wins = new Array(41).fill(50);
    // Black blunders on ply 20 (index 20 -> 21): White's win% jumps to 85 and stays.
    // Black's move from position 21 to 22 (ply 21) is a blunder: White's win% jumps to 85.
    for (let i = 22; i < wins.length; i++) wins[i] = 85;
    const r = gameAccuracy(wins);
    expect(r.white).toBeCloseTo(100, 3);
    expect(r.perMove[21]).toBeLessThan(25);
    const blackMoves = r.perMove.filter((_, i) => i % 2 === 1);
    const arithmetic = blackMoves.reduce((a, b) => a + b, 0) / blackMoves.length;
    expect(arithmetic).toBeGreaterThan(95);
    // Volatility weighting + harmonic mean pull the score well below the plain average.
    expect(r.black!).toBeLessThan(arithmetic - 8);
  });
  it('handles games starting with Black to move', () => {
    const r = gameAccuracy([50, 50, 30], 'b');
    // Ply 1 (index 1) is White's and drops 20 points.
    expect(r.black).toBeCloseTo(100, 5);
    expect(r.white!).toBeLessThan(60);
  });
});
