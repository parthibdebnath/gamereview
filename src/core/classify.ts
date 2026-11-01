import { Chess } from 'chess.js';
import { Board, VALUE, flipTurn, hangingPieces, playLine, see, type PieceType } from './board';
import type { ClassifyConfig } from './config';
import type { Classification, PositionAnalysis, Ply, PvLine } from './types';
import { scoreToCp, winPct } from './winpct';

/** Expected points (0..1) for the side to move, from a line. */
export function lineWin(line: PvLine): number {
  return winPct(line.score, 'certain') / 100;
}

/** Expected points for the side to move in an analysed position. */
export function positionWin(a: PositionAnalysis): number {
  if (a.terminal === 'checkmate') return 0;
  if (a.terminal === 'stalemate' || a.terminal === 'draw') return 0.5;
  return a.lines.length ? lineWin(a.lines[0]) : 0.5;
}

export interface Sacrifice {
  /** Net material given up, in pawns. */
  amount: number;
  square: string;
  piece: PieceType;
  /** 'line': the engine line shows the material being taken. 'offer': left en prise, declined. */
  kind: 'line' | 'offer';
}

export interface MoveVerdict {
  classification: Classification;
  /** Classification before special classes were applied (Best..Blunder). */
  base: Classification;
  /** Expected points (0..1) for the mover with best play, and after the played move. */
  winBefore: number;
  winAfter: number;
  /** max(0, winBefore - winAfter). */
  loss: number;
  /** 1-based rank of the played move among the engine lines; 0 = not among them. */
  playedRank: number;
  bestUci?: string;
  /** Gap between the best and the second-best engine move (expected points), if known. */
  bestGap?: number;
  sacrifice?: Sacrifice;
  /** Why a special class was given, for explanations and debugging. */
  reason?: 'only-move' | 'turning-point' | 'sacrifice' | 'missed-win' | 'missed-mate' | 'book' | 'forced';
}

export interface ClassifyInput {
  ply: Ply;
  before: PositionAnalysis;
  after: PositionAnalysis;
  /** Verdict of the opponent's previous move, if any. */
  prev?: MoveVerdict;
  /** Win (mover's POV, 0..1) before the opponent's previous move; for Miss / turning points. */
  winBeforeOpponentMove?: number;
  inBook: boolean;
  config: ClassifyConfig;
  /** The opponent's previous move (for "ignored a fresh threat" sacrifices). */
  prevPly?: Ply;
}

/** Base class from expected-points loss. */
export function baseClass(loss: number, isBest: boolean, cfg: ClassifyConfig): Classification {
  if (isBest) return 'best';
  if (loss <= cfg.excellent) return 'excellent';
  if (loss <= cfg.good) return 'good';
  if (loss <= cfg.inaccuracy) return 'inaccuracy';
  if (loss <= cfg.mistake) return 'mistake';
  return 'blunder';
}

const SEVERITY: Classification[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

/**
 * Walking into a forced mate is judged by how bad things already were (Lichess's rule): from a
 * position worse than -10 it is an inaccuracy, worse than -7 a mistake, otherwise a blunder.
 * Expected-points loss alone under-rates this when the mover was already losing on material.
 * See DECISIONS.md (D-CLS-2).
 */
function mateCreatedFloor(base: Classification, top: PvLine | undefined, played: PvLine | undefined, after: PositionAnalysis): Classification {
  if (!top || (top.score.mate !== undefined && top.score.mate < 0)) return base; // already getting mated
  const getsMated = played
    ? played.score.mate !== undefined && played.score.mate < 0
    : after.lines[0]?.score.mate !== undefined && after.lines[0].score.mate > 0;
  if (!getsMated) return base;
  const cp = top.score.mate !== undefined ? 10000 : top.score.cp ?? 0;
  const floor: Classification = cp < -999 ? 'inaccuracy' : cp < -700 ? 'mistake' : 'blunder';
  return SEVERITY.indexOf(floor) > SEVERITY.indexOf(base) ? floor : base;
}

/**
 * How good the mover's position would be without the played move: the best other engine
 * line, or (with a single line) the eval before the opponent's last move.
 */
function alternativeWin(before: PositionAnalysis, playedUci: string, fallback: number | undefined): number {
  const alt = before.lines.find((l) => l.pv[0] !== playedUci);
  if (alt) return lineWin(alt);
  return fallback ?? (before.lines[0] ? lineWin(before.lines[0]) : 0.5);
}

/** Same evaluation as the top line (within 5 cp, or the same mate distance). */
function equalsTop(top: PvLine, line: PvLine): boolean {
  if (top.score.mate !== undefined || line.score.mate !== undefined) return top.score.mate === line.score.mate;
  return Math.abs(scoreToCp(top.score) - scoreToCp(line.score)) <= 5;
}

export function classifyMove(input: ClassifyInput): MoveVerdict {
  const { ply, before, after, config: cfg } = input;
  const top = before.lines[0];
  const winBefore = top ? lineWin(top) : 0.5;

  const playedIdx = before.lines.findIndex((l) => l.pv[0] === ply.uci);
  const playedLine = playedIdx >= 0 ? before.lines[playedIdx] : undefined;
  // Prefer the played move's own line from the same search: comparing two lines of one search
  // is more consistent than comparing against a separate search of the next position.
  // See DECISIONS.md (D-CLS-1).
  const winAfter = playedLine ? lineWin(playedLine) : 1 - positionWin(after);
  const loss = Math.max(0, winBefore - winAfter);
  const isBest = !top || playedIdx === 0 || (playedLine !== undefined && equalsTop(top, playedLine));

  const second = before.lines[1];
  const bestGap = top && second ? lineWin(top) - lineWin(second) : undefined;

  let base = baseClass(loss, isBest, cfg);
  base = mateCreatedFloor(base, top, playedLine, after);
  const verdict: MoveVerdict = {
    classification: base,
    base,
    winBefore,
    winAfter,
    loss,
    playedRank: playedIdx + 1,
    bestUci: top?.pv[0],
    bestGap,
  };

  if (ply.legalMoves === 1) return { ...verdict, classification: 'forced', reason: 'forced' };
  if (input.inBook) return { ...verdict, classification: 'book', reason: 'book' };

  // --- Brilliant: a sound sacrifice -----------------------------------------------------
  if (cfg.brilliant.enabled && loss <= cfg.brilliant.maxLoss && (base === 'best' || base === 'excellent')) {
    const inCheck = new Chess(ply.fenBefore).inCheck();
    if (
      !(inCheck && ply.legalMoves <= 3) &&
      alternativeWin(before, ply.uci, input.winBeforeOpponentMove) <= cfg.brilliant.maxWinBefore + 1e-9 &&
      winAfter >= cfg.brilliant.minWinAfter
    ) {
      const sac = findSacrifice(ply, after, cfg.brilliant.minSacrifice, input.prevPly);
      if (sac) return { ...verdict, classification: 'brilliant', sacrifice: sac, reason: 'sacrifice' };
    }
  }

  // --- Great: the only good move, or a turning point -----------------------------------
  if (cfg.great.enabled && isBest && bestGap !== undefined && !ply.san.endsWith('#') && !isTrivialMove(ply)) {
    if (bestGap >= cfg.great.onlyMoveGap && winAfter >= cfg.great.minWinAfter && winBefore <= cfg.great.maxWinBefore) {
      return { ...verdict, classification: 'great', reason: 'only-move' };
    }
    const w0 = input.winBeforeOpponentMove;
    if (w0 !== undefined && w0 < cfg.great.flipFrom && winAfter >= cfg.great.flipTo && bestGap >= cfg.great.flipGap) {
      return { ...verdict, classification: 'great', reason: 'turning-point' };
    }
  }

  // --- Miss: failing to punish, or missing a forced mate -------------------------------
  if (cfg.miss.enabled && loss >= cfg.miss.minLoss && winBefore >= cfg.miss.minBestWin) {
    const prevErr = input.prev && ['mistake', 'blunder', 'miss'].includes(input.prev.classification);
    const w0 = input.winBeforeOpponentMove;
    // You handed back the gift but are no worse off than before the opponent's error.
    if (prevErr && w0 !== undefined && winAfter >= w0 - 0.02) {
      return { ...verdict, classification: 'miss', reason: 'missed-win' };
    }
    const mateAvailable = top?.score.mate !== undefined && top.score.mate > 0;
    if (mateAvailable && winAfter >= 0.5) {
      return { ...verdict, classification: 'miss', reason: 'missed-mate' };
    }
  }

  return verdict;
}

/**
 * Moves that are "obviously" the only move and shouldn't be celebrated: recaptures, taking a
 * piece that was simply hanging, and getting out of check.
 */
function isTrivialMove(ply: Ply): boolean {
  if (new Chess(ply.fenBefore).inCheck()) return true;
  // Retreating a piece that was under attack (and would be lost) is obvious.
  if (hangingPieces(flipTurn(ply.fenBefore), ply.side, 1).some((h) => h.square === ply.from)) return true;
  // Any capture that doesn't lose material by static exchange: grabbing a loose piece,
  // recapturing, or a plain trade.
  if (ply.captured && see(ply.fenBefore, ply.to) >= 0) return true;
  return false;
}

/**
 * Material outcome of a line for `side`: how much is given up after the opponent's reply
 * (allowing one ply to recapture) and whether that deficit persists to the end of the window
 * (6 plies) - or the line ends in mate, in which case material doesn't matter.
 */
function lineSacrifice(fen: string, pv: string[], side: 'w' | 'b', mates: boolean): { amount: number; square: string; piece: PieceType } | undefined {
  const { fens, captured } = playLine(fen, pv.slice(0, 7));
  if (fens.length < 3) return undefined;
  const mat = fens.map((f) => new Board(f).material(side));
  const m0 = mat[0];
  // Material after an opponent ply t, letting the mover cash in a capture that is available
  // next - but only what static exchange says it really wins (no "recapture" into a defended
  // piece).
  const deficit = (t: number) => {
    t = Math.min(t, mat.length - 1);
    const nextIsCapture = t < captured.length && captured[t];
    const extra = nextIsCapture ? Math.max(0, see(fens[t], pv[t].slice(2, 4))) : 0;
    return m0 - (mat[t] + extra);
  };
  const last = mat.length - 1;
  const end = last - (last % 2); // after an opponent ply
  const amount = mates ? deficit(2) : Math.min(deficit(2), deficit(end));
  const reply = pv[1];
  const square = reply.slice(2, 4);
  const piece = new Board(fens[1]).get(square)?.type;
  if (!piece || piece === 'p' || piece === 'k') return undefined;
  return { amount, square, piece };
}

/**
 * Detects whether the played move gives up a piece on purpose (see DECISIONS.md D-CLS-3).
 *
 * 1. Line sacrifice: in [played move + engine's best reply line] the opponent wins a piece and
 *    the mover stays at least `minSac` down to the end of the window (or the line mates).
 * 2. Offered sacrifice: a piece is left en prise (static exchange, net of anything the move
 *    itself captured) but the engine's reply doesn't take it. If one of the other engine lines
 *    does take it, that line must also be a real sacrifice (material not simply regained).
 *    Pieces that were already en prise only count when it's a rook/queen whose attack the
 *    opponent created and couldn't act on yet (e.g. Fischer's 17...Be6).
 */
export function findSacrifice(ply: Ply, after: PositionAnalysis, minSac: number, prevPly?: Ply): Sacrifice | undefined {
  const side = ply.side;
  const reply = after.lines[0];
  const mates = (l?: PvLine) => l?.score.mate !== undefined && l.score.mate < 0;

  if (reply && reply.pv.length) {
    const line = lineSacrifice(ply.fenBefore, [ply.uci, ...reply.pv], side, mates(reply));
    if (line && line.amount >= minSac) return { ...line, kind: 'line' };
  }

  const afterHanging = hangingPieces(ply.fenAfter, side, 1).filter((h) => h.piece !== 'p');
  if (!afterHanging.length) return undefined;
  const beforeHanging = hangingPieces(flipTurn(ply.fenBefore), side, 1);
  const replyTarget = reply?.pv[0]?.slice(2, 4);
  const captured = ply.captured ? VALUE[ply.captured as PieceType] : 0;

  for (const h of afterHanging) {
    if (h.square === replyTarget) continue; // handled by the line analysis above
    const net = h.gain - (h.square === ply.to ? captured : 0);
    if (net < minSac) continue;
    // If another engine line accepts the offer, it has to be a genuine sacrifice there too.
    const accepting = after.lines.find((l) => l.pv[0]?.slice(2, 4) === h.square);
    if (accepting) {
      const line = lineSacrifice(ply.fenBefore, [ply.uci, ...accepting.pv], side, mates(accepting));
      if (!line || line.amount < minSac) continue;
    }
    const wasHanging = beforeHanging.some((b) => b.square === h.square && b.gain >= h.gain - 0.5);
    if (!wasHanging) return { amount: net, square: h.square, piece: h.piece, kind: 'offer' };
    if (VALUE[h.piece] >= 5 && prevPly) {
      const p = new Board(prevPly.fenBefore).get(h.square);
      const couldTake = p && p.color === side && see(prevPly.fenBefore, h.square) >= minSac;
      if (!couldTake) return { amount: net, square: h.square, piece: h.piece, kind: 'offer' };
    }
  }
  return undefined;
}
