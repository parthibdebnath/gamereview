import { gameAccuracy } from './accuracy';
import { classifyMove, positionWin, type MoveVerdict } from './classify';
import { DEFAULT_CONFIG, type ClassifyConfig } from './config';
import type { OpeningBook, Opening } from './openings';
import { uciLineToSan } from './pgn';
import type { Classification, ParsedGame, PositionAnalysis, Ply, Score, Side } from './types';
import { CLASSIFICATIONS } from './types';
import { CP_CEILING, clamp, scoreToCp, toWhite, winPct } from './winpct';
import { explainMove, type Explanation } from './explain';
import { playerFeatures, predict, timeClass, toEstimate, type MoveStat, type RatingEstimate, type RatingModel } from './rating';

export interface PositionEval {
  /** White-POV score; undefined while not analysed yet. */
  score?: Score;
  /** White's win% (0..100) for the eval bar / graph ('certain' mate handling). */
  winWhite?: number;
  terminal?: PositionAnalysis['terminal'];
  depth?: number;
}

export interface MoveReview {
  ply: Ply;
  verdict: MoveVerdict;
  /** Per-move accuracy (0..100) as used in the game accuracy. */
  accuracy: number;
  /** Centipawn loss (mover's POV, capped at 1000). */
  cpLoss: number;
  bestSan?: string;
  /** Engine's best line from the position before the move (SAN). */
  bestLine: string[];
  /** Engine's continuation after the played move (SAN), starting with the opponent's reply. */
  replyLine: string[];
  opening?: Opening;
  explanation: Explanation;
}

export interface PlayerSummary {
  side: Side;
  name: string;
  elo?: number;
  accuracy: number | null;
  acpl: number;
  moves: number;
  counts: Record<Classification, number>;
  rating?: RatingEstimate;
}

export interface GameReview {
  game: ParsedGame;
  positions: PositionEval[];
  /** One entry per ply; undefined for plies not analysed yet. */
  moves: (MoveReview | undefined)[];
  white: PlayerSummary;
  black: PlayerSummary;
  opening?: Opening;
  /** Ply indices worth jumping to (brilliant, great, miss, mistake, blunder). */
  keyMoments: number[];
  complete: boolean;
}

export interface ReviewOptions {
  config?: ClassifyConfig;
  book?: OpeningBook;
  ratingModel?: RatingModel;
  /**
   * Per-move memo for incremental rebuilds while analysis streams in. A move's verdict and
   * explanation depend only on its own inputs, which are captured in the memo key.
   */
  memo?: ReviewMemo;
  /**
   * Per-move accuracy loss (DECISIONS.md D-ACC-2):
   *  - 'top' (default): when the played move is the engine's top line, it is charged the smaller
   *    of its same-search loss (0) and the position-to-position loss, so a best move is never
   *    penalised for horizon noise between two searches. Everything else as Lichess.
   *  - 'sequential': Lichess's plain position-to-position method.
   *  - 'hybrid': like 'top' for any move found among the engine lines.
   */
  accuracyMode?: 'hybrid' | 'sequential' | 'top';
}

type MoveCore = Pick<MoveReview, 'verdict' | 'bestSan' | 'bestLine' | 'replyLine' | 'explanation'>;
export type ReviewMemo = WeakMap<PositionAnalysis, Map<string, MoveCore>>;
export function createMemo(): ReviewMemo {
  return new WeakMap();
}

function sideToMove(fen: string): Side {
  return fen.split(' ')[1] as Side;
}

/** Eval of a position from White's POV. */
export function positionEval(fen: string, a: PositionAnalysis | undefined): PositionEval {
  if (!a) return {};
  const stm = sideToMove(fen);
  if (a.terminal === 'checkmate') {
    // mate 0 renders as "#"; the bar/graph use winWhite.
    return { score: { mate: 0 }, winWhite: stm === 'w' ? 0 : 100, terminal: a.terminal, depth: 0 };
  }
  if (a.terminal) return { score: { cp: 0 }, winWhite: 50, terminal: a.terminal, depth: 0 };
  const top = a.lines[0];
  if (!top) return {};
  const white = toWhite(top.score, stm);
  return { score: white, winWhite: winPct(white, 'certain'), depth: a.depth };
}

/** White win% for accuracy (Lichess convention: cp ceiling, mate = +-1000 cp). */
function accuracyWin(fen: string, a: PositionAnalysis): number {
  const stm = sideToMove(fen);
  if (a.terminal === 'checkmate') return stm === 'w' ? winPct({ cp: -CP_CEILING }, 'ceiling') : winPct({ cp: CP_CEILING }, 'ceiling');
  if (a.terminal) return 50;
  const top = a.lines[0];
  return top ? winPct(toWhite(top.score, stm), 'ceiling') : 50;
}

function cappedCp(score: Score): number {
  return clamp(scoreToCp(score), -CP_CEILING, CP_CEILING);
}

/** White-POV centipawns for ACPL. */
function whiteCp(fen: string, a: PositionAnalysis): number {
  const stm = sideToMove(fen);
  if (a.terminal === 'checkmate') return stm === 'w' ? -CP_CEILING : CP_CEILING;
  if (a.terminal) return 0;
  return a.lines[0] ? cappedCp(toWhite(a.lines[0].score, stm)) : 0;
}

function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
}

export function buildReview(game: ParsedGame, analyses: (PositionAnalysis | undefined)[], opts: ReviewOptions = {}): GameReview {
  const cfg = opts.config ?? DEFAULT_CONFIG;
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  const positions = fens.map((f, i) => positionEval(f, analyses[i]));

  // Book: contiguous from the start (by default), plus the deepest opening name reached.
  const inBook: boolean[] = [];
  let stillBook = true;
  let opening: Opening | undefined;
  game.plies.forEach((p, i) => {
    const has = opts.book?.has(p.fenAfter) ?? false;
    inBook[i] = has && (cfg.bookContiguous ? stillBook : true);
    if (!has) stillBook = false;
    const named = opts.book?.name(p.fenAfter);
    if (named && i < 40) opening = named;
  });

  // Accuracy needs the full prefix of analysed positions.
  let analysedPrefix = 0;
  while (analysedPrefix < fens.length && analyses[analysedPrefix]) analysedPrefix++;
  const winsForAcc = fens.slice(0, analysedPrefix).map((f, i) => accuracyWin(f, analyses[i]!));
  const firstSide = game.plies[0]?.side ?? 'w';
  const mode = opts.accuracyMode ?? 'top';
  const override = mode !== 'sequential'
    ? game.plies.map((p, i) => {
        const a = analyses[i];
        if (!a || i + 1 >= analysedPrefix) return undefined;
        const played = mode === 'top' ? (a.lines[0]?.pv[0] === p.uci ? a.lines[0] : undefined) : a.lines.find((l) => l.pv[0] === p.uci);
        if (!played || !a.lines[0]) return undefined;
        return Math.max(0, winPct(a.lines[0].score, 'ceiling') - winPct(played.score, 'ceiling'));
      })
    : undefined;
  const acc = gameAccuracy(winsForAcc, firstSide, override);

  const cfgKey = JSON.stringify(cfg);
  const moves: (MoveReview | undefined)[] = [];
  for (let i = 0; i < game.plies.length; i++) {
    const ply = game.plies[i];
    const before = analyses[i];
    const after = analyses[i + 1];
    if (!before || !after) {
      moves.push(undefined);
      continue;
    }
    const prev = moves[i - 1];
    const prevBefore = i > 0 ? analyses[i - 1] : undefined;
    // Mover's expected points before the opponent's last move = 1 - opponent's win then.
    const winBeforeOpponentMove = prevBefore ? 1 - positionWin(prevBefore) : undefined;
    const memoKey = [
      i,
      cfgKey,
      inBook[i],
      prev?.verdict.classification ?? '-',
      winBeforeOpponentMove?.toFixed(4) ?? '-',
      after.depth,
      after.lines[0]?.pv[0] ?? '-',
    ].join('|');
    let core = opts.memo?.get(before)?.get(memoKey);
    if (!core) {
      const verdict = classifyMove({
        ply,
        before,
        after,
        prev: prev?.verdict,
        winBeforeOpponentMove,
        inBook: inBook[i],
        config: cfg,
        prevPly: game.plies[i - 1],
      });
      const bestLine = before.lines[0] ? uciLineToSan(ply.fenBefore, before.lines[0].pv, 10) : [];
      const replyLine = after.lines[0] ? uciLineToSan(ply.fenAfter, after.lines[0].pv, 10) : [];
      const explanation = explainMove({
        ply,
        verdict,
        before,
        after,
        bestLine,
        replyLine,
        opening: opts.book?.name(ply.fenAfter) ?? (inBook[i] ? opening : undefined),
        prev,
      });
      core = { verdict, bestSan: bestLine[0], bestLine, replyLine, explanation };
      if (opts.memo) {
        const m = opts.memo.get(before) ?? new Map();
        m.set(memoKey, core);
        opts.memo.set(before, m);
      }
    }
    const sign = ply.side === 'w' ? 1 : -1;
    const cpLoss = Math.max(0, sign * (whiteCp(fens[i], before) - whiteCp(fens[i + 1], after)));
    const mr: MoveReview = {
      ply,
      ...core,
      accuracy: acc.perMove[i] ?? 0,
      cpLoss,
      opening: opts.book?.name(ply.fenAfter),
    };
    moves.push(mr);
  }

  const summary = (side: Side): PlayerSummary => {
    const mine = moves.filter((m): m is MoveReview => !!m && m.ply.side === side);
    const counts = emptyCounts();
    for (const m of mine) counts[m.verdict.classification]++;
    const name = game.headers[side === 'w' ? 'White' : 'Black'] || (side === 'w' ? 'White' : 'Black');
    const eloRaw = Number(game.headers[side === 'w' ? 'WhiteElo' : 'BlackElo']);
    const s: PlayerSummary = {
      side,
      name: name === '?' ? (side === 'w' ? 'White' : 'Black') : name,
      elo: Number.isFinite(eloRaw) && eloRaw > 0 ? eloRaw : undefined,
      accuracy: side === 'w' ? acc.white : acc.black,
      acpl: mine.length ? mine.reduce((a, m) => a + m.cpLoss, 0) / mine.length : 0,
      moves: mine.length,
      counts,
    };
    return s;
  };

  const white = summary('w');
  const black = summary('b');
  const complete = analysedPrefix === fens.length;
  if (complete && opts.ratingModel && game.plies.length >= 10) {
    // Rating features use the plain position-to-position eval series (same as calibration).
    const tc = timeClass(game.headers.TimeControl);
    for (const s of [white, black]) {
      const opp = s === white ? black : white;
      const stats: MoveStat[] = [];
      let oppCp = 0;
      let oppN = 0;
      game.plies.forEach((p, i) => {
        const wb = positions[i].winWhite! / 100;
        const wa = positions[i + 1].winWhite! / 100;
        if (p.side !== s.side) {
          oppCp += moves[i]!.cpLoss;
          oppN++;
          return;
        }
        stats.push({
          loss: Math.max(0, p.side === 'w' ? wb - wa : wa - wb),
          cpLoss: moves[i]!.cpLoss,
          winBefore: p.side === 'w' ? wb : 1 - wb,
          accuracy: acc.perMove[i],
        });
      });
      if (s.accuracy === null || stats.length < 5) continue;
      const f = playerFeatures(stats, s.accuracy, opp.accuracy ?? s.accuracy, oppN ? oppCp / oppN : 0);
      s.rating = toEstimate(opts.ratingModel, predict(opts.ratingModel, f, tc), stats.length);
    }
  }

  const keyMoments = moves
    .map((m, i) => (m && ['brilliant', 'great', 'miss', 'mistake', 'blunder'].includes(m.verdict.classification) ? i : -1))
    .filter((i) => i >= 0);

  return { game, positions, moves, white, black, opening, keyMoments, complete };
}

/**
 * Positions worth a deeper second look: both positions around every move that is critical
 * (mistake, blunder, miss, brilliant, great) or whose loss sits near a class boundary, plus
 * moves where the engine's top choice was a narrow call. Ordered by importance and capped at
 * `maxShare` of the game.
 */
export function criticalPositions(review: GameReview, cfg: ClassifyConfig = DEFAULT_CONFIG, maxShare = 0.6): number[] {
  const score = new Map<number, number>();
  const bump = (i: number, s: number) => score.set(i, Math.max(score.get(i) ?? 0, s));
  const bounds = [cfg.excellent, cfg.good, cfg.inaccuracy, cfg.mistake];
  review.moves.forEach((m, i) => {
    if (!m) return;
    const c = m.verdict.classification;
    if (c === 'book' || c === 'forced') return;
    let s = 0;
    if (c === 'blunder' || c === 'miss' || c === 'brilliant') s = 5;
    else if (c === 'mistake' || c === 'great') s = 4;
    else if (c === 'inaccuracy') s = 3;
    const near = bounds.some((b) => Math.abs(m.verdict.loss - b) <= 0.025);
    if (near) s = Math.max(s, 2);
    // A close call between the top two engine moves can flip Best/Excellent/Great.
    if (m.verdict.bestGap !== undefined && m.verdict.bestGap < 0.01 && m.verdict.playedRank !== 1) s = Math.max(s, 1);
    if (!s) return;
    bump(i, s);
    bump(i + 1, s);
  });
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => i);
  const cap = Math.max(1, Math.floor(review.positions.length * maxShare));
  return ranked.slice(0, cap).sort((a, b) => a - b);
}
