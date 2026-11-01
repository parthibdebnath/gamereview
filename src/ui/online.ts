/**
 * Optional online lookup of a player's recent games (off by default; only runs when the user
 * searches). Both sources are public, CORS-enabled APIs that need no account:
 *  - Lichess:   GET https://lichess.org/api/games/user/{name}  (PGN stream, newest first)
 *  - Chess.com: GET https://api.chess.com/pub/player/{name}/games/archives, then monthly archives
 * Everything is normalised into OnlineGame; the review itself never needs the network.
 */
import { splitPgn } from '../core/pgn';

export type Source = 'lichess' | 'chesscom';

export interface OnlineGame {
  source: Source;
  id: string;
  pgn: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  /** "1-0" | "0-1" | "1/2-1/2" | "*" */
  result: string;
  /** bullet | blitz | rapid | classical | daily | correspondence | ... */
  speed: string;
  /** Milliseconds since epoch (end of game when known). */
  time: number;
  opening?: string;
  url?: string;
}

export interface Page {
  games: OnlineGame[];
  /** Opaque cursor for the next (older) page, if any. */
  next?: string;
}

export class OnlineError extends Error {}

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/;
export function validUsername(name: string): boolean {
  return USERNAME.test(name.trim());
}

function header(pgn: string, key: string): string | undefined {
  return pgn.match(new RegExp(`\\[${key} "([^"]*)"\\]`))?.[1];
}

function num(v: string | undefined): number | undefined {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Lichess-style speed from a TimeControl tag ("300+3", "-" or "1/86400"). */
export function speedOf(tc: string | undefined): string {
  if (!tc || tc === '-') return 'correspondence';
  if (tc.includes('/')) return 'daily';
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return 'unknown';
  const est = Number(m[1]) + 40 * Number(m[2] ?? 0);
  return est < 30 ? 'ultrabullet' : est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical';
}

function utcTime(date?: string, time?: string): number {
  if (!date || !/^\d{4}\.\d{2}\.\d{2}$/.test(date)) return 0;
  const t = time && /^\d{2}:\d{2}:\d{2}$/.test(time) ? time : '00:00:00';
  return Date.parse(`${date.replace(/\./g, '-')}T${t}Z`) || 0;
}

/** Standard chess only; variants and unfinished games can't be reviewed. */
function reviewable(pgn: string): boolean {
  const variant = header(pgn, 'Variant');
  if (variant && !/^standard$/i.test(variant) && !/^from position$/i.test(variant)) return false;
  // Movetext = everything after the tag section (comments may contain "]" too).
  const movetext = pgn.replace(/^(\s*\[[^\n]*\]\s*\n)+/, '');
  return /\d+\.\s*\S/.test(movetext) && header(pgn, 'Result') !== '*';
}

/** Parse a Lichess PGN export (several games). */
export function parseLichessPgn(text: string): OnlineGame[] {
  return splitPgn(text)
    .filter(reviewable)
    .map((pgn) => {
      const site = header(pgn, 'Site') ?? header(pgn, 'GameId') ?? '';
      const id = header(pgn, 'GameId') ?? site.split('/').pop() ?? site;
      return {
        source: 'lichess' as const,
        id,
        pgn,
        white: header(pgn, 'White') ?? '?',
        black: header(pgn, 'Black') ?? '?',
        whiteElo: num(header(pgn, 'WhiteElo')),
        blackElo: num(header(pgn, 'BlackElo')),
        result: header(pgn, 'Result') ?? '*',
        speed: speedOf(header(pgn, 'TimeControl')),
        time: utcTime(header(pgn, 'UTCDate') ?? header(pgn, 'Date'), header(pgn, 'UTCTime')),
        opening: header(pgn, 'Opening'),
        url: site.startsWith('http') ? site : undefined,
      };
    });
}

interface ChessComGame {
  url?: string;
  uuid?: string;
  pgn?: string;
  end_time?: number;
  time_class?: string;
  rules?: string;
  white?: { username?: string; rating?: number; result?: string };
  black?: { username?: string; rating?: number; result?: string };
}

/** Parse one Chess.com monthly archive response. */
export function parseChessComArchive(json: { games?: ChessComGame[] }): OnlineGame[] {
  return (json.games ?? [])
    .filter((g) => (g.rules ?? 'chess') === 'chess' && g.pgn && reviewable(g.pgn))
    .map((g) => {
      const pgn = g.pgn!;
      return {
        source: 'chesscom' as const,
        id: g.uuid ?? g.url ?? String(g.end_time),
        pgn,
        white: g.white?.username ?? header(pgn, 'White') ?? '?',
        black: g.black?.username ?? header(pgn, 'Black') ?? '?',
        whiteElo: g.white?.rating ?? num(header(pgn, 'WhiteElo')),
        blackElo: g.black?.rating ?? num(header(pgn, 'BlackElo')),
        result: header(pgn, 'Result') ?? '*',
        speed: g.time_class ?? speedOf(header(pgn, 'TimeControl')),
        time: (g.end_time ?? 0) * 1000,
        opening: chessComOpening(header(pgn, 'ECOUrl')),
        url: g.url,
      };
    })
    .sort((a, b) => b.time - a.time);
}

/** "…/openings/Sicilian-Defense-Canal-Attack...10.h3-Bh5" -> "Sicilian Defense Canal Attack". */
export function chessComOpening(url: string | undefined): string | undefined {
  const slug = url?.split('/').pop();
  if (!slug) return undefined;
  // Cut at the first move-number marker ("-10.h3", "-2...Nc6").
  const name = slug.replace(/-?\d+\.{1,3}.*$/, '').replace(/\.+$/, '').replace(/-/g, ' ').trim();
  return name || undefined;
}

async function get(url: string, accept: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: accept }, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OnlineError('Couldn’t reach the server. Check your connection, or paste the PGN instead.');
  }
  if (res.status === 404) throw new OnlineError('No player with that name was found.');
  if (res.status === 429) throw new OnlineError('The server is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new OnlineError(`The server answered ${res.status}. Try again later, or paste the PGN instead.`);
  return res;
}

const PAGE = 20;

/** Most recent finished standard games of a Lichess user, newest first. Cursor = "until" ms. */
export async function lichessGames(username: string, cursor?: string, signal?: AbortSignal): Promise<Page> {
  const name = encodeURIComponent(username.trim());
  const params = new URLSearchParams({ max: String(PAGE), moves: 'true', tags: 'true', clocks: 'true', opening: 'true', finished: 'true' });
  if (cursor) params.set('until', cursor);
  let res: Response;
  try {
    res = await get(`https://lichess.org/api/games/user/${name}?${params}`, 'application/x-chess-pgn', signal);
  } catch (e) {
    // Lichess answers 404 both for unknown players and when it refuses a network; tell them apart.
    if (e instanceof OnlineError && /No player/.test(e.message)) {
      const profile = await fetch(`https://lichess.org/api/user/${name}`, { signal }).catch(() => undefined);
      if (profile?.ok) throw new OnlineError('Lichess found the player but didn’t return their games from this network.');
    }
    throw e;
  }
  const text = await res.text();
  const games = parseLichessPgn(text);
  const rawCount = splitPgn(text).length;
  const oldest = games.reduce((m, g) => (g.time && g.time < m ? g.time : m), Number.POSITIVE_INFINITY);
  return { games, next: rawCount >= PAGE && Number.isFinite(oldest) ? String(oldest - 1) : undefined };
}

/** Chess.com: pages of 20, newest first, walking back through monthly archives. Cursor = "month:offset". */
export async function chessComGames(username: string, cursor?: string, signal?: AbortSignal): Promise<Page> {
  const name = encodeURIComponent(username.trim().toLowerCase());
  const res = await get(`https://api.chess.com/pub/player/${name}/games/archives`, 'application/json', signal);
  const archives: string[] = (await res.json())?.archives ?? [];
  if (!archives.length) return { games: [] };
  const [m, o] = (cursor ?? '').split(':');
  let idx = cursor ? Number(m) : archives.length - 1;
  let offset = cursor ? Number(o) || 0 : 0;
  const games: OnlineGame[] = [];
  // Look at most 6 months back per request (months can be empty).
  for (let fetched = 0; idx >= 0 && games.length < PAGE && fetched < 6; fetched++) {
    const month = parseChessComArchive(await (await get(archives[idx], 'application/json', signal)).json());
    const take = month.slice(offset, offset + (PAGE - games.length));
    games.push(...take);
    if (offset + take.length < month.length) {
      offset += take.length;
      return { games, next: `${idx}:${offset}` };
    }
    idx--;
    offset = 0;
  }
  return { games, next: idx >= 0 ? `${idx}:0` : undefined };
}

export function fetchGames(source: Source, username: string, cursor?: string, signal?: AbortSignal): Promise<Page> {
  if (!validUsername(username)) return Promise.reject(new OnlineError('That doesn’t look like a valid username.'));
  return source === 'lichess' ? lichessGames(username, cursor, signal) : chessComGames(username, cursor, signal);
}

/** Outcome for `user` in a game: 'won' | 'lost' | 'drew' | undefined (user not in game). */
export function outcomeFor(g: OnlineGame, user: string): 'won' | 'lost' | 'drew' | undefined {
  const u = user.trim().toLowerCase();
  const side = g.white.toLowerCase() === u ? 'w' : g.black.toLowerCase() === u ? 'b' : undefined;
  if (!side) return undefined;
  if (g.result === '1/2-1/2') return 'drew';
  if (g.result === '1-0') return side === 'w' ? 'won' : 'lost';
  if (g.result === '0-1') return side === 'b' ? 'won' : 'lost';
  return undefined;
}
