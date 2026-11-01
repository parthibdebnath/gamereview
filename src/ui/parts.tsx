import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { GameReview, MoveReview, PlayerSummary, PositionEval } from '../core/review';
import type { Classification, Score } from '../core/types';
import { formatScore } from '../core/winpct';
import { MARKS, Mark, SUMMARY_ORDER } from './marks';

/* ---------------------------------------------------------------- tabs (pill switcher) */
export function Tabs<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const idx = Math.max(0, items.findIndex((i) => i.id === value));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') onChange(items[(idx + 1) % items.length].id);
    if (e.key === 'ArrowLeft') onChange(items[(idx - 1 + items.length) % items.length].id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      <span className="thumb" style={{ width: `calc((100% - 8px) / ${items.length})`, transform: `translateX(${idx * 100}%)` }} />
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={it.id === value} tabIndex={it.id === value ? 0 : -1} onClick={() => onChange(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- eval bar */
function describeEval(e: PositionEval): string {
  if (!e.score) return 'not analysed yet';
  if (e.terminal === 'checkmate') return e.winWhite === 100 ? 'White has checkmated' : 'Black has checkmated';
  if (e.terminal) return 'draw';
  const s = e.score;
  if (s.mate !== undefined) return `${s.mate > 0 ? 'White' : 'Black'} mates in ${Math.abs(s.mate)}`;
  const cp = (s.cp ?? 0) / 100;
  if (Math.abs(cp) < 0.3) return `about equal (${formatScore(s)})`;
  return `${cp > 0 ? 'White' : 'Black'} is better by ${Math.abs(cp).toFixed(1)} (${formatScore(s)})`;
}

export function EvalBar({ evalv, flipped }: { evalv: PositionEval; flipped: boolean }) {
  const [tip, setTip] = useState(false);
  const w = evalv.winWhite ?? 50;
  // Keep a sliver of each colour visible, like a real bar.
  const h = Math.min(97, Math.max(3, w));
  const label = evalv.score ? formatScore(evalv.score).replace('+', '') : '';
  const whiteAhead = w >= 50;
  // Label sits at the end of the leading side.
  const atBottom = whiteAhead !== flipped;
  return (
    <div
      className={`evalbar${flipped ? ' flip' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
      aria-label={`Evaluation: ${describeEval(evalv)}`}
      tabIndex={0}
      onClick={() => setTip((t) => !t)}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      onKeyDown={(e) => e.key === 'Enter' && setTip((t) => !t)}
    >
      <div className="white" style={{ height: `${h}%` }} />
      <div className="mid" />
      {label && <div className={`val num ${atBottom ? 'bottom' : 'top'} ${whiteAhead ? 'onwhite' : 'onblack'}`}>{label}</div>}
      {tip && evalv.score && (
        <div className="tip num" role="tooltip">
          {formatScore(evalv.score, 2)}
          {evalv.depth ? <span style={{ opacity: 0.6, fontWeight: 500 }}> · d{evalv.depth}</span> : null}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- eval graph */
export function EvalGraph({ review, index, onSelect, mono }: { review: GameReview; index: number; onSelect: (i: number) => void; mono: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const n = review.positions.length - 1;
  const W = Math.max(n, 1);
  const pts = review.positions.map((p, i) => ({ x: i, y: p.winWhite === undefined ? undefined : 100 - p.winWhite }));
  const known = pts.filter((p) => p.y !== undefined) as { x: number; y: number }[];
  const path = known.length ? `M0,100 ${known.map((p) => `L${p.x},${p.y}`).join(' ')} L${known[known.length - 1].x},100 Z` : '';
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.round(((clientX - r.left) / r.width) * W);
    onSelect(Math.max(0, Math.min(n, x)));
  };
  const dots = review.keyMoments.map((ply) => {
    const m = review.moves[ply]!;
    return { x: ply + 1, y: pts[ply + 1].y ?? 50, c: m.verdict.classification };
  });
  return (
    <div
      ref={ref}
      className="graph"
      role="slider"
      aria-label="Evaluation graph; use arrow keys to move through the game"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={index}
      tabIndex={0}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && pick(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSelect(Math.min(n, index + 1));
        if (e.key === 'ArrowLeft') onSelect(Math.max(0, index - 1));
      }}
    >
      <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" aria-hidden>
        <rect className="area-b" x="0" y="0" width={W} height="100" />
        {path && <path className="area-w" d={path} />}
        <line className="midline" x1="0" x2={W} y1="50" y2="50" />
        <line className="cursor" x1={index} x2={index} y1="0" y2="100" />
      </svg>
      <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', inset: 0 }}>
        {dots.map((d) => (
          <ellipse
            key={d.x}
            className="dot"
            cx={d.x}
            cy={Math.min(94, Math.max(6, d.y))}
            rx={W / 110}
            ry="5"
            fill={mono ? 'var(--fg)' : MARKS[d.c].color}
          />
        ))}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- move list */
/** Scroll only the move list (not the page) so the current move stays visible. */
function keepVisible(el: HTMLElement | null) {
  const box = el?.closest('.moves') as HTMLElement | null;
  if (!el || !box) return;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  if (top < box.scrollTop) box.scrollTop = top - 8;
  else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
}

export function MoveList({ review, index, onSelect, mono }: { review: GameReview; index: number; onSelect: (i: number) => void; mono: boolean }) {
  const rows: { no: number; w?: number; b?: number }[] = [];
  review.game.plies.forEach((p, i) => {
    if (p.side === 'w' || !rows.length) rows.push({ no: p.moveNumber });
    const r = rows[rows.length - 1];
    if (p.side === 'w') r.w = i;
    else r.b = i;
  });
  const cell = (ply: number | undefined) => {
    if (ply === undefined) return <span />;
    const p = review.game.plies[ply];
    const m = review.moves[ply];
    const current = index === ply + 1;
    return (
      <button
        className={`mv${m ? '' : ' pending'}`}
        aria-current={current}
        aria-label={`${p.moveNumber}${p.side === 'w' ? '.' : '...'} ${p.san}${m ? `, ${MARKS[m.verdict.classification].label}` : ''}`}
        onClick={() => onSelect(ply + 1)}
        ref={current ? keepVisible : undefined}
      >
        {m && <Mark c={m.verdict.classification} size={15} mono={mono} />}
        <span>{p.san}</span>
      </button>
    );
  };
  return (
    <div className="moves" role="list" aria-label="Moves">
      {rows.map((r) => (
        <div className="row" role="listitem" key={`${r.no}-${r.w ?? 'x'}`}>
          <span className="no num">{r.no}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- summary */
function PlayerCard({ p, complete }: { p: PlayerSummary; complete: boolean }) {
  return (
    <div className="pcard">
      <div className="who">
        <span className={`swatch ${p.side}`} aria-hidden />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
      </div>
      <div className="sub">Accuracy</div>
      <div className="big num" aria-label={`Accuracy ${p.accuracy?.toFixed(1) ?? 'pending'}`}>
        {p.accuracy === null ? '–' : p.accuracy.toFixed(1)}
      </div>
      <div className="sub">Game rating (est.)</div>
      {p.rating ? (
        <>
          <div className="rating num">≈ {p.rating.value}</div>
          <div className="sub num">
            likely {p.rating.low}–{p.rating.high}
            {p.rating.confidence === 'low' ? ' · short game' : ''}
          </div>
        </>
      ) : (
        <div className="sub">{complete ? 'Too few moves to estimate' : 'After analysis'}</div>
      )}
    </div>
  );
}

export function Summary({ review, mono }: { review: GameReview; mono: boolean }) {
  const { white, black } = review;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="players">
        <PlayerCard p={white} complete={review.complete} />
        <PlayerCard p={black} complete={review.complete} />
      </div>
      <table className="counts">
        <caption className="sr-only">Move classifications per player</caption>
        <thead className="sr-only">
          <tr>
            <th>Class</th>
            <th>{white.name}</th>
            <th>{black.name}</th>
          </tr>
        </thead>
        <tbody>
          {SUMMARY_ORDER.map((c: Classification) => (
            <tr key={c}>
              <td className={`n num${white.counts[c] ? '' : ' zero'}`}>{white.counts[c]}</td>
              <td className="lbl">
                <Mark c={c} size={20} mono={mono} />
                {MARKS[c].label}
              </td>
              <td className={`n num${black.counts[c] ? '' : ' zero'}`}>{black.counts[c]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {review.opening && (
        <p className="note">
          Opening: <b>{review.opening.name}</b> ({review.opening.eco})
        </p>
      )}
      <p className="note">
        Game rating is a rough estimate from this one game (accuracy, error rates, length and the opponent's play), calibrated on rated Lichess games — one game
        rarely pins down a rating, so treat it as a ballpark.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- key moments */
export function KeyMoments({ review, index, onSelect, mono }: { review: GameReview; index: number; onSelect: (i: number) => void; mono: boolean }) {
  if (!review.keyMoments.length) return null;
  return (
    <div className="moments" role="list" aria-label="Key moments">
      {review.keyMoments.map((ply) => {
        const m = review.moves[ply]!;
        const p = m.ply;
        return (
          <button key={ply} role="listitem" aria-current={index === ply + 1} onClick={() => onSelect(ply + 1)}>
            <Mark c={m.verdict.classification} size={18} mono={mono} />
            <span className="num">
              {p.moveNumber}
              {p.side === 'w' ? '.' : '…'} {p.san}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- commentary */
export function Commentary(props: {
  review: GameReview;
  index: number;
  mono: boolean;
  evalAfter?: Score;
  onPlayLine: (kind: 'best' | 'reply') => void;
  pending: boolean;
  extra?: ReactNode;
  rewrite?: string;
}) {
  const { review, index, mono } = props;
  const m: MoveReview | undefined = index > 0 ? review.moves[index - 1] : undefined;
  const ply = index > 0 ? review.game.plies[index - 1] : undefined;
  const lineText = useMemo(() => {
    if (!m?.bestLine.length) return '';
    return formatSanLine(m.ply.fenBefore, m.bestLine.slice(0, 8));
  }, [m]);

  if (index === 0) {
    return (
      <div className="surface card comment" aria-live="polite">
        <div className="head">
          <h2>Starting position</h2>
        </div>
        <p>
          {review.game.plies.length
            ? `Step through the game with the arrow keys or the buttons below. ${review.keyMoments.length ? `There ${review.keyMoments.length === 1 ? 'is 1 key moment' : `are ${review.keyMoments.length} key moments`} to look at.` : ''}`
            : 'Make moves on the board to explore this position with the engine.'}
        </p>
        {review.opening && <div className="opening">{review.opening.name}</div>}
        {props.extra}
      </div>
    );
  }
  if (!m || !ply) {
    return (
      <div className="surface card comment" aria-live="polite">
        <div className="head">
          <h2>
            <span className="san">{ply?.san}</span>
          </h2>
        </div>
        <p>{props.pending ? 'Analysing this move…' : 'Not analysed.'}</p>
        {props.extra}
      </div>
    );
  }
  const c = m.verdict.classification;
  const showBest = !['best', 'brilliant', 'great', 'book', 'forced'].includes(c) && m.bestSan;
  return (
    <div className="surface card comment" aria-live="polite">
      <div className="head">
        <Mark c={c} size={28} mono={mono} />
        <h2>
          <span className="san">
            {ply.moveNumber}
            {ply.side === 'w' ? '.' : '…'} {ply.san}
          </span>{' '}
          {MARKS[c].phrase}
        </h2>
        {props.evalAfter && <span className="evalchip num">{formatScore(props.evalAfter)}</span>}
      </div>
      <p>{props.rewrite ?? m.explanation.text}</p>
      {m.opening && c === 'book' && <div className="opening">{m.opening.eco}</div>}
      {showBest && (
        <div className="best">
          <span>
            Best: <b>{m.bestSan}</b>
          </span>
        </div>
      )}
      {lineText && c !== 'book' && c !== 'forced' && <div className="line num">Engine line: {lineText}</div>}
      <div className="btns">
        {m.bestLine.length > 0 && c !== 'forced' && (
          <button className="pill small" onClick={() => props.onPlayLine('best')}>
            Show line
          </button>
        )}
        {m.explanation.threatUci && (
          <button className="pill small" onClick={() => props.onPlayLine('reply')}>
            Show threat
          </button>
        )}
      </div>
      {props.extra}
    </div>
  );
}

export function formatSanLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let no = Number(parts[5]) || 1;
  let white = parts[1] === 'w';
  return sans
    .map((s, i) => {
      const t = white ? `${no}. ${s}` : i === 0 ? `${no}… ${s}` : s;
      if (!white) no++;
      white = !white;
      return t;
    })
    .join(' ');
}
