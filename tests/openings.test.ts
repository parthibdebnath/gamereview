import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { OpeningBook } from '../src/core/openings';

const book = new OpeningBook(JSON.parse(readFileSync('src/data/openings.json', 'utf8')));
const after = (moves: string) => {
  const c = new Chess();
  for (const m of moves.split(' ')) c.move(m);
  return c.fen();
};

describe('opening book', () => {
  it('names well-known openings', () => {
    expect(book.name(after('e4 e5 Nf3 Nc6 Bb5'))?.name).toBe('Ruy Lopez');
    expect(book.name(after('e4 c5'))?.name).toBe('Sicilian Defense');
    expect(book.name(after('d4 d5 c4'))?.eco).toBe('D06');
  });
  it('recognises transpositions (matched by position, not move order)', () => {
    expect(book.has(after('Nf3 d5 d4'))).toBe(true);
    expect(book.has(after('d4 d5 Nf3'))).toBe(true);
  });
  it('treats unnamed intermediate positions as book and odd moves as out of book', () => {
    expect(book.has(after('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6'))).toBe(true);
    expect(book.has(after('e4 e5 Ke2 Ke7 Ke1 Ke8 Qh5'))).toBe(false);
  });
});
