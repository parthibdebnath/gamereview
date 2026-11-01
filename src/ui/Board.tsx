import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess, type Square } from 'chess.js';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  shapes: DrawShape[];
  coords: boolean;
  /** Called when the user plays a legal move on the board (UCI). */
  onMove?: (uci: string) => void;
  /** Colour of the last-move highlight (classification tint). */
  lastMoveColor?: string;
}

function dests(fen: string): Map<Key, Key[]> {
  const out = new Map<Key, Key[]>();
  try {
    const c = new Chess(fen);
    for (const m of c.moves({ verbose: true })) {
      const list = out.get(m.from as Key) ?? [];
      list.push(m.to as Key);
      out.set(m.from as Key, list);
    }
  } catch {
    /* invalid position: no moves */
  }
  return out;
}

function config(p: BoardProps): Config {
  const chess = (() => {
    try {
      return new Chess(p.fen);
    } catch {
      return undefined;
    }
  })();
  const turn = p.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  return {
    fen: p.fen,
    orientation: p.orientation,
    turnColor: turn,
    check: chess?.inCheck() ? turn : false,
    lastMove: p.lastMove as Key[] | undefined,
    coordinates: p.coords,
    movable: {
      free: false,
      color: p.onMove ? turn : undefined,
      dests: p.onMove ? dests(p.fen) : new Map(),
      showDests: true,
    },
    premovable: { enabled: false },
    draggable: { enabled: !!p.onMove, showGhost: true },
    highlight: { lastMove: true, check: true },
    animation: { enabled: true, duration: 180 },
    drawable: {
      enabled: true,
      visible: true,
      autoShapes: p.shapes,
      brushes: {
        best: { key: 'best', color: '#2fbf7f', opacity: 0.85, lineWidth: 11 },
        threat: { key: 'threat', color: '#f04848', opacity: 0.8, lineWidth: 10 },
        played: { key: 'played', color: '#8a8a90', opacity: 0.7, lineWidth: 10 },
        live: { key: 'live', color: '#4a9eff', opacity: 0.8, lineWidth: 11 },
        green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
        red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
        blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
        yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
      },
    },
  };
}

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(props.onMove);
  onMoveRef.current = props.onMove;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      ...config(props),
      events: {
        move: (orig, dest) => {
          // Promotion: always to a queen for exploration moves (simple and almost always right).
          const c = new Chess(props.fen);
          const piece = c.get(orig as Square);
          const promo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
          onMoveRef.current?.(orig + dest + promo);
        },
      },
    });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
    // Mount once; updates go through api.set below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set({
      ...config(props),
      events: {
        move: (orig, dest) => {
          const c = new Chess(props.fen);
          const piece = c.get(orig as Square);
          const promo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
          onMoveRef.current?.(orig + dest + promo);
        },
      },
    });
    api.current?.setAutoShapes(props.shapes);
  }, [props.fen, props.orientation, props.lastMove?.[0], props.lastMove?.[1], props.shapes, props.coords, !!props.onMove]);

  return (
    <div
      ref={el}
      className="cg-wrap"
      style={props.lastMoveColor ? ({ ['--lm' as string]: props.lastMoveColor } as React.CSSProperties) : undefined}
      role="img"
      aria-label={`Chess board, ${props.orientation} at the bottom`}
    />
  );
}
