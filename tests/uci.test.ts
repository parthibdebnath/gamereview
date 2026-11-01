import { describe, expect, it } from 'vitest';
import { SearchCollector, parseInfo } from '../src/engine/uci';

describe('UCI parsing', () => {
  it('parses a multipv info line', () => {
    const i = parseInfo('info depth 16 seldepth 22 multipv 2 score cp -35 nodes 123456 nps 900000 hashfull 10 tbhits 0 time 140 pv e7e5 g1f3 b8c6')!;
    expect(i).toMatchObject({ depth: 16, multipv: 2, score: { cp: -35 }, pv: ['e7e5', 'g1f3', 'b8c6'], nodes: 123456, time: 140, bound: false });
  });
  it('parses mate scores and bounds', () => {
    expect(parseInfo('info depth 9 multipv 1 score mate -3 nodes 10 pv h7h8')!.score).toEqual({ mate: -3 });
    expect(parseInfo('info depth 9 multipv 1 score cp 20 lowerbound nodes 10 pv e2e4')!.bound).toBe(true);
  });
  it('ignores lines without pv', () => {
    expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1')).toBeUndefined();
    expect(parseInfo('info string NNUE evaluation using nn-xyz.nnue')).toBeUndefined();
  });
  it('keeps the latest exact line per rank', () => {
    const c = new SearchCollector();
    c.push(parseInfo('info depth 10 multipv 1 score cp 30 pv e2e4')!);
    c.push(parseInfo('info depth 10 multipv 2 score cp 20 pv d2d4')!);
    c.push(parseInfo('info depth 11 multipv 1 score cp 45 upperbound pv e2e4')!);
    c.push(parseInfo('info depth 11 multipv 1 score cp 35 pv g1f3 e7e5')!);
    const r = c.result(2);
    expect(r.depth).toBe(11);
    expect(r.lines.map((l) => l.pv[0])).toEqual(['g1f3', 'd2d4']);
    expect(c.result(1).lines).toHaveLength(1);
  });
});
