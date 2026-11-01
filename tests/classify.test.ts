import { describe, expect, it } from 'vitest';
import { baseClass, classifyMove } from '../src/core/classify';
import { DEFAULT_CONFIG, withSensitivity } from '../src/core/config';
import { buildReview } from '../src/core/review';
import { analysis, book, fixture, line, mkPly } from './helpers';

const cfg = DEFAULT_CONFIG;

describe('base classes (expected-points thresholds)', () => {
  it('maps losses to classes at the boundaries', () => {
    expect(baseClass(0, true, cfg)).toBe('best');
    expect(baseClass(0.02, false, cfg)).toBe('excellent');
    expect(baseClass(0.0201, false, cfg)).toBe('good');
    expect(baseClass(0.05, false, cfg)).toBe('good');
    expect(baseClass(0.0501, false, cfg)).toBe('inaccuracy');
    expect(baseClass(0.1, false, cfg)).toBe('inaccuracy');
    expect(baseClass(0.1001, false, cfg)).toBe('mistake');
    expect(baseClass(0.2, false, cfg)).toBe('mistake');
    expect(baseClass(0.2001, false, cfg)).toBe('blunder');
  });
});

describe('classifyMove on synthetic analyses', () => {
  // Quiet middlegame-like position: White to move.
  const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8';

  it('marks the top engine move as best and uses the same-search line for others', () => {
    const ply = mkPly(fen, 'a3');
    const before = analysis(line(1, { cp: 30 }, ['f1d3']), line(2, { cp: 20 }, ['a2a3']), line(3, { cp: -60 }, ['h2h4']));
    const after = analysis(line(1, { cp: -10 }, ['d5c4']));
    const v = classifyMove({ ply, before, after, inBook: false, config: cfg });
    expect(v.playedRank).toBe(2);
    expect(v.base).toBe('excellent');
    expect(v.loss).toBeCloseTo(0.0092, 3);
  });

  it('falls back to the next position when the move is not among the lines', () => {
    const ply = mkPly(fen, 'h3');
    const before = analysis(line(1, { cp: 30 }, ['f1d3']), line(2, { cp: 20 }, ['a2a3']));
    const after = analysis(line(1, { cp: 250 }, ['d5c4'])); // Black is now +2.5
    expect(classifyMove({ ply, before, after, inBook: false, config: cfg }).classification).toBe('blunder');
  });

  it('gives Forced for the only legal move and Book for book moves', () => {
    const forcedFen = '7k/8/8/8/8/8/6q1/7K w - - 0 1'; // Kxg2 is the only move
    const ply = mkPly(forcedFen, 'Kxg2');
    const a = analysis(line(1, { cp: 0 }, ['h1g2']));
    expect(classifyMove({ ply, before: a, after: a, inBook: false, config: cfg }).classification).toBe('forced');
    const p2 = mkPly(fen, 'Bd3');
    const b = analysis(line(1, { cp: 30 }, ['f1d3']));
    expect(classifyMove({ ply: p2, before: b, after: b, inBook: true, config: cfg }).classification).toBe('book');
  });

  it('treats walking into mate by the Lichess severity rule', () => {
    const ply = mkPly(fen, 'h3');
    const intoMate = analysis(line(1, { mate: 3 }, ['d8b6']));
    const even = analysis(line(1, { cp: 30 }, ['f1d3']));
    expect(classifyMove({ ply, before: even, after: intoMate, inBook: false, config: cfg }).classification).toBe('blunder');
    const lost = analysis(line(1, { cp: -800 }, ['f1d3']));
    expect(classifyMove({ ply, before: lost, after: intoMate, inBook: false, config: cfg }).classification).toBe('mistake');
    const veryLost = analysis(line(1, { cp: -1500 }, ['f1d3']));
    expect(classifyMove({ ply, before: veryLost, after: intoMate, inBook: false, config: cfg }).classification).toBe('inaccuracy');
  });

  it('gives Great for the only move that holds (big gap to the second line)', () => {
    const ply = mkPly(fen, 'Bd3');
    const before = analysis(line(1, { cp: 20 }, ['f1d3']), line(2, { cp: -250 }, ['a2a3']));
    const after = analysis(line(1, { cp: -20 }, ['d5c4']));
    const v = classifyMove({ ply, before, after, inBook: false, config: cfg });
    expect(v.classification).toBe('great');
    expect(v.reason).toBe('only-move');
    // ...but not when the gap is small.
    const close = analysis(line(1, { cp: 20 }, ['f1d3']), line(2, { cp: 0 }, ['a2a3']));
    expect(classifyMove({ ply, before: close, after, inBook: false, config: cfg }).classification).toBe('best');
    // ...and strict sensitivity needs a bigger gap.
    const strict = withSensitivity(cfg, 'normal', 'strict');
    const mid = analysis(line(1, { cp: 20 }, ['f1d3']), line(2, { cp: -150 }, ['a2a3']));
    expect(classifyMove({ ply, before: mid, after, inBook: false, config: cfg }).classification).toBe('great');
    expect(classifyMove({ ply, before: mid, after, inBook: false, config: strict }).classification).toBe('best');
  });

  it('gives Miss when the opponent just erred and the chance is let slip', () => {
    const ply = mkPly(fen, 'a3');
    // Best keeps +3 (0.75); the played move only +1.2 (0.61): a 0.14 loss = mistake.
    const before = analysis(line(1, { cp: 300 }, ['f1d3']), line(2, { cp: 120 }, ['a2a3']));
    const after = analysis(line(1, { cp: -120 }, ['d5c4']));
    const prev = { classification: 'blunder' as const, base: 'blunder' as const, winBefore: 0.5, winAfter: 0.1, loss: 0.4, playedRank: 0 };
    const v = classifyMove({ ply, before, after, prev, winBeforeOpponentMove: 0.5, inBook: false, config: cfg });
    expect(v.classification).toBe('miss');
    // Without the opponent's error it is a plain mistake.
    expect(classifyMove({ ply, before, after, inBook: false, config: cfg }).classification).toBe('mistake');
  });
});

describe('special classes on famous games (recorded Stockfish analysis)', () => {
  const review = (name: string) => {
    const { game, analyses } = fixture(name);
    return buildReview(game, analyses, { book });
  };
  const cls = (r: ReturnType<typeof review>, ply: number) => r.moves[ply]!.verdict.classification;

  it('Opera Game: 10.Nxb5 and 16.Qb8+ are brilliant, 17.Rd8# is just best', () => {
    const r = review('opera');
    expect(r.game.plies[18].san).toBe('Nxb5');
    expect(cls(r, 18)).toBe('brilliant');
    expect(r.game.plies[30].san).toBe('Qb8+');
    expect(cls(r, 30)).toBe('brilliant');
    expect(cls(r, 32)).toBe('best');
    expect(cls(r, 31)).toBe('forced');
    expect(cls(r, 0)).toBe('book');
  });
  it("Game of the Century: Fischer's 17...Be6 is brilliant", () => {
    const r = review('century');
    expect(r.game.plies[33].san).toBe('Be6');
    expect(cls(r, 33)).toBe('brilliant');
  });
  it("Legal's mate: 5.Nxe5 is brilliant, 5...Bxd1 is a blunder", () => {
    const r = review('legal');
    expect(cls(r, 8)).toBe('brilliant');
    expect(cls(r, 9)).toBe('blunder');
  });
  it('Evergreen: 21.Qxd7+ is brilliant', () => {
    const r = review('evergreen');
    expect(r.game.plies[40].san).toBe('Qxd7+');
    expect(cls(r, 40)).toBe('brilliant');
  });
  it('no brilliant moves in ordinary club games (false positives are worse than misses)', () => {
    for (const name of ['lichess-900', 'lichess-1500', 'lichess-2100']) {
      const r = review(name);
      expect(r.white.counts.brilliant + r.black.counts.brilliant).toBe(0);
    }
  });
  it('flags a missed forced mate as Miss', () => {
    const r = review('lichess-900');
    const miss = r.moves.filter((m) => m?.verdict.classification === 'miss');
    expect(miss.length).toBeGreaterThan(0);
    expect(miss[0]!.explanation.text).toMatch(/^You missed f8=Q/);
  });
});
