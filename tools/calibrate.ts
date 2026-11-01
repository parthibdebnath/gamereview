/**
 * Fits the rating estimator (src/data/rating-model.json) on rated Lichess games that carry
 * server-analysis evals.
 *
 * 1. Get a sample of games with evals from the open Lichess database (CC0):
 *      pip install zstandard
 *      python3 tools/scripts/sample_lichess.py --month 2025-06 --games 30000 --out .data/lichess-evals.pgn
 *    (Streams the month's .pgn.zst from https://database.lichess.org and stops early; only
 *    ~10% of games have evals, so this reads roughly the first 300k games.)
 * 2. npx vite-node tools/calibrate.ts -- [.data/lichess-evals.pgn]
 *
 * Features are computed from the eval series exactly as the app computes them from its own
 * engine (src/core/rating.ts), the target is the player's Lichess rating. A ridge regression
 * on standardised features is fitted on 80% of the players and evaluated on the other 20%.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { trainGbm } from './gbm';
import { predictTrees } from '../src/core/rating';
import { gameAccuracy } from '../src/core/accuracy';
import { featureVector, playerFeatures, timeClass, type MoveStat, type RatingModel, type TimeClass } from '../src/core/rating';
import { CP_CEILING, clamp, winPct } from '../src/core/winpct';
import type { Score } from '../src/core/types';

const FEATURES = [
  'accuracy',
  'accuracy2',
  'logAcpl',
  'inaccuracyRate',
  'mistakeRate',
  'blunderRate',
  'logMoves',
  'opponentAccuracy',
  'contestedAccuracy',
  'logContestedAcpl',
  'contestedShare',
  'logOpponentAcpl',
  'accXmoves',
  'tcBullet',
  'tcBlitz',
  'tcRapid',
  'tcClassical',
];

interface Sample {
  x: number[];
  y: number;
  moves: number;
  tc: TimeClass;
  accuracy: number;
}

function parseEval(s: string): Score | undefined {
  const m = s.match(/\[%eval\s+(#?)(-?[\d.]+)\]/);
  if (!m) return undefined;
  return m[1] ? { mate: Number(m[2]) } : { cp: Math.round(Number(m[2]) * 100) };
}

/** Extract both players' samples from one game. */
function samplesFromGame(text: string): Sample[] {
  const header = (k: string) => text.match(new RegExp(`\\[${k} "([^"]*)"\\]`))?.[1];
  const we = Number(header('WhiteElo'));
  const be = Number(header('BlackElo'));
  if (!we || !be) return [];
  const tc = timeClass(header('TimeControl'));
  const body = text.slice(text.indexOf('\n\n') + 2);
  const re = /([NBRQKOa-h][^\s{}]*)\s*\{([^}]*)\}/g;
  const evals: Score[] = [];
  let last = '';
  let moveCount = 0;
  for (const m of body.matchAll(re)) {
    moveCount++;
    last = m[1];
    const e = parseEval(m[2]);
    if (!e) break;
    evals.push(e);
  }
  const mated = last.endsWith('#');
  if (evals.length < moveCount - (mated ? 1 : 0) || evals.length < 10) return [];
  // White-POV evals of every position: start (Lichess uses +15 cp), then after each move.
  const white: Score[] = [{ cp: 15 }, ...evals];
  if (mated && evals.length === moveCount - 1) white.push({ mate: moveCount % 2 === 1 ? 1e-9 : -1e-9 }); // sign only
  const winC = white.map((s) => (s.mate !== undefined ? (s.mate > 0 ? 100 : 0) : winPct(s, 'certain')));
  const winA = white.map((s) => (s.mate !== undefined ? winPct({ cp: s.mate > 0 ? CP_CEILING : -CP_CEILING }, 'ceiling') : winPct(s, 'ceiling')));
  const cp = white.map((s) => (s.mate !== undefined ? Math.sign(s.mate) * CP_CEILING : clamp(s.cp ?? 0, -CP_CEILING, CP_CEILING)));
  const acc = gameAccuracy(winA, 'w');
  if (acc.white === null || acc.black === null) return [];

  const stats = { w: [] as MoveStat[], b: [] as MoveStat[] };
  for (let i = 0; i < white.length - 1; i++) {
    const side = i % 2 === 0 ? 'w' : 'b';
    const sign = side === 'w' ? 1 : -1;
    const wb = side === 'w' ? winC[i] : 100 - winC[i];
    stats[side].push({
      loss: Math.max(0, (sign * (winC[i] - winC[i + 1])) / 100),
      cpLoss: Math.max(0, sign * (cp[i] - cp[i + 1])),
      winBefore: wb / 100,
      accuracy: acc.perMove[i],
    });
  }
  const out: Sample[] = [];
  for (const side of ['w', 'b'] as const) {
    const mine = stats[side];
    const theirs = stats[side === 'w' ? 'b' : 'w'];
    if (mine.length < 5) continue;
    const a = side === 'w' ? acc.white : acc.black;
    const o = side === 'w' ? acc.black : acc.white;
    const oppAcpl = theirs.reduce((s, m) => s + m.cpLoss, 0) / Math.max(theirs.length, 1);
    const f = playerFeatures(mine, a, o, oppAcpl);
    out.push({ x: featureVector(f, tc, FEATURES), y: side === 'w' ? we : be, moves: mine.length, tc, accuracy: a });
  }
  return out;
}

/** Solve A x = b (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function fitRidge(X: number[][], y: number[], lambda: number, cols: number[]) {
  const k = cols.length;
  const mean = cols.map((c) => X.reduce((s, r) => s + r[c], 0) / X.length);
  const std = cols.map((c, j) => Math.sqrt(X.reduce((s, r) => s + (r[c] - mean[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map((r) => cols.map((c, j) => (r[c] - mean[j]) / std[j]));
  const ym = y.reduce((a, b) => a + b, 0) / y.length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const bvec = Array.from({ length: k }, (_, i) => Z.reduce((s, r, n) => s + r[i] * (y[n] - ym), 0));
  const coef = solve(A, bvec);
  return { intercept: ym, coef, mean, std };
}

function evaluate(pred: number[], y: number[]) {
  const n = y.length;
  const err = pred.map((p, i) => p - y[i]);
  const mae = err.reduce((s, e) => s + Math.abs(e), 0) / n;
  const rmse = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / n);
  const ym = y.reduce((a, b) => a + b, 0) / n;
  const r2 = 1 - err.reduce((s, e) => s + e * e, 0) / y.reduce((s, v) => s + (v - ym) ** 2, 0);
  return { mae, rmse, r2 };
}

function sd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

const file = process.argv.slice(2).filter((a) => a !== '--')[0] ?? '.data/lichess-evals.pgn';
const text = readFileSync(file, 'utf8');
const games = text.split(/\n\n(?=\[Event )/);
const samples = games.flatMap(samplesFromGame);
console.log(`games: ${games.length}, player samples: ${samples.length}`);

// Deterministic 80/20 split by index.
const train = samples.filter((_, i) => i % 5 !== 0);
const test = samples.filter((_, i) => i % 5 === 0);
const predictWith = (m: ReturnType<typeof fitRidge>, cols: number[], x: number[]) =>
  m.intercept + cols.reduce((s, c, j) => s + m.coef[j] * ((x[c] - m.mean[j]) / m.std[j]), 0);

const allCols = FEATURES.map((_, i) => i);
const variants: Record<string, number[]> = {
  'mean rating (no model)': [],
  'accuracy only': [0],
  'accuracy + accuracy^2': [0, 1],
  'v1 (acc, acpl, rates, moves, opp acc, tc)': [0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 15, 16],
  'all features': allCols,
};
const results: Record<string, ReturnType<typeof evaluate>> = {};
for (const [name, cols] of Object.entries(variants)) {
  const m = fitRidge(train.map((s) => s.x), train.map((s) => s.y), 1, cols);
  const pred = test.map((s) => predictWith(m, cols, s.x));
  results[name] = evaluate(pred, test.map((s) => s.y));
  console.log(`${name.padEnd(26)} MAE ${results[name].mae.toFixed(0)}  RMSE ${results[name].rmse.toFixed(0)}  R2 ${results[name].r2.toFixed(3)}`);
}

const model = fitRidge(train.map((s) => s.x), train.map((s) => s.y), 1, allCols);
const linearPred = test.map((s) => predictWith(model, allCols, s.x));
const testY = test.map((s) => s.y);

const t0 = Date.now();
const gbm = trainGbm(train.map((s) => s.x), train.map((s) => s.y), { rounds: 200, depth: 4, learningRate: 0.08, minLeaf: 150, bins: 48 });
const gbmPred = test.map((s) => predictTrees(gbm.trees, gbm.base, s.x));
results.gbm = evaluate(gbmPred, testY);
console.log(`${'gradient-boosted trees'.padEnd(26)} MAE ${results.gbm.mae.toFixed(0)}  RMSE ${results.gbm.rmse.toFixed(0)}  R2 ${results.gbm.r2.toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${gbm.trees.length} trees)`);

// Prefer trees only when they are clearly better on held-out data (simpler model otherwise).
const useTrees = results.gbm.mae < results['all features'].mae - 5;
const testPred = useTrees ? gbmPred : linearPred;
console.log(`chosen: ${useTrees ? 'trees' : 'linear'}`);

// Residual spread by game length (player's moves), used for the displayed range.
const buckets = [15, 25, 35, 50, 9999];
const residual = buckets.map((maxMoves, bi) => {
  const lo = bi ? buckets[bi - 1] : 0;
  const errs = test.map((s, i) => ({ s, e: testPred[i] - testY[i] })).filter(({ s }) => s.moves > lo && s.moves <= maxMoves).map(({ e }) => e);
  return { maxMoves, std: Math.round(sd(errs)), n: errs.length };
});
console.log('residual sd by moves:', residual.map((r) => `<=${r.maxMoves}: ${r.std} (n=${r.n})`).join(', '));

// Regression to the mean: predictions are much narrower than real ratings. Report it; the
// stretch is applied only partially (see DECISIONS.md D-RAT-2).
const spreadRatio = sd(testY) / sd(testPred);
const stretchFactor = 1 + (spreadRatio - 1) * 0.5;
const center = useTrees ? gbm.base : model.intercept;
const stretched = testPred.map((p) => center + (p - center) * stretchFactor);
const sm = evaluate(stretched, testY);
console.log(`spread: ratings sd ${sd(testY).toFixed(0)}, predictions sd ${sd(testPred).toFixed(0)}; half-stretch x${stretchFactor.toFixed(2)} -> MAE ${sm.mae.toFixed(0)} RMSE ${sm.rmse.toFixed(0)}`);

// Calibration table: mean predicted vs actual by accuracy band.
for (const [lo, hi] of [[0, 60], [60, 70], [70, 80], [80, 85], [85, 90], [90, 95], [95, 101]]) {
  const idx = test.map((s, i) => (s.accuracy >= lo && s.accuracy < hi ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) continue;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`acc ${lo}-${hi}: n=${idx.length} actual ${avg(idx.map((i) => testY[i])).toFixed(0)} pred ${avg(idx.map((i) => stretched[i])).toFixed(0)}`);
}

const out: RatingModel = {
  version: 2,
  kind: useTrees ? 'trees' : 'linear',
  ...(useTrees ? { trees: gbm.trees } : {}),
  features: FEATURES,
  intercept: useTrees ? Math.round(gbm.base * 10) / 10 : Math.round(model.intercept * 10) / 10,
  coef: model.coef.map((c) => Math.round(c * 100) / 100),
  mean: model.mean.map((c) => Math.round(c * 10000) / 10000),
  std: model.std.map((c) => Math.round(c * 10000) / 10000),
  residual: residual.map(({ maxMoves, std }) => ({ maxMoves, std: Math.round(std * stretchFactor) })),
  stretch: { center: Math.round(center), factor: Math.round(stretchFactor * 100) / 100 },
  trainedOn: `${samples.length} player-games from ${file.split('/').pop()} (Lichess rated games with server evals)`,
  metrics: {
    testMae: Math.round(sm.mae),
    testRmse: Math.round(sm.rmse),
    testR2: Math.round((useTrees ? results.gbm : results['all features']).r2 * 1000) / 1000,
    baselineMae: Math.round(results['mean rating (no model)'].mae),
  },
};
writeFileSync('src/data/rating-model.json', JSON.stringify(out));
console.log('wrote src/data/rating-model.json');
