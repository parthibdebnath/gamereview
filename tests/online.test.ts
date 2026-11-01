import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { chessComGames, fetchGames, lichessGames, outcomeFor, parseChessComArchive, parseLichessPgn, speedOf, validUsername } from '../src/ui/online';

const g900 = readFileSync('tests/fixtures/games/lichess-900.pgn', 'utf8');
const g1500 = readFileSync('tests/fixtures/games/lichess-1500.pgn', 'utf8');
const withClocks = `[Event "Rated Blitz game"]
[Site "https://lichess.org/abcdEFGH"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[UTCDate "2026.10.30"]
[UTCTime "12:00:00"]
[WhiteElo "1500"]
[BlackElo "1520"]
[TimeControl "180+2"]

1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:02:58] } 2... Nc6 { [%clk 0:02:59] } 0-1`;
const variant = `[Event "Casual Atomic game"]\n[Site "https://lichess.org/zzzzzzzz"]\n[Variant "Atomic"]\n[White "a"]\n[Black "b"]\n[Result "1-0"]\n\n1. e4 e5 1-0`;

describe('online game lookup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates usernames', () => {
    expect(validUsername('DrNykterstein')).toBe(true);
    expect(validUsername('a_b-c')).toBe(true);
    expect(validUsername('x')).toBe(false);
    expect(validUsername('bad name')).toBe(false);
    expect(validUsername('../etc')).toBe(false);
  });

  it('shortens Chess.com opening names', async () => {
    const { chessComOpening } = await import('../src/ui/online');
    expect(chessComOpening('https://www.chess.com/openings/Sicilian-Defense-Canal-Attack...10.h3-Bh5')).toBe('Sicilian Defense Canal Attack');
    expect(chessComOpening('https://www.chess.com/openings/Italian-Game-2...Nc6-3.Bc4')).toBe('Italian Game');
    expect(chessComOpening(undefined)).toBeUndefined();
  });

  it('maps time controls to speeds', () => {
    expect(speedOf('60+0')).toBe('bullet');
    expect(speedOf('180+2')).toBe('blitz');
    expect(speedOf('600+5')).toBe('rapid');
    expect(speedOf('1/259200')).toBe('daily');
    expect(speedOf('-')).toBe('correspondence');
  });

  it('parses a Lichess PGN stream, skipping variants', () => {
    const games = parseLichessPgn([g900, variant, withClocks].join('\n\n'));
    expect(games).toHaveLength(2);
    const g = games[1];
    expect(g).toMatchObject({ source: 'lichess', id: 'abcdEFGH', white: 'alice', black: 'bob', whiteElo: 1500, result: '0-1', speed: 'blitz' });
    expect(g.time).toBe(Date.parse('2026-10-30T12:00:00Z'));
    expect(outcomeFor(g, 'BOB')).toBe('won');
    expect(outcomeFor(g, 'alice')).toBe('lost');
    expect(outcomeFor(g, 'carol')).toBeUndefined();
  });

  it('parses a Chess.com archive, newest first, standard chess only', () => {
    const games = parseChessComArchive({
      games: [
        { url: 'https://www.chess.com/game/live/1', pgn: g900, end_time: 100, time_class: 'rapid', rules: 'chess', white: { username: 'fathe1', rating: 842 }, black: { username: 'ValentineCC', rating: 876 } },
        { url: 'https://www.chess.com/game/live/2', pgn: g1500, end_time: 200, time_class: 'blitz', rules: 'chess', white: { username: 'psolimyn', rating: 1531 }, black: { username: 'FaresAbuawad', rating: 1454 } },
        { url: 'https://www.chess.com/game/live/3', pgn: g900, end_time: 300, rules: 'chess960' },
      ],
    });
    expect(games.map((g) => g.id)).toEqual(['https://www.chess.com/game/live/2', 'https://www.chess.com/game/live/1']);
    expect(games[0]).toMatchObject({ white: 'psolimyn', whiteElo: 1531, speed: 'blitz', result: '0-1', time: 200000 });
  });

  it('pages Lichess by "until" and Chess.com by archive month', async () => {
    const pgns = Array.from({ length: 20 }, () => withClocks).join('\n\n');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('lichess.org')) return new Response(pgns, { status: 200 });
      if (u.endsWith('/archives')) return new Response(JSON.stringify({ archives: ['https://api.chess.com/m/1', 'https://api.chess.com/m/2'] }));
      return new Response(JSON.stringify({ games: [{ url: u, pgn: g900, end_time: 5, rules: 'chess' }] }));
    });
    const li = await lichessGames('alice');
    expect(li.games).toHaveLength(20);
    expect(li.next).toBe(String(Date.parse('2026-10-30T12:00:00Z') - 1));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/games/user/alice?max=20');
    const cc = await chessComGames('Alice');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/player/alice/games/archives');
    // Fewer than a page per month: walks back through both months, then no more pages.
    expect(cc.games).toHaveLength(2);
    expect(cc.next).toBeUndefined();
  });

  it('splits a busy Chess.com month into pages of 20', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ url: `g${i}`, pgn: g900, end_time: 1000 - i, rules: 'chess' }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).endsWith('/archives') ? new Response(JSON.stringify({ archives: ['https://api.chess.com/m/1'] })) : new Response(JSON.stringify({ games: many })),
    );
    const p1 = await chessComGames('busy');
    expect(p1.games.map((g) => g.id).slice(0, 2)).toEqual(['g0', 'g1']);
    expect(p1.next).toBe('0:20');
    const p2 = await chessComGames('busy', p1.next);
    expect(p2.games[0].id).toBe('g20');
    const p3 = await chessComGames('busy', p2.next);
    expect(p3.games).toHaveLength(5);
    expect(p3.next).toBeUndefined();
  });

  it('turns HTTP errors into readable messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(fetchGames('chesscom', 'nobody123')).rejects.toThrow('No player with that name');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchGames('lichess', 'someone')).rejects.toThrow('Couldn’t reach the server');
    await expect(fetchGames('lichess', 'bad name')).rejects.toThrow('valid username');
  });
});
