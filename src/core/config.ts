/**
 * Every tunable number of the classifier, in one place. Losses are expected points (0..1) from
 * the mover's point of view; "win" values are expected points too.
 *
 * The defaults were checked against Lichess's judgments and hand-labelled fixtures; see
 * DECISIONS.md and tools/validate.ts.
 */
export interface ClassifyConfig {
  /** Upper bounds (inclusive) on expected-points loss for each base class. */
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  // anything above `mistake` is a blunder

  brilliant: {
    enabled: boolean;
    /**
     * Net material (pawns) that must be given up, counting what comes back within the line.
     * Only pieces (not pawns) can be sacrificed, so 1 = e.g. a knight for two pawns.
     */
    minSacrifice: number;
    /**
     * Not brilliant when the mover would be this far ahead even without the move, i.e. the best
     * alternative engine line already wins (expected points).
     */
    maxWinBefore: number;
    /** The position after the sacrifice must still be at least this good for the mover. */
    minWinAfter: number;
    /** Max expected-points loss allowed (0 = only the engine's top move). */
    maxLoss: number;
  };

  great: {
    enabled: boolean;
    /** Gap between the best and second-best line for an "only move". */
    onlyMoveGap: number;
    /** The only move must keep at least this much (no "great" for the best of bad options). */
    minWinAfter: number;
    /** Already completely winning (e.g. inside a mating net): the only move is just "best". */
    maxWinBefore: number;
    /** Turning point: the mover's chances before the opponent's last move were below this ... */
    flipFrom: number;
    /** ... and after this move they are above this. */
    flipTo: number;
    /** Turning points still need a clear gap to the second-best move. */
    flipGap: number;
  };

  miss: {
    enabled: boolean;
    /** Minimum loss versus the best move to count as a missed chance. */
    minLoss: number;
    /** The best move must have given at least this (a real chance existed). */
    minBestWin: number;
  };

  /** Book is only assigned while every earlier move was also book. */
  bookContiguous: boolean;
}

export const DEFAULT_CONFIG: ClassifyConfig = {
  excellent: 0.02,
  good: 0.05,
  inaccuracy: 0.1,
  mistake: 0.2,
  brilliant: {
    enabled: true,
    minSacrifice: 1,
    maxWinBefore: 0.85,
    minWinAfter: 0.4,
    maxLoss: 0.02,
  },
  great: {
    enabled: true,
    onlyMoveGap: 0.15,
    minWinAfter: 0.3,
    maxWinBefore: 0.9,
    flipFrom: 0.4,
    flipTo: 0.6,
    flipGap: 0.1,
  },
  miss: {
    enabled: true,
    minLoss: 0.1,
    minBestWin: 0.7,
  },
  bookContiguous: true,
};

/** Sensitivity presets exposed in Settings for the two "special" classes. */
export type Sensitivity = 'strict' | 'normal' | 'generous';

export function withSensitivity(base: ClassifyConfig, brilliant: Sensitivity, great: Sensitivity): ClassifyConfig {
  const b = { ...base.brilliant };
  const g = { ...base.great };
  if (brilliant === 'strict') Object.assign(b, { minSacrifice: 2, maxWinBefore: 0.75, minWinAfter: 0.5, maxLoss: 0 });
  if (brilliant === 'generous') Object.assign(b, { minSacrifice: 1, maxWinBefore: 0.92, minWinAfter: 0.3, maxLoss: 0.04 });
  if (great === 'strict') Object.assign(g, { onlyMoveGap: 0.25, flipGap: 0.2 });
  if (great === 'generous') Object.assign(g, { onlyMoveGap: 0.1, flipGap: 0.06 });
  return { ...base, brilliant: b, great: g };
}
