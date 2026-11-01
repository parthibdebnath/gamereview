/**
 * Deterministic feature detector. Everything here is computed from the board (and, for
 * consequences, from engine lines) - never guessed - so the explanation layer can only state
 * things that are verifiably true.
 */
import { Chess } from 'chess.js';
import {
  Board,
  VALUE,
  flipTurn,
  hangingPieces,
  idx,
  isPassedPawn,
  other,
  playLine,
  see,
  sqName,
  type PieceType,
} from './board';
import type { Side } from './types';

export type FactType =
  | 'checkmate'
  | 'check'
  | 'capture'
  | 'trade'
  | 'castle'
  | 'promotion'
  | 'development'
  | 'center'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered'
  | 'discoveredCheck'
  | 'mateThreat'
  | 'threat'
  | 'hanging'
  | 'escape'
  | 'kingSafety'
  | 'castlingRights'
  | 'passedPawn'
  | 'materialSwing';

export interface Fact {
  type: FactType;
  /** Side that makes / benefits from the action. */
  side: Side;
  /** Relevant squares; the first is the main one (e.g. the forking piece). */
  squares: string[];
  pieces: PieceType[];
  /** 0 (cosmetic) .. 3 (decisive). */
  severity: number;
  /** Extra details: material amount, mate distance, castling side ... */
  data?: Record<string, number | string>;
}

function fact(type: FactType, side: Side, squares: string[], pieces: PieceType[], severity: number, data?: Fact['data']): Fact {
  return { type, side, squares, pieces, severity, data };
}

export interface MoveLike {
  from: string;
  to: string;
  promotion?: string;
}

export function parseUci(u: string): MoveLike {
  return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] };
}

/** Does the side to move in `fen` have a mate in one? Returns the mating move. */
export function mateInOne(fen: string): { san: string; from: string; to: string } | undefined {
  const c = new Chess();
  try {
    c.load(fen, { skipValidation: true });
  } catch {
    return undefined;
  }
  // chess.js marks mating moves with '#' in their SAN: one move generation is enough.
  const m = c.moves({ verbose: true }).find((x) => x.san.endsWith('#'));
  return m ? { san: m.san, from: m.from, to: m.to } : undefined;
}

/** Squares strictly between two squares on a line (empty if not on a line). */
export function between(a: string, b: string): string[] {
  const fa = a.charCodeAt(0), ra = Number(a[1]);
  const fb = b.charCodeAt(0), rb = Number(b[1]);
  const df = Math.sign(fb - fa), dr = Math.sign(rb - ra);
  if (!(fa === fb || ra === rb || Math.abs(fb - fa) === Math.abs(rb - ra))) return [];
  const out: string[] = [];
  for (let f = fa + df, r = ra + dr; f !== fb || r !== rb; f += df, r += dr) out.push(String.fromCharCode(f) + r);
  return out;
}

const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);
const HOME_MINORS: Record<Side, Set<string>> = {
  w: new Set(['b1', 'g1', 'c1', 'f1']),
  b: new Set(['b8', 'g8', 'c8', 'f8']),
};

/**
 * Facts about a single move, judged on the board alone.
 * `plyIndex` is used for opening-phase facts (development, center).
 */
export function moveFacts(fenBefore: string, move: MoveLike, plyIndex = 99): Fact[] {
  const chess = new Chess(fenBefore);
  let m;
  try {
    m = chess.move(move);
  } catch {
    return [];
  }
  const side = m.color as Side;
  const opp = other(side);
  const fenAfter = m.after;
  const before = new Board(fenBefore);
  const after = new Board(fenAfter);
  const piece = m.piece as PieceType;
  const toI = idx(m.to);
  const facts: Fact[] = [];
  const opening = plyIndex < 24 && before.pieceMaterial() >= 50;

  // --- direct effects ------------------------------------------------------------------
  if (chess.isCheckmate()) facts.push(fact('checkmate', side, [m.to], [piece], 3));
  else if (chess.inCheck()) facts.push(fact('check', side, [m.to], [piece], 1));

  if (m.captured) {
    const capturedType = m.captured as PieceType;
    const gain = see(fenBefore, m.to);
    if (VALUE[capturedType] === VALUE[piece] && gain <= 0 && gain > -1 && !chess.isCheckmate()) {
      facts.push(fact('trade', side, [m.to], [piece, capturedType], 1));
    } else {
      facts.push(fact('capture', side, [m.to], [piece, capturedType], gain >= 2 ? 2 : 1, { gain }));
    }
  }
  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    facts.push(fact('castle', side, [m.to], ['k'], 1, { wing: m.isKingsideCastle() ? 'kingside' : 'queenside' }));
  }
  if (m.promotion) facts.push(fact('promotion', side, [m.to], [m.promotion as PieceType], 2));

  if (opening && (piece === 'n' || piece === 'b') && HOME_MINORS[side].has(m.from)) {
    facts.push(fact('development', side, [m.to], [piece], 0));
  }
  if (opening && !m.captured && CENTER.has(m.to) && (piece === 'p' || piece === 'n')) facts.push(fact('center', side, [m.to], [piece], 0));
  if (opening && piece === 'p' && !CENTER.has(m.to)) {
    // A pawn move that controls the center (c4/f4 or c5/f5 from the home rank) is also central play.
    if (['c4', 'f4', 'c5', 'f5'].includes(m.to)) facts.push(fact('center', side, [m.to], [piece], 0));
  }

  // --- tactics created by the moved piece ----------------------------------------------
  const targets = after
    .attacks(toI)
    .map((t) => ({ t, p: after.sq[t] }))
    .filter((x) => x.p && x.p.color === opp);

  // Fork: the moved piece hits two or more things that matter (the king, a more valuable piece,
  // or a piece the opponent can't afford to leave), and it can't simply be taken for free.
  const movedPieceSafe = !hangingPieces(fenAfter, side, 1).some((h) => h.square === m.to);
  const forkTargets = targets.filter(({ t, p }) => {
    if (!p) return false;
    if (p.type === 'k') return true;
    if (p.type === 'p') return false;
    if (VALUE[p.type] > VALUE[piece]) return true;
    // An undefended piece also counts.
    return after.attackers(t, opp).length === 0;
  });
  if (forkTargets.length >= 2 && movedPieceSafe && !chess.isCheckmate()) {
    const valuable = forkTargets.some(({ p }) => p && (p.type === 'k' || p.type === 'q' || p.type === 'r'));
    facts.push(
      fact(
        'fork',
        side,
        [m.to, ...forkTargets.map((x) => sqName(x.t))],
        [piece, ...forkTargets.map((x) => x.p!.type)],
        valuable ? 2 : 1,
      ),
    );
  }

  // Pins and skewers along the moved piece's lines.
  for (const { front, back } of chess.isCheckmate() ? [] : after.rayPairs(toI)) {
    const f = after.sq[front];
    const b = after.sq[back];
    if (!f || !b || f.color !== opp || b.color !== opp) continue;
    if (!after.attacks(toI).includes(front)) continue;
    if (b.type === 'k' && f.type !== 'k') {
      if (f.type !== 'p' || VALUE[piece] < 3) facts.push(fact('pin', side, [m.to, sqName(front), sqName(back)], [piece, f.type, b.type], f.type === 'q' || f.type === 'r' ? 2 : 1, { absolute: 1 }));
    } else if (f.type === 'k' || VALUE[f.type] > VALUE[b.type]) {
      // Skewer: the front piece must move and exposes the one behind it.
      if (b.type !== 'p' && (VALUE[b.type] >= VALUE[piece] || after.attackers(back, opp).length === 0)) {
        facts.push(fact('skewer', side, [m.to, sqName(front), sqName(back)], [piece, f.type, b.type], 2));
      }
    } else if (VALUE[b.type] > VALUE[f.type] && VALUE[b.type] > VALUE[piece] && f.type !== 'p') {
      facts.push(fact('pin', side, [m.to, sqName(front), sqName(back)], [piece, f.type, b.type], 1, { absolute: 0 }));
    }
  }

  // Discovered attacks: lines opened for another of our pieces by moving this one away.
  for (let i = 0; i < 64; i++) {
    const p = after.sq[i];
    if (!p || p.color !== side || i === toI || !['b', 'r', 'q'].includes(p.type)) continue;
    const newHits = after.attacks(i).filter((t) => !before.attacks(i).includes(t));
    for (const t of newHits) {
      const victim = after.sq[t];
      if (!victim || victim.color !== opp) continue;
      if (victim.type === 'k') {
        facts.push(fact('discoveredCheck', side, [sqName(i), sqName(t), m.to], [p.type, 'k', piece], 2));
      } else if (VALUE[victim.type] >= 3 && (VALUE[victim.type] > VALUE[p.type] || after.attackers(t, opp).length === 0)) {
        facts.push(fact('discovered', side, [sqName(i), sqName(t), m.to], [p.type, victim.type, piece], 2));
      }
    }
  }

  // Mate threat: if it were our move again, could we mate? (Not when giving check.)
  if (!chess.inCheck()) {
    const mating = mateInOne(flipTurn(fenAfter));
    // Only threats this move creates: the moved piece mates, or it opened the mating line.
    if (mating && (mating.from === m.to || between(mating.from, mating.to).includes(m.from))) {
      facts.push(fact('mateThreat', side, [m.to], [piece], 2, { move: mating.san }));
    }
  }

  // New threats: the moved piece attacks an enemy piece we could now win.
  if (movedPieceSafe && !facts.some((f) => f.type === 'fork' || f.type === 'checkmate')) {
    const probe = flipTurn(fenAfter);
    const mentioned = new Set(facts.flatMap((f) => (['pin', 'skewer', 'fork', 'discovered'].includes(f.type) ? f.squares.slice(1) : [])));
    for (const { t, p } of targets) {
      if (!p || p.type === 'k' || p.type === 'p' || mentioned.has(sqName(t))) continue;
      const gain = see(probe, sqName(t));
      if (gain >= 2) {
        facts.push(fact('threat', side, [m.to, sqName(t)], [piece, p.type], 1, { gain }));
        break;
      }
    }
  }

  // Safety of our own pieces: newly hanging, or rescued.
  const hangBefore = hangingPieces(flipTurn(fenBefore), side, 1);
  const hangAfter = hangingPieces(fenAfter, side, 1);
  for (const h of hangAfter) {
    if (h.piece === 'p' && h.gain < 2) continue;
    const already = hangBefore.some((b) => b.square === h.square && b.gain >= h.gain);
    if (!already) facts.push(fact('hanging', side, [h.square], [h.piece], h.gain >= 3 ? 2 : 1, { gain: h.gain }));
  }
  const rescued = hangBefore.find((h) => h.square === m.from && h.piece !== 'p');
  if (rescued && !hangAfter.some((h) => h.square === m.to)) facts.push(fact('escape', side, [m.from, m.to], [piece], 1));

  // King safety.
  const king = before.kingSquare(side);
  const kingFile = king % 8;
  const castled = (side === 'w' ? king >= 56 : king <= 7) && (kingFile >= 6 || kingFile <= 2);
  if (piece === 'p' && castled && Math.abs((idx(m.from) % 8) - kingFile) <= 1 && before.pieceMaterial() >= 20) {
    const hasQueen = before.sq.some((p) => p?.type === 'q' && p.color === opp);
    if (hasQueen) facts.push(fact('kingSafety', side, [m.from, m.to], ['p'], 1));
  }
  if (piece === 'k' && !m.isKingsideCastle() && !m.isQueensideCastle()) {
    const rights = fenBefore.split(' ')[2];
    const had = side === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights);
    if (had && before.pieceMaterial() >= 30) facts.push(fact('castlingRights', side, [m.to], ['k'], 1));
  }

  // Passed pawns.
  if (piece === 'p' && !m.promotion && isPassedPawn(after, toI)) {
    const rank = Number(m.to[1]);
    const rel = side === 'w' ? rank : 9 - rank;
    if (rel >= 5) facts.push(fact('passedPawn', side, [m.to], ['p'], rel >= 6 ? 2 : 1, { rank: rel }));
  }

  return facts;
}

/**
 * Material change for `side` along a line, measured at a quiet point: after `plies` half-moves,
 * giving the side that just lost material one ply to recapture. Positive = `side` gains.
 */
export function lineMaterialSwing(fen: string, uci: string[], side: Side, plies = 6): number {
  const { fens, captured } = playLine(fen, uci.slice(0, plies + 2));
  const mats = fens.map((f) => new Board(f).material(side));
  let end = Math.min(plies, mats.length - 1);
  // Don't stop in the middle of an exchange: extend (at most two plies) while captures continue.
  while (end + 1 < mats.length && captured[end] && end < plies + 2) end++;
  return mats[end] - mats[0];
}

export interface LineSummary {
  /** First move of the line in SAN. */
  san: string;
  facts: Fact[];
  /** Material won (+) or lost (-) by the side making the first move, over the line. */
  material: number;
  /** Mate distance for the side making the first move (positive) if the line is mating. */
  mateIn?: number;
}

/** Facts about the first move of an engine line plus its material outcome. */
export function summarizeLine(fen: string, uci: string[], san: string[], plyIndex: number, mate?: number): LineSummary | undefined {
  if (!uci.length || !san.length) return undefined;
  const side = fen.split(' ')[1] as Side;
  const facts = moveFacts(fen, parseUci(uci[0]), plyIndex);
  // Even-length window ending after our move, so a recapture by us is included.
  const len = Math.min(uci.length, 5);
  const material = lineMaterialSwing(fen, uci, side, len);
  return { san: san[0], facts, material, mateIn: mate !== undefined && mate > 0 ? mate : undefined };
}
