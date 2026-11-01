import { useEffect, useRef, useState } from 'react';
import { Tabs } from './parts';
import { fetchGames, outcomeFor, OnlineError, validUsername, type OnlineGame, type Source } from './online';

const KEY = 'hindsight.lastUser.v1';

function remembered(): { source: Source; name: string } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { source: v.source === 'chesscom' ? 'chesscom' : 'lichess', name: typeof v.name === 'string' ? v.name : '' };
  } catch {
    return { source: 'lichess', name: '' };
  }
}

function remember(source: Source, name: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ source, name }));
  } catch {
    /* ignore */
  }
}

const SPEED: Record<string, string> = {
  ultrabullet: 'UltraBullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  daily: 'Daily',
  correspondence: 'Correspondence',
};

function when(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Find your games": recent games of a Lichess or Chess.com player (needs the network). */
export function FindGames({ enabled, onEnable, onPick }: { enabled: boolean; onEnable: () => void; onPick: (pgn: string) => void }) {
  const init = remembered();
  const [source, setSource] = useState<Source>(init.source);
  const [name, setName] = useState(init.name);
  const [games, setGames] = useState<OnlineGame[]>();
  const [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [searched, setSearched] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const search = async (more = false) => {
    const user = name.trim();
    if (!validUsername(user)) {
      setError('Enter a valid username.');
      return;
    }
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setBusy(true);
    setError(undefined);
    if (!more) {
      setGames(undefined);
      setNext(undefined);
    }
    try {
      const page = await fetchGames(source, user, more ? next : undefined, ac.signal);
      remember(source, user);
      setSearched(user);
      setGames((g) => [...(more ? g ?? [] : []), ...page.games]);
      setNext(page.next);
      if (!more && !page.games.length) setError(`No finished standard games found for ${user}.`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const msg = e instanceof OnlineError ? e.message : 'Something went wrong while fetching games.';
      setError(source === 'lichess' && !(e instanceof OnlineError && /No player/.test(msg)) ? `${msg} (Lichess may also block some networks; you can download games at lichess.org/@/${user}/download.)` : msg);
    } finally {
      if (abort.current === ac) setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <div className="surface card findgames">
        <div className="section-title">Find your games</div>
        <p className="note">
          Look up a Lichess or Chess.com player and pick a recent game. This asks lichess.org or chess.com for the game list, so it uses the network; the review
          itself still runs entirely on this device.
        </p>
        <div>
          <button className="pill small" onClick={onEnable}>
            Turn on online lookup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface card findgames">
      <div className="section-title">Find your games</div>
      <Tabs<Source>
        label="Game site"
        items={[
          { id: 'lichess', label: 'Lichess' },
          { id: 'chesscom', label: 'Chess.com' },
        ]}
        value={source}
        onChange={(s) => {
          setSource(s);
          setGames(undefined);
          setError(undefined);
        }}
      />
      <form
        className="row-btns"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="sr-only" htmlFor="username">
          {source === 'lichess' ? 'Lichess' : 'Chess.com'} username
        </label>
        <input
          id="username"
          className="field"
          style={{ flex: 1, minWidth: 180 }}
          placeholder={source === 'lichess' ? 'Lichess username' : 'Chess.com username'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="pill" type="submit" disabled={busy}>
          {busy && !games ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {games && games.length > 0 && (
        <div className="history gamelist" role="list" aria-label={`Recent games of ${searched}`}>
          {games.map((g) => {
            const o = outcomeFor(g, searched);
            return (
              <button key={`${g.source}-${g.id}`} role="listitem" className="item" onClick={() => onPick(g.pgn)}>
                <span className={`outcome ${o ?? ''}`} aria-label={o ? `You ${o}` : g.result}>
                  {o === 'won' ? 'Won' : o === 'lost' ? 'Lost' : o === 'drew' ? 'Draw' : g.result}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="t" style={{ fontSize: 15.5 }}>
                    {g.white}
                    {g.whiteElo ? <span className="elo num"> ({g.whiteElo})</span> : null} – {g.black}
                    {g.blackElo ? <span className="elo num"> ({g.blackElo})</span> : null}
                  </div>
                  <div className="s">
                    {[SPEED[g.speed] ?? g.speed, when(g.time), g.opening].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="acc num">{g.result}</span>
              </button>
            );
          })}
        </div>
      )}
      {games && next && (
        <div>
          <button className="pill small" disabled={busy} onClick={() => void search(true)}>
            {busy ? 'Loading…' : 'Older games'}
          </button>
        </div>
      )}
    </div>
  );
}
