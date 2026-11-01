import { describe, expect, it } from 'vitest';
import { Board, hangingPieces, isPassedPawn, idx, see } from '../src/core/board';
import { between, lineMaterialSwing, mateInOne, moveFacts } from '../src/core/features';

describe('static exchange evaluation', () => {
  it('wins an undefended piece', () => {
    // White rook takes the undefended knight on d5.
    expect(see('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'd5')).toBe(3);
  });
  it('values the forced first capture (negative when it loses material)', () => {
    // Qxd5 cxd5: queen for a pawn.
    expect(see('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd5')).toBe(-8);
  });
  it('uses the least valuable attacker first and lets the defender stop', () => {
    // Nxd5 cxd5 Rxd5: knight for two pawns = -1.
    expect(see('4k3/8/2p5/3p4/1N6/8/8/3RK3 w - - 0 1', 'd5')).toBe(-1);
    // A lone undefended pawn: +1.
    expect(see('3k4/8/8/3p4/8/8/8/3RK3 w - - 0 1', 'd5')).toBe(1);
  });
  it('respects pins: a pinned defender cannot recapture', () => {
    // Black knight e7 "defends" d5 but is pinned to the king on e8 by the rook on e1.
    expect(see('4k3/4n3/8/3p4/8/8/8/3QR1K1 w - - 0 1', 'd5')).toBe(1);
  });
});

describe('hanging pieces', () => {
  it('finds a piece the opponent can win', () => {
    const h = hangingPieces('4k3/8/8/3n4/8/8/8/3RK3 b - - 0 1', 'b');
    expect(h[0]).toMatchObject({ square: 'd5', piece: 'n', gain: 3 });
  });
  it('ignores defended pieces attacked by bigger pieces', () => {
    expect(hangingPieces('4k3/8/4p3/3n4/8/8/8/3RK3 b - - 0 1', 'b')).toEqual([]);
  });
});

describe('board helpers', () => {
  it('indexes squares in FEN order', () => {
    expect(idx('a8')).toBe(0);
    expect(idx('h1')).toBe(63);
    expect(new Board('8/8/8/8/8/8/8/K6k w - - 0 1').kingSquare('w')).toBe(56);
  });
  it('detects passed pawns', () => {
    const b = new Board('4k3/8/8/3P4/8/8/2p5/4K3 w - - 0 1');
    expect(isPassedPawn(b, idx('d5'))).toBe(true);
    const b2 = new Board('4k3/2p5/8/3P4/8/8/8/4K3 w - - 0 1');
    expect(isPassedPawn(b2, idx('d5'))).toBe(false);
  });
  it('lists squares between two squares on a line', () => {
    expect(between('a1', 'd4')).toEqual(['b2', 'c3']);
    expect(between('a1', 'b3')).toEqual([]);
  });
});

describe('tactical features', () => {
  const types = (fen: string, uci: string) => moveFacts(fen, { from: uci.slice(0, 2), to: uci.slice(2, 4) }).map((f) => f.type);
  it('detects a knight fork of king and rook', () => {
    expect(types('3k3r/8/8/4N3/8/8/8/4K3 w - - 0 1', 'e5f7')).toContain('fork');
    // A quiet developing move is not a fork.
    expect(types('3k3r/8/8/8/8/8/8/4K1N1 w - - 0 1', 'g1f3')).not.toContain('fork');
  });
  it('detects an absolute pin', () => {
    expect(types('4k3/3n4/8/8/8/8/8/4KB2 w - - 0 1', 'f1b5')).toContain('pin');
    expect(types('4k3/8/2n5/8/8/8/8/4K1B1 w - - 0 1', 'g1a7')).not.toContain('pin');
  });
  it('detects a skewer of king and queen', () => {
    expect(types('4q3/8/8/4k3/8/8/8/R5K1 w - - 0 1', 'a1e1')).toContain('skewer');
  });
  it('detects a discovered check', () => {
    expect(types('4k3/8/8/8/8/8/4N3/4RK2 w - - 0 1', 'e2c3')).toContain('discoveredCheck');
  });
  it('detects mate threats and mates', () => {
    expect(mateInOne('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')?.san).toBe('Ra8#');
    expect(types('6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1', 'd1d7')).toContain('mateThreat');
    expect(types('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8')).toContain('checkmate');
  });
  it('flags a newly hanging piece', () => {
    expect(types('4k3/8/8/4p3/8/8/8/2B1K3 w - - 0 1', 'c1f4')).toContain('hanging');
    expect(types('4k3/8/8/4p3/8/8/8/2B1K3 w - - 0 1', 'c1d2')).not.toContain('hanging');
  });
  it('measures material along a line, finishing exchanges', () => {
    // Rxd5 exd5: white wins a knight for a rook.
    expect(lineMaterialSwing('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', ['d1d5', 'e6d5'], 'w', 2)).toBe(-2);
  });
});
