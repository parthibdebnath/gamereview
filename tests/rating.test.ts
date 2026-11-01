import { describe, expect, it } from 'vitest';
import { predict, predictTrees, timeClass, toEstimate, playerFeatures } from '../src/core/rating';
import { ratingModel } from './helpers';

describe('rating model', () => {
  it('classifies time controls like Lichess', () => {
    expect(timeClass('60+0')).toBe('bullet');
    expect(timeClass('180+2')).toBe('blitz');
    expect(timeClass('600+0')).toBe('rapid');
    expect(timeClass('1800+20')).toBe('classical');
    expect(timeClass(undefined)).toBe('unknown');
    expect(timeClass('-')).toBe('unknown');
  });
  it('walks trees', () => {
    const tree = { f: [0], t: [5], v: [-1, 1] };
    expect(predictTrees([tree], 10, [3])).toBe(9);
    expect(predictTrees([tree], 10, [7])).toBe(11);
  });
  it('rates clean play above error-strewn play, within a sane range', () => {
    const mk = (acc: number, loss: number, cp: number) =>
      playerFeatures(
        Array.from({ length: 35 }, (_, i) => ({ loss: i % 7 === 0 ? loss : 0.005, cpLoss: i % 7 === 0 ? cp : 5, winBefore: 0.5, accuracy: acc })),
        acc,
        80,
        40,
      );
    const strong = predict(ratingModel, mk(94, 0.03, 30), 'rapid');
    const weak = predict(ratingModel, mk(60, 0.3, 400), 'rapid');
    expect(strong).toBeGreaterThan(weak + 150);
    expect(weak).toBeGreaterThan(400);
    expect(strong).toBeLessThan(3200);
  });
  it('rounds and gives a range', () => {
    const e = toEstimate(ratingModel, 1612, 30);
    expect(e.value).toBe(1600);
    expect(e.low).toBeLessThan(1600);
    expect(e.high).toBeGreaterThan(1600);
    expect(toEstimate(ratingModel, 1612, 10).confidence).toBe('low');
  });
});
