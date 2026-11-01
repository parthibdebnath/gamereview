import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { PositionAnalysis, Score } from '../core/types';
import { positionEval, type PositionEval } from '../core/review';
import { uciLineToSan } from '../core/pgn';
import { analyzeLive, stopLive } from '../engine/service';
import { Board } from './Board';
import { Home } from './Home';
import { Icon, Logo } from './icons';
import { MARKS, squareMarkSvg } from './marks';
import { Commentary, EvalBar, EvalGraph, KeyMoments, MoveList, Summary, Tabs, formatSanLine } from './parts';
import { SettingsSheet } from './SettingsSheet';
import { applyTheme, contentFor, loadSettings, normalizeHex, saveSettings, type Settings } from './settings';
import { useReview } from './useReview';
import { polish } from './llm';

/** A temporary line on the board: an engine line being played, or the user's own moves. */
interface Line {
  kind: 'best' | 'reply' | 'explore';
  /** Game position index the line starts from. */
  base: number;
  fens: string[];
  ucis: string[];
  sans: string[];
  cursor: number;
  auto: boolean;
}

function lineFrom(fen: string, ucis: string[]): Pick<Line, 'fens' | 'ucis' | 'sans'> {
  const c = new Chess(fen);
  const fens = [fen];
  const sans: string[] = [];
  const ok: string[] = [];
  for (const u of ucis) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      fens.push(m.after);
      sans.push(m.san);
      ok.push(u);
    } catch {
      break;
    }
  }
  return { fens, ucis: ok, sans };
}

export function App() {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);
  useEffect(() => applyTheme(settings), [settings]);

  const session = useReview(settings);
  const { review, game, status, progress } = session;
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [line, setLine] = useState<Line>();
  const [live, setLive] = useState<{ fen: string; a: PositionAnalysis }>();
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<'summary' | 'moves'>('summary');
  const [rewrites, setRewrites] = useState<Record<number, string>>({});
  const [polishing, setPolishing] = useState<string>();

  const n = game?.plies.length ?? 0;
  const fens = useMemo(() => (game ? [game.startFen, ...game.plies.map((p) => p.fenAfter)] : []), [game]);
  const mono = settings.monoMarks;
  const bg = normalizeHex(settings.background);
  const fg = contentFor(bg);

  // New game: reset view.
  useEffect(() => {
    setIndex(0);
    setLine(undefined);
    setLive(undefined);
    setRewrites({});
    if (game) setFlipped(false);
  }, [game]);

  const go = useCallback(
    (i: number) => {
      setLine(undefined);
      setIndex(Math.max(0, Math.min(n, i)));
    },
    [n],
  );

  const displayFen = line ? line.fens[line.cursor] : fens[index];

  // Live engine for lines/exploration and FEN-only positions (the review covers the game itself).
  const needLive = !!game && (!!line || n === 0) && status !== 'analyzing' && status !== 'loading-engine';
  useEffect(() => {
    if (!needLive || !displayFen) return;
    let cancelled = false;
    const depth = settings.preset === 'fast' ? 14 : settings.preset === 'deep' ? 22 : 18;
    analyzeLive(displayFen, [], (a) => !cancelled && setLive({ fen: displayFen, a }), { threads: settings.threads, mode: settings.engineMode, depth, multipv: 1 })
      .then((a) => !cancelled && a && setLive({ fen: displayFen, a }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopLive();
    };
  }, [needLive, displayFen, settings.preset, settings.threads, settings.engineMode]);

  // Auto-play of engine lines.
  useEffect(() => {
    if (!line?.auto) return;
    if (line.cursor >= line.fens.length - 1) {
      setLine({ ...line, auto: false });
      return;
    }
    const t = setTimeout(() => setLine((l) => (l ? { ...l, cursor: l.cursor + 1 } : l)), 850);
    return () => clearTimeout(t);
  }, [line]);

  const step = useCallback(
    (d: number) => {
      if (line) {
        const c = line.cursor + d;
        if (c < 0 || (d < 0 && c === 0 && line.kind === 'explore' && false)) return;
        if (c > line.fens.length - 1) return;
        setLine({ ...line, cursor: Math.max(0, c), auto: false });
        return;
      }
      go(index + d);
    },
    [line, index, go],
  );

  const jumpMoment = useCallback(
    (d: number) => {
      if (!review) return;
      const targets = review.keyMoments.map((p) => p + 1);
      const t = d > 0 ? targets.find((x) => x > index) : [...targets].reverse().find((x) => x < index);
      if (t !== undefined) go(t);
    },
    [review, index, go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (showSettings || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName) || !game) return;
      if (tgt.getAttribute('role') === 'slider' || tgt.getAttribute('role') === 'tab') return;
      if (e.key === 'ArrowRight') e.shiftKey ? jumpMoment(1) : step(1);
      else if (e.key === 'ArrowLeft') e.shiftKey ? jumpMoment(-1) : step(-1);
      else if (e.key === 'ArrowUp' || e.key === 'Home') line ? setLine({ ...line, cursor: 0, auto: false }) : go(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') line ? setLine({ ...line, cursor: line.fens.length - 1, auto: false }) : go(n);
      else if (e.key === 'f') setFlipped((f) => !f);
      else if (e.key === 'Escape' && line) setLine(undefined);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, jumpMoment, go, n, line, game, showSettings]);

  const move = index > 0 ? review?.moves[index - 1] : undefined;

  const playLine = (kind: 'best' | 'reply') => {
    if (!move) return;
    if (kind === 'best') {
      const pv = session.analyses[index - 1]?.lines[0]?.pv ?? [];
      setLine({ kind, base: index - 1, ...lineFrom(move.ply.fenBefore, pv.slice(0, 10)), cursor: 0, auto: true });
    } else {
      const pv = session.analyses[index]?.lines[0]?.pv ?? [];
      setLine({ kind, base: index, ...lineFrom(move.ply.fenAfter, pv.slice(0, 10)), cursor: 0, auto: true });
    }
  };

  const onBoardMove = (uci: string) => {
    if (!game) return;
    // Playing the actual next game move just advances.
    if (!line && index < n && game.plies[index].uci === uci) {
      go(index + 1);
      return;
    }
    const base = line ? line : { kind: 'explore' as const, base: index, ...lineFrom(fens[index], []), cursor: 0, auto: false };
    const ucis = [...base.ucis.slice(0, base.cursor), uci];
    const startFen = base.fens[0];
    const next = lineFrom(startFen, ucis);
    setLine({ kind: 'explore', base: base.base, ...next, cursor: next.fens.length - 1, auto: false });
  };

  // ----- board decorations
  const shapes = useMemo<DrawShape[]>(() => {
    const out: DrawShape[] = [];
    if (line) {
      const a = live && live.fen === displayFen ? live.a : undefined;
      const best = a?.lines[0]?.pv[0];
      if (best && settings.arrows) out.push({ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'live' });
      return out;
    }
    if (n === 0) {
      const a = live && live.fen === displayFen ? live.a : undefined;
      const best = a?.lines[0]?.pv[0];
      if (best && settings.arrows) out.push({ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'live' });
      return out;
    }
    if (!move) return out;
    const c = move.verdict.classification;
    out.push({ orig: move.ply.to as Key, customSvg: { html: squareMarkSvg(c, mono, bg, fg) } });
    const showBest = !['best', 'brilliant', 'great', 'book', 'forced'].includes(c);
    if (showBest && settings.arrows && move.verdict.bestUci) {
      const u = move.verdict.bestUci;
      out.push({ orig: u.slice(0, 2) as Key, dest: u.slice(2, 4) as Key, brush: 'best' });
    }
    if (settings.threats && move.explanation.threatUci && ['mistake', 'blunder', 'inaccuracy', 'miss'].includes(c)) {
      const u = move.explanation.threatUci;
      out.push({ orig: u.slice(0, 2) as Key, dest: u.slice(2, 4) as Key, brush: 'threat' });
    }
    return out;
  }, [line, live, displayFen, move, settings.arrows, settings.threats, mono, bg, fg, n]);

  const lastMove: [string, string] | undefined = line
    ? line.cursor > 0
      ? [line.ucis[line.cursor - 1].slice(0, 2), line.ucis[line.cursor - 1].slice(2, 4)]
      : undefined
    : move
      ? [move.ply.from, move.ply.to]
      : index > 0 && game
        ? [game.plies[index - 1].from, game.plies[index - 1].to]
        : undefined;
  const lmColor = !line && move && !mono ? `color-mix(in srgb, ${MARKS[move.verdict.classification].color} 45%, transparent)` : undefined;

  // ----- eval for the bar
  const barEval: PositionEval = useMemo(() => {
    if ((line || n === 0) && live && live.fen === displayFen) return positionEval(displayFen, live.a);
    if (line) return {};
    return review?.positions[index] ?? {};
  }, [line, live, displayFen, review, index, n]);
  const evalAfter: Score | undefined = review?.positions[index]?.score;

  if (!game || !review) {
    return (
      <div className="app">
        <TopBar onSettings={() => setShowSettings(true)} />
        <Home onGame={session.start} onlineImport={settings.onlineImport} />
        {showSettings && <SettingsSheet settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} engine={session.engine} />}
      </div>
    );
  }

  const top = flipped ? review.white : review.black;
  const bottom = flipped ? review.black : review.white;
  const analyzing = status === 'analyzing' || status === 'loading-engine';
  const pct = progress ? (100 * progress.done) / progress.total : 0;

  const polishButton =
    settings.llm.enabled && settings.llm.endpoint && move && !line ? (
      <div className="btns">
        <button
          className="pill small"
          disabled={polishing === 'busy'}
          onClick={async () => {
            setPolishing('busy');
            try {
              const t = await polish(move, settings.llm);
              setRewrites((r) => ({ ...r, [index]: t }));
              setPolishing(undefined);
            } catch (e) {
              setPolishing(`Couldn't reach the LLM (${(e as Error).message}); keeping the built-in text.`);
            }
          }}
        >
          {polishing === 'busy' ? 'Polishing…' : 'Polish wording (LLM)'}
        </button>
        {polishing && polishing !== 'busy' && <span className="note">{polishing}</span>}
      </div>
    ) : null;

  return (
    <div className="app">
      <TopBar
        title={n ? `${review.white.name} – ${review.black.name}` : 'Position'}
        onSettings={() => setShowSettings(true)}
        onNew={() => {
          stopLive();
          session.close();
        }}
      />
      {(analyzing || status === 'cancelled' || status === 'error') && (
        <div className="progress" aria-live="polite">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Analysis progress">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="row">
            <span className="grow num">
              {status === 'loading-engine' && 'Starting engine…'}
              {status === 'analyzing' && progress && `Analysing · ${progress.done}/${progress.total} positions${progress.etaMs > 1500 ? ` · about ${fmtTime(progress.etaMs)} left` : ''}`}
              {status === 'analyzing' && !progress && 'Analysing…'}
              {status === 'cancelled' && 'Analysis stopped. Results so far are kept.'}
              {status === 'error' && `Engine error: ${session.error}`}
            </span>
            {analyzing ? (
              <button className="pill small" onClick={session.cancel}>
                Cancel
              </button>
            ) : (
              <button className="pill small" onClick={session.resume}>
                {status === 'error' ? 'Retry' : 'Resume'}
              </button>
            )}
          </div>
        </div>
      )}
      <main className="review">
        <div className="left">
          <PlayerLine p={top} />
          <div className="boardrow">
            <EvalBar evalv={barEval} flipped={flipped} />
            <div className="boardwrap">
              <Board
                fen={displayFen}
                orientation={flipped ? 'black' : 'white'}
                lastMove={lastMove}
                shapes={shapes}
                coords={settings.coords}
                onMove={onBoardMove}
                lastMoveColor={lmColor}
              />
            </div>
          </div>
          <PlayerLine p={bottom} />
          {line && (
            <div className="variation" role="status">
              <span className="txt num">
                <b>{line.kind === 'explore' ? 'Exploring' : line.kind === 'best' ? 'Engine line' : 'Threat'}:</b> {formatSanLine(line.fens[0], line.sans.slice(0, Math.max(line.cursor, 1)))}
              </span>
              <button className="orb sm" aria-label={line.auto ? 'Pause' : 'Play line'} onClick={() => setLine({ ...line, auto: !line.auto, cursor: line.cursor >= line.fens.length - 1 ? 0 : line.cursor })}>
                {line.auto ? <Icon.pause /> : <Icon.play />}
              </button>
              <button className="pill small" onClick={() => setLine(undefined)}>
                Back to game
              </button>
            </div>
          )}
          <div className="controls">
            <button className="orb" aria-label="First position" onClick={() => (line ? setLine({ ...line, cursor: 0, auto: false }) : go(0))}>
              <Icon.first />
            </button>
            <button className="orb" aria-label="Previous move" onClick={() => step(-1)}>
              <Icon.prev />
            </button>
            <button className="orb lg" aria-label="Next move" onClick={() => step(1)}>
              <Icon.next />
            </button>
            <button className="orb" aria-label="Last position" onClick={() => (line ? setLine({ ...line, cursor: line.fens.length - 1, auto: false }) : go(n))}>
              <Icon.last />
            </button>
            <button className="orb" aria-label="Flip board" onClick={() => setFlipped((f) => !f)}>
              <Icon.flip />
            </button>
          </div>
        </div>

        <div className="right">
          {n === 0 ? (
            <LivePanel live={live?.fen === displayFen ? live.a : undefined} fen={displayFen} />
          ) : (
            <>
              <Commentary
                review={review}
                index={index}
                mono={mono}
                evalAfter={evalAfter}
                pending={analyzing}
                onPlayLine={playLine}
                rewrite={rewrites[index]}
                extra={polishButton}
              />
              <EvalGraph review={review} index={index} onSelect={go} mono={mono} />
              {review.keyMoments.length > 0 && (
                <>
                  <div className="section-title">
                    Key moments <small>Shift + ←/→</small>
                  </div>
                  <KeyMoments review={review} index={index} onSelect={go} mono={mono} />
                </>
              )}
              <Tabs
                label="Panel"
                items={[
                  { id: 'summary', label: 'Summary' },
                  { id: 'moves', label: 'Moves' },
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === 'summary' ? <Summary review={review} mono={mono} /> : <MoveList review={review} index={index} onSelect={go} mono={mono} />}
            </>
          )}
        </div>
      </main>
      {showSettings && <SettingsSheet settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} engine={session.engine} />}
    </div>
  );
}

function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function TopBar({ title, onSettings, onNew }: { title?: string; onSettings: () => void; onNew?: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span>Hindsight</span>
      </div>
      <div className="title">{title}</div>
      <div className="actions">
        {onNew && (
          <button className="orb sm" aria-label="Review another game" title="Review another game" onClick={onNew}>
            <Icon.plus />
          </button>
        )}
        <button className="orb sm" aria-label="Settings" title="Settings" onClick={onSettings}>
          <Icon.gear />
        </button>
      </div>
    </header>
  );
}

function PlayerLine({ p }: { p: { side: 'w' | 'b'; name: string; elo?: number; accuracy: number | null } }) {
  return (
    <div className="player">
      <span className={`swatch ${p.side}`} aria-hidden />
      <span className="name">{p.name}</span>
      {p.elo && <span className="elo num">({p.elo})</span>}
      <span className="grow" />
      {p.accuracy !== null && (
        <span className="acc num" aria-label={`Accuracy ${p.accuracy.toFixed(1)}`}>
          {p.accuracy.toFixed(1)}
        </span>
      )}
    </div>
  );
}

function LivePanel({ live, fen }: { live?: PositionAnalysis; fen: string }) {
  const top = live?.lines[0];
  const ev = live ? positionEval(fen, live) : undefined;
  return (
    <div className="surface card comment" aria-live="polite">
      <div className="head">
        <h2>Position analysis</h2>
        {ev?.score && <span className="evalchip num">{formatEval(ev.score)}</span>}
      </div>
      <p>{top ? `Best line (depth ${live!.depth}): ${formatSanLine(fen, uciLineToSan(fen, top.pv, 10))}` : live?.terminal ? `The game is over (${live.terminal}).` : 'Thinking…'}</p>
      <p className="note">Drag pieces to explore; the engine follows along.</p>
    </div>
  );
}

function formatEval(s: Score): string {
  if (s.mate !== undefined) return s.mate === 0 ? '#' : `${s.mate > 0 ? '' : '-'}M${Math.abs(s.mate)}`;
  const v = (s.cp ?? 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
