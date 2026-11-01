import { clamp } from './winpct';

/**
 * Per-move accuracy from the mover's win% before and after the move (both 0..100).
 *
 *   raw = 103.1668 * exp(-0.04354 * (before - after)) - 3.1669
 *   accuracy = clamp(raw + 1, 0, 100)
 *
 * The +1 is Lichess's "uncertainty bonus" for imperfect analysis (lila AccuracyPercent.scala).
 * A move that doesn't lower the win% scores 100. See DECISIONS.md (D-ACC-1) for why the bonus is kept.
 */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return clamp(raw + 1, 0, 100);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

export interface AccuracyResult {
  /** Accuracy of each player (0..100), or null when the player made no moves. */
  white: number | null;
  black: number | null;
  /** Per-ply accuracy in the mover's view (aligned to the ply sequence). */
  perMove: number[];
}

/**
 * Game accuracy, following Lichess's open method:
 *
 *  1. winWhite[0..n] is White's win% for every position (start position + after each ply).
 *  2. Volatility weights: a window of `w = clamp(n/10, 2, 8)` win% values slides over the game;
 *     each move's weight is the standard deviation of its window, clamped to [0.5, 12]. Moves
 *     made in sharp, swinging positions weigh more than moves in quiet ones. The first (w - 2)
 *     moves reuse the first window so every move has a weight.
 *  3. Per player: final = (weighted arithmetic mean + harmonic mean) / 2.
 *     The harmonic mean punishes a single terrible move much harder than the arithmetic mean,
 *     which is what makes "one blunder" games score visibly lower.
 *
 * `winWhite` must have length plies + 1. `firstSide` is the side that made the first ply.
 */
export function gameAccuracy(winWhite: number[], firstSide: 'w' | 'b' = 'w'): AccuracyResult {
  const n = winWhite.length - 1;
  const perMove: number[] = [];
  if (n <= 0) return { white: null, black: null, perMove };

  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  const windows: number[][] = [];
  const firstWindow = winWhite.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, winWhite.length) - 2; i++) windows.push(firstWindow);
  for (let i = 0; i + windowSize <= winWhite.length; i++) windows.push(winWhite.slice(i, i + windowSize));
  const weights = windows.map((w) => clamp(stdDev(w), 0.5, 12));

  const acc: Record<'w' | 'b', { a: number; w: number }[]> = { w: [], b: [] };
  for (let i = 0; i < n; i++) {
    const side: 'w' | 'b' = (i % 2 === 0) === (firstSide === 'w') ? 'w' : 'b';
    const prev = winWhite[i];
    const next = winWhite[i + 1];
    const a = side === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    perMove.push(a);
    acc[side].push({ a, w: weights[i] ?? weights[weights.length - 1] ?? 1 });
  }

  const combine = (xs: { a: number; w: number }[]): number | null => {
    if (!xs.length) return null;
    const wSum = xs.reduce((s, x) => s + x.w, 0);
    const weighted = xs.reduce((s, x) => s + x.a * x.w, 0) / wSum;
    // Harmonic mean; a 0% move would make it 0, so floor each term at a tiny value.
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(x.a, 0.001), 0);
    return (weighted + harmonic) / 2;
  };

  return { white: combine(acc.w), black: combine(acc.b), perMove };
}
