import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { parsePgn } from '../src/core/pgn';
import { OpeningBook } from '../src/core/openings';
import type { ParsedGame, PositionAnalysis, Ply, PvLine, Score } from '../src/core/types';
import type { RatingModel } from '../src/core/rating';

export const book = new OpeningBook(JSON.parse(readFileSync('src/data/openings.json', 'utf8')));
export const ratingModel = JSON.parse(readFileSync('src/data/rating-model.json', 'utf8')) as RatingModel;

export function fixture(name: string): { game: ParsedGame; analyses: PositionAnalysis[] } {
  const game = parsePgn(readFileSync(`tests/fixtures/games/${name}.pgn`, 'utf8'));
  const { analyses } = JSON.parse(readFileSync(`tests/fixtures/analysis/${name}.json`, 'utf8'));
  return { game, analyses };
}

/** A Ply for `san` played from `fen`. */
export function mkPly(fen: string, san: string, index = 20): Ply {
  const c = new Chess(fen);
  const legalMoves = c.moves().length;
  const m = c.move(san);
  return {
    index,
    moveNumber: Number(fen.split(' ')[5]) || 1,
    side: m.color,
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    from: m.from,
    to: m.to,
    piece: m.piece,
    captured: m.captured,
    promotion: m.promotion,
    fenBefore: fen,
    fenAfter: m.after,
    legalMoves,
  };
}

export function line(rank: number, score: Score, pv: string[]): PvLine {
  return { rank, score, pv, depth: 16 };
}

export function analysis(...lines: PvLine[]): PositionAnalysis {
  return { depth: 16, lines };
}
