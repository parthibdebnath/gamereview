/**
 * The review session: runs (or resumes from cache) the engine pass over a game and rebuilds
 * the review as results stream in. Pure logic stays in src/core; this only orchestrates.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedGame, PositionAnalysis } from '../core/types';
import { buildReview, createMemo, type GameReview } from '../core/review';
import { loadOpeningBook, type OpeningBook } from '../core/openings';
import { loadRatingModel, type RatingModel } from '../core/rating';
import { hashKey } from '../core/hash';
import { analyzeGame, type Progress } from '../engine/analyzer';
import type { EngineInfo } from '../engine/types';
import { getEngine, setReviewing } from '../engine/service';
import { loadAnalysis, saveAnalysis, saveHistory } from '../engine/cache';
import { analysisSettings, classifyConfig, type Settings } from './settings';

export type Status = 'idle' | 'loading-engine' | 'analyzing' | 'done' | 'cancelled' | 'error';

export interface Session {
  game?: ParsedGame;
  pgn?: string;
  review?: GameReview;
  analyses: (PositionAnalysis | undefined)[];
  status: Status;
  progress?: Progress;
  error?: string;
  engine?: EngineInfo;
  start: (game: ParsedGame, pgn: string) => void;
  cancel: () => void;
  resume: () => void;
  close: () => void;
}

function cacheKey(game: ParsedGame, s: Settings, engineId: string): string {
  const a = analysisSettings(s);
  return hashKey([game.startFen, game.plies.map((p) => p.uci).join(' '), engineId, a.depth, a.multipv, a.adaptive].join('|'));
}

export function useReview(settings: Settings): Session {
  const [game, setGame] = useState<ParsedGame>();
  const [pgn, setPgn] = useState<string>();
  const [analyses, setAnalyses] = useState<(PositionAnalysis | undefined)[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<string>();
  const [engine, setEngine] = useState<EngineInfo>();
  const [book, setBook] = useState<OpeningBook>();
  const [model, setModel] = useState<RatingModel>();
  const abortRef = useRef<AbortController | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    loadOpeningBook().then(setBook).catch(() => undefined);
    loadRatingModel().then(setModel).catch(() => undefined);
  }, []);

  const run = useCallback(
    async (g: ParsedGame, source: string) => {
      abortRef.current?.abort();
      const id = ++runId.current;
      const abort = new AbortController();
      abortRef.current = abort;
      setError(undefined);
      setStatus('loading-engine');
      try {
        const bk = book ?? (await loadOpeningBook());
        const { engine: e, info } = await getEngine(settings.threads);
        if (id !== runId.current) return;
        setEngine(info);
        const key = cacheKey(g, settings, info.id);
        const known = (await loadAnalysis(key)) ?? [];
        const current: (PositionAnalysis | undefined)[] = Array.from({ length: g.plies.length + 1 }, (_, i) => known[i]);
        setAnalyses([...current]);
        setStatus('analyzing');
        setReviewing(true);
        await e.newGame();
        let lastSave = Date.now();
        let lastPaint = 0;
        await analyzeGame(e, g, {
          settings: analysisSettings(settings),
          known: current,
          isBook: (i) => i > 0 && bk.has(i === 0 ? g.startFen : g.plies[i - 1].fenAfter),
          signal: abort.signal,
          onPosition: (i, a, p) => {
            if (id !== runId.current) return;
            current[i] = a;
            const now = Date.now();
            // Repaint at most ~6x per second; the review rebuild is cheap but not free.
            if (now - lastPaint > 160 || p.done === p.total) {
              lastPaint = now;
              setAnalyses([...current]);
              setProgress(p);
            }
            if (now - lastSave > 3000) {
              lastSave = now;
              void saveAnalysis(key, current);
            }
          },
        });
        if (id !== runId.current) return;
        await saveAnalysis(key, current);
        setAnalyses([...current]);
        setStatus('done');
        const r = buildReview(g, current, { book: bk, config: classifyConfig(settings) });
        void saveHistory({
          id: hashKey(source),
          pgn: source,
          white: r.white.name,
          black: r.black.name,
          result: g.result,
          date: g.headers.Date ?? '',
          opening: r.opening?.name,
          accuracy: { w: r.white.accuracy, b: r.black.accuracy },
          reviewedAt: Date.now(),
        });
      } catch (err) {
        if (id !== runId.current) return;
        if ((err as Error)?.name === 'AbortError') setStatus('cancelled');
        else {
          setStatus('error');
          setError((err as Error)?.message ?? String(err));
        }
      } finally {
        if (id === runId.current) setReviewing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, settings.threads, settings.preset, settings.depth, settings.multipv, settings.adaptive],
  );

  const start = useCallback(
    (g: ParsedGame, source: string) => {
      setGame(g);
      setPgn(source);
      setAnalyses([]);
      setProgress(undefined);
      if (g.plies.length === 0) {
        setStatus('done');
        return;
      }
      void run(g, source);
    },
    [run],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const resume = useCallback(() => {
    if (game && pgn) void run(game, pgn);
  }, [game, pgn, run]);
  const close = useCallback(() => {
    abortRef.current?.abort();
    runId.current++;
    setReviewing(false);
    setGame(undefined);
    setPgn(undefined);
    setAnalyses([]);
    setStatus('idle');
    setProgress(undefined);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const config = useMemo(() => classifyConfig(settings), [settings]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memo = useMemo(() => createMemo(), [game]);
  const review = useMemo(
    () => (game ? buildReview(game, analyses, { book, config, ratingModel: model, memo }) : undefined),
    [game, analyses, book, config, model, memo],
  );

  return { game, pgn, review, analyses, status, progress, error, engine, start, cancel, resume, close };
}
