import { useEffect, useRef, useState } from 'react';
import { gameFromFen, looksLikeFen, parsePgn, splitPgn, PgnError } from '../core/pgn';
import type { ParsedGame } from '../core/types';
import { deleteHistory, listHistory, type HistoryEntry } from '../engine/cache';
import { Icon } from './icons';
import { FindGames } from './FindGames';
import opera from '../../tests/fixtures/games/opera.pgn?raw';
import evergreen from '../../tests/fixtures/games/evergreen.pgn?raw';
import century from '../../tests/fixtures/games/century.pgn?raw';
import immortal from '../../tests/fixtures/games/immortal.pgn?raw';

const SAMPLES = [
  { name: 'Opera Game, 1858', pgn: opera },
  { name: 'Evergreen Game, 1852', pgn: evergreen },
  { name: 'Immortal Game, 1851', pgn: immortal },
  { name: 'Game of the Century, 1956', pgn: century },
];

export function Home({ onGame, onlineImport, onEnableOnline }: { onGame: (g: ParsedGame, source: string) => void; onlineImport: boolean; onEnableOnline: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [choices, setChoices] = useState<{ label: string; pgn: string }[]>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [drag, setDrag] = useState(false);
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listHistory().then(setHistory);
  }, []);

  const submit = (input: string) => {
    setError(undefined);
    setChoices(undefined);
    const t = input.trim();
    if (!t) {
      setError('Paste a PGN or a FEN first.');
      return;
    }
    try {
      if (looksLikeFen(t)) {
        onGame(gameFromFen(t), t);
        return;
      }
      const games = splitPgn(t);
      if (games.length > 1) {
        setChoices(
          games.map((g) => {
            const h = (k: string) => g.match(new RegExp(`\\[${k} "([^"]*)"\\]`))?.[1] ?? '?';
            return { label: `${h('White')} – ${h('Black')} · ${h('Result')} · ${h('Date')}`, pgn: g };
          }),
        );
        return;
      }
      const game = parsePgn(games[0] ?? t);
      if (!game.plies.length) {
        setError('That PGN has no moves.');
        return;
      }
      onGame(game, games[0] ?? t);
    } catch (e) {
      setError(e instanceof PgnError ? `Couldn't read that game: ${e.message}` : `Couldn't read that game. ${(e as Error).message ?? ''}`);
    }
  };

  const readFile = async (f: File) => {
    if (f.size > 5_000_000) {
      setError('That file is too large (over 5 MB).');
      return;
    }
    const t = await f.text();
    setText(t);
    submit(t);
  };

  const importUrl = async () => {
    setError(undefined);
    const lichess = url.match(/lichess\.org\/(?:game\/export\/)?([A-Za-z0-9]{8})/);
    if (/chess\.com/.test(url)) {
      setError('Chess.com doesn’t offer single-game downloads to other sites. Open the game there, choose Share → PGN, copy it and paste it above.');
      return;
    }
    if (!lichess) {
      setError('Paste a Lichess game link, like https://lichess.org/abcdefgh.');
      return;
    }
    setFetching(true);
    try {
      const res = await fetch(`https://lichess.org/game/export/${lichess[1]}?clocks=true&evals=false`, { headers: { Accept: 'application/x-chess-pgn' } });
      if (!res.ok) throw new Error(`Lichess answered ${res.status}`);
      const pgn = await res.text();
      setText(pgn);
      submit(pgn);
    } catch (e) {
      setError(`Couldn't fetch the game (${(e as Error).message}). You can always paste the PGN instead.`);
    } finally {
      setFetching(false);
    }
  };

  return (
    <main
      className={`home${drag ? ' drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) void readFile(f);
      }}
    >
      <div>
        <h1>Review a game</h1>
        <p className="lede">Paste a PGN (or a FEN to explore a position). Everything is analysed on this device with Stockfish — nothing is uploaded.</p>
      </div>
      <label className="sr-only" htmlFor="pgn">
        PGN or FEN
      </label>
      <textarea
        id="pgn"
        className="field"
        placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 ...'}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(text);
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-btns">
        <button className="pill primary" onClick={() => submit(text)}>
          Start review
        </button>
        <button className="pill" onClick={() => fileRef.current?.click()}>
          <Icon.upload /> Open PGN file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pgn,.txt,application/x-chess-pgn,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {choices && (
        <div className="surface card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="section-title">This file has {choices.length} games — pick one</div>
          <div className="history">
            {choices.slice(0, 50).map((c, i) => (
              <button key={i} className="item" onClick={() => submit(c.pgn)}>
                <span className="t" style={{ fontSize: 15 }}>
                  {c.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <FindGames
        enabled={onlineImport}
        onEnable={onEnableOnline}
        onPick={(pgn) => {
          setText(pgn);
          submit(pgn);
        }}
      />
      {onlineImport && (
        <div className="surface card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="label" htmlFor="url">
            Or import one Lichess game by link
          </label>
          <div className="row-btns">
            <input id="url" className="field" style={{ flex: 1, minWidth: 200 }} placeholder="https://lichess.org/abcdefgh" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="pill" onClick={importUrl} disabled={fetching}>
              <Icon.link /> {fetching ? 'Fetching…' : 'Import'}
            </button>
          </div>
        </div>
      )}
      <hr className="dotted" />
      <div className="section-title">Try a classic</div>
      <div className="samples">
        {SAMPLES.map((s) => (
          <button key={s.name} className="pill small" onClick={() => submit(s.pgn)}>
            {s.name}
          </button>
        ))}
      </div>
      {history.length > 0 && (
        <>
          <hr className="dotted" />
          <div className="section-title">
            Recent reviews <small>stored on this device</small>
          </div>
          <div className="history">
            {history.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="item" style={{ flex: 1, minWidth: 0 }} onClick={() => submit(h.pgn)}>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">
                      {h.white} – {h.black}
                    </div>
                    <div className="s">
                      {h.result} · {h.opening ?? h.date}
                    </div>
                  </div>
                  <span className="acc num">
                    {h.accuracy?.w?.toFixed(1) ?? '–'} / {h.accuracy?.b?.toFixed(1) ?? '–'}
                  </span>
                  <span />
                </button>
                <button
                  className="orb sm"
                  aria-label={`Remove ${h.white} – ${h.black} from history`}
                  onClick={async () => {
                    await deleteHistory(h.id);
                    setHistory(await listHistory());
                  }}
                >
                  <Icon.trash />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
