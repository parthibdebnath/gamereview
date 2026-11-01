/**
 * Shared types for the review pipeline:
 *   PGN -> ParsedGame (plies) -> PositionAnalysis[] (engine) -> GameReview (pure core) -> UI
 */

export type Side = 'w' | 'b';

/** An engine score, always from the point of view of the side to move (UCI convention). */
export interface Score {
  /** Centipawns. Absent when the score is a mate score. */
  cp?: number;
  /** Mate in N moves; positive = side to move mates, negative = side to move gets mated. 0 = already mated. */
  mate?: number;
}

export interface PvLine {
  /** 1-based rank of this line (UCI multipv). */
  rank: number;
  score: Score;
  /** Principal variation in UCI notation (e2e4, e7e8q). */
  pv: string[];
  depth: number;
}

export interface PositionAnalysis {
  /** Depth of the deepest completed iteration. */
  depth: number;
  /** Lines sorted best first. Empty for terminal positions. */
  lines: PvLine[];
  /** Set when the position has no legal moves or is a dead draw; no engine call is made then. */
  terminal?: 'checkmate' | 'stalemate' | 'draw';
  nodes?: number;
  timeMs?: number;
}

export interface Ply {
  /** 0-based ply index in the game. */
  index: number;
  /** Full-move number as shown in the move list. */
  moveNumber: number;
  side: Side;
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  fenBefore: string;
  fenAfter: string;
  /** Number of legal moves the mover had. */
  legalMoves: number;
  /** Clock comment ([%clk h:mm:ss]) when present, in seconds. */
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  plies: Ply[];
  /** "1-0" | "0-1" | "1/2-1/2" | "*" */
  result: string;
}

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export const CLASSIFICATIONS: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];
