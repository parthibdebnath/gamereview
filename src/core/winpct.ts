import type { Score, Side } from './types';

/**
 * Win probability model (Lichess, fitted on rated games):
 *   winPct(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * Returned in percent, 0..100, from the POV of whoever the cp value belongs to.
 */
export const WIN_K = 0.00368208;

export function winPctFromCp(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1);
}

/**
 * How a mate score is turned into a win percentage.
 *  - 'certain': mate = 100 / 0. Used for the eval bar and for move classification, where
 *    missing a forced mate should count as losing (most of) a win.
 *  - 'ceiling': mate = +-1000 cp (about 97.5%). This is what Lichess does for accuracy, and we
 *    keep it there so our accuracy numbers stay comparable with Lichess's.
 */
export type MateMode = 'certain' | 'ceiling';

export const CP_CEILING = 1000;

export function winPct(score: Score, mode: MateMode = 'certain'): number {
  if (score.mate !== undefined) {
    // mate 0 = side to move is mated.
    const winning = score.mate > 0;
    if (mode === 'certain') return winning ? 100 : 0;
    return winPctFromCp(winning ? CP_CEILING : -CP_CEILING);
  }
  const cp = score.cp ?? 0;
  return winPctFromCp(mode === 'ceiling' ? clamp(cp, -CP_CEILING, CP_CEILING) : cp);
}

/** Negate a score: the same evaluation seen from the other side. */
export function negate(score: Score): Score {
  if (score.mate !== undefined) return { mate: -score.mate };
  return { cp: -(score.cp ?? 0) };
}

/** Express a side-to-move score from White's point of view. */
export function toWhite(score: Score, sideToMove: Side): Score {
  return sideToMove === 'w' ? score : negate(score);
}

/** A comparable number for sorting/plotting: mates become very large cp values. */
export function scoreToCp(score: Score): number {
  if (score.mate !== undefined) {
    if (score.mate === 0) return -100000;
    return Math.sign(score.mate) * (100000 - Math.abs(score.mate) * 100);
  }
  return score.cp ?? 0;
}

/** Human-readable eval from White's POV, e.g. "+1.4", "-0.3", "M3", "-M2", "0.0". */
export function formatScore(white: Score, decimals = 1): string {
  if (white.mate !== undefined) {
    if (white.mate === 0) return '#';
    return (white.mate > 0 ? 'M' : '-M') + Math.abs(white.mate);
  }
  const v = (white.cp ?? 0) / 100;
  const s = v.toFixed(decimals);
  if (Number(s) === 0) return (0).toFixed(decimals);
  return v > 0 ? '+' + s : s;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
