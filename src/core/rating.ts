/**
 * Estimated game rating. A small ridge-regression model fitted by tools/calibrate.ts on rated
 * Lichess games that carry server-analysis evals (see README "Rating calibration"). The model is
 * a JSON file of coefficients, so inference is a dot product.
 *
 * Features are derived from the per-position eval series - not from our classifications - so
 * calibration (Lichess evals) and inference (our engine) compute them the same way.
 */
import { clamp } from './winpct';

export interface PlayerFeatures {
  accuracy: number;
  acpl: number;
  /** Mean move accuracy / ACPL over "contested" moves (mover's expected points 0.25..0.75 before the move). */
  contestedAccuracy: number;
  contestedAcpl: number;
  /** Share of the player's moves made in contested positions. */
  contestedShare: number;
  opponentAcpl: number;
  /** Share of the player's moves losing >= 0.10 / 0.20 expected points, and 0.05..0.10. */
  mistakeRate: number;
  blunderRate: number;
  inaccuracyRate: number;
  moves: number;
  opponentAccuracy: number;
}

/** A fixed-depth regression tree in heap order: node i has children 2i+1, 2i+2; leaves follow. */
export interface Tree {
  /** Feature index per internal node. */
  f: number[];
  /** Threshold per internal node: value <= t goes left. */
  t: number[];
  /** Leaf values (2^depth). */
  v: number[];
}

export function predictTrees(trees: Tree[], base: number, x: number[]): number {
  let y = base;
  for (const tree of trees) {
    let node = 0;
    const internal = tree.f.length;
    while (node < internal) node = x[tree.f[node]] <= tree.t[node] ? 2 * node + 1 : 2 * node + 2;
    y += tree.v[node - internal];
  }
  return y;
}

export interface RatingModel {
  version: number;
  /** 'linear' (ridge regression) or 'trees' (gradient-boosted trees on raw features). */
  kind?: 'linear' | 'trees';
  trees?: Tree[];
  /** Feature names, in coefficient order (after the intercept). */
  features: string[];
  intercept: number;
  coef: number[];
  /** Standardisation applied to raw features before the dot product. */
  mean: number[];
  std: number[];
  /** Residual standard deviation by number of the player's moves (upper bound of bucket). */
  residual: { maxMoves: number; std: number }[];
  /** Optional linear stretch to undo regression-to-the-mean: out = center + (pred - center) * stretch. */
  stretch?: { center: number; factor: number };
  trainedOn: string;
  metrics: Record<string, number>;
}

export interface RatingEstimate {
  value: number;
  low: number;
  high: number;
  /** Plain-language confidence, driven by game length. */
  confidence: 'low' | 'medium' | 'high';
}

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'unknown';

/** Lichess time classes from a PGN TimeControl tag ("300+3"): estimated duration = base + 40*inc. */
export function timeClass(tc: string | undefined): TimeClass {
  const m = tc?.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return 'unknown';
  const est = Number(m[1]) + 40 * Number(m[2] ?? 0);
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

export function featureVector(f: PlayerFeatures, tc: TimeClass, names: string[]): number[] {
  const all: Record<string, number> = {
    accuracy: f.accuracy,
    accuracy2: (f.accuracy * f.accuracy) / 100,
    logAcpl: Math.log1p(Math.min(f.acpl, 300)),
    mistakeRate: f.mistakeRate,
    blunderRate: f.blunderRate,
    inaccuracyRate: f.inaccuracyRate,
    logMoves: Math.log(Math.max(f.moves, 1)),
    opponentAccuracy: f.opponentAccuracy,
    contestedAccuracy: f.contestedAccuracy,
    logContestedAcpl: Math.log1p(Math.min(f.contestedAcpl, 300)),
    contestedShare: f.contestedShare,
    logOpponentAcpl: Math.log1p(Math.min(f.opponentAcpl, 300)),
    accXmoves: (f.accuracy / 100) * Math.log(Math.max(f.moves, 1)),
    tcBullet: tc === 'bullet' ? 1 : 0,
    tcBlitz: tc === 'blitz' ? 1 : 0,
    tcRapid: tc === 'rapid' ? 1 : 0,
    tcClassical: tc === 'classical' ? 1 : 0,
  };
  return names.map((n) => all[n] ?? 0);
}

export function predict(model: RatingModel, f: PlayerFeatures, tc: TimeClass): number {
  const x = featureVector(f, tc, model.features);
  if (model.kind === 'trees' && model.trees) {
    const y = predictTrees(model.trees, model.intercept, x);
    return model.stretch ? model.stretch.center + (y - model.stretch.center) * model.stretch.factor : y;
  }
  let y = model.intercept;
  x.forEach((v, i) => {
    y += model.coef[i] * ((v - model.mean[i]) / (model.std[i] || 1));
  });
  if (model.stretch) y = model.stretch.center + (y - model.stretch.center) * model.stretch.factor;
  return y;
}

export interface MoveStat {
  /** Expected-points loss (0..1). */
  loss: number;
  cpLoss: number;
  /** Mover's expected points before the move (0..1). */
  winBefore: number;
  /** Per-move accuracy (0..100). */
  accuracy: number;
}

/** Features for one side from its moves' stats (and the opponent's ACPL). */
export function playerFeatures(moves: MoveStat[], accuracy: number, opponentAccuracy: number, opponentAcpl: number): PlayerFeatures {
  const n = Math.max(moves.length, 1);
  const avg = (xs: number[], fallback: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback);
  const contested = moves.filter((m) => m.winBefore >= 0.25 && m.winBefore <= 0.75);
  const acpl = avg(moves.map((m) => m.cpLoss), 0);
  return {
    accuracy,
    acpl,
    contestedAccuracy: avg(contested.map((m) => m.accuracy), accuracy),
    contestedAcpl: avg(contested.map((m) => m.cpLoss), acpl),
    contestedShare: contested.length / n,
    opponentAcpl,
    inaccuracyRate: moves.filter((m) => m.loss >= 0.05 && m.loss < 0.1).length / n,
    mistakeRate: moves.filter((m) => m.loss >= 0.1 && m.loss < 0.2).length / n,
    blunderRate: moves.filter((m) => m.loss >= 0.2).length / n,
    moves: moves.length,
    opponentAccuracy,
  };
}

export function toEstimate(model: RatingModel, raw: number, moves: number): RatingEstimate {
  const value = Math.round(clamp(raw, 400, 3200) / 25) * 25;
  const bucket = model.residual.find((r) => moves <= r.maxMoves) ?? model.residual[model.residual.length - 1];
  // ~50% interval (+-0.674 sd), rounded for display. A single game says little about strength,
  // and the residual spread on held-out games is ~350 points; see DECISIONS.md (D-RAT-1).
  const half = Math.max(100, Math.round((0.674 * bucket.std) / 50) * 50);
  const confidence: RatingEstimate['confidence'] = moves < 20 ? 'low' : moves < 40 ? 'medium' : 'high';
  return { value, low: Math.max(100, value - half), high: value + half, confidence };
}

let cached: Promise<RatingModel> | undefined;
export function loadRatingModel(): Promise<RatingModel> {
  cached ??= import('../data/rating-model.json').then((m) => (m.default ?? m) as RatingModel);
  return cached;
}
