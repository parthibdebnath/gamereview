import { describe, expect, it } from 'vitest';
import { epd, formatLine, gameFromFen, looksLikeFen, parsePgn, PgnError, splitPgn, uciLineToSan } from '../src/core/pgn';

describe('PGN', () => {
  it('parses moves, FENs, legal move counts and clocks', () => {
    const g = parsePgn('[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 { [%clk 0:05:00] } e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0');
    expect(g.plies).toHaveLength(7);
    expect(g.plies[0]).toMatchObject({ san: 'e4', uci: 'e2e4', side: 'w', moveNumber: 1, legalMoves: 20, clock: 300 });
    expect(g.plies[6].san).toBe('Qxf7#');
    expect(g.result).toBe('1-0');
    expect(g.headers.White).toBe('A');
  });
  it('accepts zero castling and NAGs', () => {
    const g = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 $1 Nf6');
    expect(g.plies[6].san).toBe('O-O');
  });
  it('starts from a FEN tag', () => {
    const g = parsePgn('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7');
    expect(g.startFen).toBe('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    expect(g.plies[1].legalMoves).toBe(5);
  });
  it('reports illegal moves', () => {
    expect(() => parsePgn('1. e4 e5 2. Ke3')).toThrow(PgnError);
  });
  it('splits multi-game files', () => {
    const two = '[Event "a"]\n\n1. e4 e5 1-0\n\n[Event "b"]\n\n1. d4 d5 0-1';
    expect(splitPgn(two)).toHaveLength(2);
    expect(splitPgn('1. e4 e5')).toHaveLength(1);
  });
  it('detects FEN input', () => {
    expect(looksLikeFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(true);
    expect(looksLikeFen('1. e4 e5')).toBe(false);
    expect(gameFromFen('8/8/8/8/8/8/8/K1k5 w - - 0 1').plies).toHaveLength(0);
  });
  it('converts UCI lines to SAN and formats them', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(uciLineToSan(start, ['e2e4', 'e7e5', 'g1f3', 'zzzz'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(formatLine('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', ['Bb5', 'a6', 'Ba4'])).toBe('3. Bb5 a6 4. Ba4');
    expect(formatLine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e5', 'Nf3'])).toBe('1… e5 2. Nf3');
    expect(epd(start)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });
});
