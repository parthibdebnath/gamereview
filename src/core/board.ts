/**
 * Lightweight board geometry on top of FEN, used by the feature detector and the Brilliant
 * check. chess.js handles legality; this module answers "what attacks what" questions that
 * chess.js doesn't expose (rays, x-rays, pins), and runs static exchange evaluation.
 */
import { Chess } from 'chess.js';
import type { Side } from './types';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface BoardPiece {
  type: PieceType;
  color: Side;
}

export const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/** Board indexed 0..63, a8 = 0, h1 = 63 (FEN order). */
export class Board {
  readonly sq: (BoardPiece | null)[] = new Array(64).fill(null);
  readonly turn: Side;

  constructor(readonly fen: string) {
    const [placement, turn] = fen.split(' ');
    this.turn = turn as Side;
    let i = 0;
    for (const ch of placement) {
      if (ch === '/') continue;
      if (/\d/.test(ch)) {
        i += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase() as PieceType;
      this.sq[i++] = { type: lower, color: ch === lower ? 'b' : 'w' };
    }
  }

  get(name: string): BoardPiece | null {
    return this.sq[idx(name)];
  }

  /** Squares attacked by the piece on `from` (pseudo-legal; ignores pins). */
  attacks(from: number): number[] {
    const p = this.sq[from];
    if (!p) return [];
    const out: number[] = [];
    const f = from % 8;
    const r = Math.floor(from / 8);
    const add = (df: number, dr: number) => {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf);
    };
    const slide = (dirs: number[][]) => {
      for (const [df, dr] of dirs) {
        let nf = f + df;
        let nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const t = nr * 8 + nf;
          out.push(t);
          if (this.sq[t]) break;
          nf += df;
          nr += dr;
        }
      }
    };
    switch (p.type) {
      case 'p': {
        const dr = p.color === 'w' ? -1 : 1;
        add(-1, dr);
        add(1, dr);
        break;
      }
      case 'n':
        for (const [a, b] of KNIGHT) add(a, b);
        break;
      case 'k':
        for (const [a, b] of KING) add(a, b);
        break;
      case 'b':
        slide(DIAG);
        break;
      case 'r':
        slide(ORTHO);
        break;
      case 'q':
        slide(DIAG);
        slide(ORTHO);
        break;
    }
    return out;
  }

  /** Indices of `color` pieces attacking `target`. */
  attackers(target: number, color: Side): number[] {
    const out: number[] = [];
    for (let i = 0; i < 64; i++) {
      const p = this.sq[i];
      if (p && p.color === color && this.attacks(i).includes(target)) out.push(i);
    }
    return out;
  }

  kingSquare(color: Side): number {
    return this.sq.findIndex((p) => p?.type === 'k' && p.color === color);
  }

  /** Material from `color`'s point of view (own minus opponent), pawn = 1. */
  material(color: Side): number {
    let m = 0;
    for (const p of this.sq) if (p) m += (p.color === color ? 1 : -1) * VALUE[p.type];
    return m;
  }

  /** Total non-pawn, non-king material on the board (for game phase). */
  pieceMaterial(): number {
    let m = 0;
    for (const p of this.sq) if (p && p.type !== 'p' && p.type !== 'k') m += VALUE[p.type];
    return m;
  }

  /**
   * Line pieces of `color` that, along a ray through `through`, hit a piece behind it.
   * Returns [attacker, front, back] triples: used for pins and skewers.
   */
  rayPairs(attackerIdx: number): { front: number; back: number }[] {
    const p = this.sq[attackerIdx];
    if (!p || !['b', 'r', 'q'].includes(p.type)) return [];
    const dirs = p.type === 'b' ? DIAG : p.type === 'r' ? ORTHO : [...DIAG, ...ORTHO];
    const out: { front: number; back: number }[] = [];
    const f0 = attackerIdx % 8;
    const r0 = Math.floor(attackerIdx / 8);
    for (const [df, dr] of dirs) {
      let nf = f0 + df;
      let nr = r0 + dr;
      let front = -1;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const t = nr * 8 + nf;
        if (this.sq[t]) {
          if (front < 0) front = t;
          else {
            out.push({ front, back: t });
            break;
          }
        }
        nf += df;
        nr += dr;
      }
    }
    return out;
  }
}

const KNIGHT = [
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
];
const KING = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const DIAG = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const ORTHO = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function idx(name: string): number {
  const f = name.charCodeAt(0) - 97;
  const r = Number(name[1]);
  return (8 - r) * 8 + f;
}

export function sqName(i: number): string {
  return String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8));
}

export function other(side: Side): Side {
  return side === 'w' ? 'b' : 'w';
}

/** The same position with the other side to move (en passant cleared). Used for "threat" probes. */
export function flipTurn(fen: string): string {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

/** chess.js instance that accepts positions where the side not to move is in check (probes). */
export function looseChess(fen: string): Chess | null {
  const c = new Chess();
  try {
    c.load(fen, { skipValidation: true });
    return c;
  } catch {
    return null;
  }
}

/**
 * Static exchange evaluation: material the side to move in `fen` wins by capturing on
 * `target` (the first capture is made; it can be negative), after which both sides recapture
 * with their least valuable piece and either side may stop when continuing would lose.
 *
 * Runs on the lightweight Board (no chess.js move generation - this is called a lot). Captures
 * that would leave the capturer's own king attacked are skipped, so pins and king safety are
 * respected; x-rays appear naturally because attackers are recomputed after every capture.
 * Returns 0 if there is no legal capture.
 */
export function see(fen: string, target: string): number {
  const board = new Board(fen);
  return seeOn(board, idx(target), board.turn);
}

function seeOn(board: Board, t: number, first: Side): number {
  if (!board.sq[t] || board.sq[t]!.color === first) return 0;
  const gains: number[] = [];
  let side = first;
  for (let depth = 0; depth < 32; depth++) {
    const victim = board.sq[t];
    if (!victim) break;
    // Least valuable attacker whose capture is legal.
    let from = -1;
    for (const a of board.attackers(t, side).sort((x, y) => order(board.sq[x]!.type) - order(board.sq[y]!.type))) {
      if (captureIsLegal(board, a, t, side)) {
        from = a;
        break;
      }
    }
    if (from < 0) break;
    const victimValue = victim.type === 'k' ? 100 : VALUE[victim.type];
    gains[depth] = victimValue - (depth > 0 ? gains[depth - 1] : 0);
    board.sq[t] = board.sq[from];
    board.sq[from] = null;
    side = other(side);
  }
  if (!gains.length) return 0;
  for (let d = gains.length - 1; d > 0; d--) gains[d - 1] = -Math.max(-gains[d - 1], gains[d]);
  return gains[0];
}

/** Kings capture last; otherwise cheapest first. */
function order(t: PieceType): number {
  return t === 'k' ? 1000 : VALUE[t];
}

function captureIsLegal(board: Board, from: number, to: number, side: Side): boolean {
  const moving = board.sq[from];
  const captured = board.sq[to];
  board.sq[to] = moving;
  board.sq[from] = null;
  const king = board.kingSquare(side);
  const ok = king < 0 || board.attackers(king, other(side)).length === 0;
  board.sq[from] = moving;
  board.sq[to] = captured;
  return ok;
}

/**
 * Pieces of `side` that the opponent can win material from right now, i.e. the opponent
 * (assumed to be on move) has a capture with positive static exchange.
 */
export function hangingPieces(fen: string, side: Side, minGain = 1): { square: string; piece: PieceType; gain: number }[] {
  const board = new Board(fen);
  const probeFen = board.turn === side ? flipTurn(fen) : fen;
  const out: { square: string; piece: PieceType; gain: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const p = board.sq[i];
    if (!p || p.color !== side || p.type === 'k') continue;
    if (!board.attackers(i, other(side)).length) continue;
    const gain = see(probeFen, sqName(i));
    if (gain >= minGain) out.push({ square: sqName(i), piece: p.type, gain });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/**
 * Plays a UCI line from `fen` and returns the FEN after every ply (index 0 = `fen` itself).
 * Stops at the first illegal move.
 */
export function playLine(fen: string, uci: string[]): { fens: string[]; sans: string[]; captured: (PieceType | undefined)[] } {
  const chess = new Chess(fen);
  const fens = [fen];
  const sans: string[] = [];
  const captured: (PieceType | undefined)[] = [];
  for (const u of uci) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      fens.push(m.after);
      sans.push(m.san);
      captured.push(m.captured as PieceType | undefined);
    } catch {
      break;
    }
  }
  return { fens, sans, captured };
}

/** Is the pawn on `square` passed (no enemy pawns ahead on its file or adjacent files)? */
export function isPassedPawn(board: Board, square: number): boolean {
  const p = board.sq[square];
  if (!p || p.type !== 'p') return false;
  const f = square % 8;
  const r = Math.floor(square / 8);
  const dir = p.color === 'w' ? -1 : 1;
  for (let rr = r + dir; rr >= 0 && rr < 8; rr += dir) {
    for (let ff = f - 1; ff <= f + 1; ff++) {
      if (ff < 0 || ff > 7) continue;
      const q = board.sq[rr * 8 + ff];
      if (q && q.type === 'p' && q.color !== p.color) return false;
    }
  }
  return true;
}
