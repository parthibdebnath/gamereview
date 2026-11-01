import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { ParsedGame, Ply } from './types';

export const START_FEN = DEFAULT_POSITION;

/** Split a PGN file that may contain several games. */
export function splitPgn(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim();
  if (!normalized) return [];
  // A new game starts at a tag section that follows movetext.
  const games: string[] = [];
  let current: string[] = [];
  let seenMoves = false;
  for (const line of normalized.split('\n')) {
    const isTag = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
    if (isTag && seenMoves) {
      games.push(current.join('\n').trim());
      current = [];
      seenMoves = false;
    }
    if (!isTag && line.trim()) seenMoves = true;
    current.push(line);
  }
  if (current.join('').trim()) games.push(current.join('\n').trim());
  return games;
}

function parseClock(comment: string | undefined): number | undefined {
  const m = comment?.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Strip things chess.js 1.x rejects but real-world PGNs contain. */
function sanitize(pgn: string): string {
  return (
    pgn
      .replace(/\r\n?/g, '\n')
      .replace(/^﻿/, '')
      // Lichess/chess.com sometimes emit "1-0" style result tokens mid-text or "0-0" castling.
      .replace(/\b0-0-0\b/g, 'O-O-O')
      .replace(/\b0-0\b(?!-)/g, 'O-O')
      // Numeric annotation glyphs ($1) and !? marks are irrelevant for the review.
      .replace(/\$\d+/g, '')
  );
}

export class PgnError extends Error {}

/**
 * Parse one game. Throws PgnError with a readable message when the PGN is invalid.
 */
export function parsePgn(text: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(sanitize(text), { strict: false });
  } catch (e) {
    throw new PgnError(cleanError(e));
  }
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const comments = new Map(chess.getComments().map((c) => [c.fen, c.comment]));
  const startFen = history.length ? history[0].before : chess.fen();

  // Recount legal moves by replaying (needed for "Forced").
  const replay = new Chess(startFen);
  const plies: Ply[] = history.map((m, index) => {
    const legalMoves = replay.moves().length;
    replay.move(m.san);
    const side = m.color;
    const fullMove = Number(m.before.split(' ')[5]) || 1;
    return {
      index,
      moveNumber: fullMove,
      side,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: m.before,
      fenAfter: m.after,
      legalMoves,
      clock: parseClock(comments.get(m.after)),
    };
  });

  const result = headers.Result && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(headers.Result) ? headers.Result : inferResult(replay);
  return { headers, startFen, plies, result };
}

function inferResult(chess: Chess): string {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
  if (chess.isDraw() || chess.isStalemate()) return '1/2-1/2';
  return '*';
}

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/Invalid move in PGN: (.*)/i);
  if (m) return `Illegal or unreadable move "${m[1]}".`;
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

/** Build a game from a FEN with no moves (an analysis position). */
export function gameFromFen(fen: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.load(fen.trim());
  } catch (e) {
    throw new PgnError(cleanError(e));
  }
  return { headers: { SetUp: '1', FEN: chess.fen() }, startFen: chess.fen(), plies: [], result: '*' };
}

/** Accept either a FEN or a PGN in one input box. */
export function looksLikeFen(text: string): boolean {
  return /^\s*([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s+[wb]\b/.test(text);
}

/** Convert a UCI line to SAN from a position. Stops at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], max = Infinity): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of uciMoves.slice(0, max)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

export function uciToSan(fen: string, uci: string): string | undefined {
  return uciLineToSan(fen, [uci], 1)[0];
}

/** "1. e4 e5 2. Nf3" style rendering of a SAN line starting at `fen`. */
export function formatLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let moveNo = Number(parts[5]) || 1;
  let white = parts[1] === 'w';
  const out: string[] = [];
  sans.forEach((s, i) => {
    if (white) out.push(`${moveNo}. ${s}`);
    else out.push(i === 0 ? `${moveNo}… ${s}` : s);
    if (!white) moveNo++;
    white = !white;
  });
  return out.join(' ');
}

/** EPD = the first four FEN fields; what openings are matched by. */
export function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
