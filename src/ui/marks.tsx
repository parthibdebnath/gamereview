/**
 * Classification marks: label, glyph and tint. The glyph shapes are what tells classes apart
 * (colour is a secondary cue; there's a monochrome setting), so every mark is readable without
 * colour vision.
 */
import type { Classification } from '../core/types';

export interface MarkMeta {
  label: string;
  /** Short verb phrase for the commentary header: "Nf3 is best". */
  phrase: string;
  color: string;
  /** SVG content drawn in a 0..20 box, white on the tinted disc. */
  glyph: string;
}

const T = (text: string, size = 11) =>
  `<text x="10" y="10.5" text-anchor="middle" dominant-baseline="central" font-family="Inter Variable, Inter, system-ui, sans-serif" font-weight="800" font-size="${size}" fill="currentColor">${text}</text>`;

export const MARKS: Record<Classification, MarkMeta> = {
  brilliant: { label: 'Brilliant', phrase: 'is brilliant', color: '#8f7bff', glyph: T('!!', 10) },
  great: { label: 'Great', phrase: 'is a great move', color: '#4a9eff', glyph: T('!', 12) },
  best: {
    label: 'Best',
    phrase: 'is best',
    color: '#34c98a',
    glyph: '<path d="M10 3.6l1.9 4 4.3.5-3.2 2.9.9 4.3L10 13.2l-3.9 2.1.9-4.3L3.8 8.1l4.3-.5z" fill="currentColor"/>',
  },
  excellent: {
    label: 'Excellent',
    phrase: 'is excellent',
    color: '#5fb87a',
    glyph: '<path d="M5.2 10.4l3.1 3.1 6.5-6.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  good: {
    label: 'Good',
    phrase: 'is good',
    color: '#8fa597',
    glyph: '<circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  },
  book: {
    label: 'Book',
    phrase: 'is a book move',
    color: '#a39a8c',
    glyph: '<path d="M4 5.5c2-.9 4-.9 6 .4v9c-2-1.2-4-1.2-6-.3zM16 5.5c-2-.9-4-.9-6 .4v9c2-1.2 4-1.2 6-.3z" fill="currentColor"/>',
  },
  forced: {
    label: 'Forced',
    phrase: 'is forced',
    color: '#8c8c93',
    glyph: '<path d="M4.5 10h9M10.5 6.2l3.8 3.8-3.8 3.8" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  inaccuracy: { label: 'Inaccuracy', phrase: 'is an inaccuracy', color: '#e2b736', glyph: T('?!', 9.5) },
  mistake: { label: 'Mistake', phrase: 'is a mistake', color: '#f2873c', glyph: T('?', 12) },
  miss: {
    label: 'Miss',
    phrase: 'is a miss',
    color: '#ef5f9c',
    glyph: '<circle cx="10" cy="10" r="5.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15L15 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  },
  blunder: { label: 'Blunder', phrase: 'is a blunder', color: '#f04848', glyph: T('??', 9.5) },
};

/** Order for summary tables. */
export const SUMMARY_ORDER: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

export function Mark({ c, size = 18, mono = false, title }: { c: Classification; size?: number; mono?: boolean; title?: string }) {
  const m = MARKS[c];
  return (
    <svg
      className={`mark mark-${c}${mono ? ' mono' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={title ?? m.label}
      style={{ ['--mark' as string]: m.color }}
    >
      <title>{title ?? m.label}</title>
      <circle cx="10" cy="10" r="10" className="mark-disc" />
      <g className="mark-glyph" dangerouslySetInnerHTML={{ __html: m.glyph }} />
    </svg>
  );
}

/** SVG string for a mark drawn in the corner of a board square (chessground customSvg, 100x100). */
export function squareMarkSvg(c: Classification, mono: boolean, bg: string, fg: string): string {
  const m = MARKS[c];
  const disc = mono ? fg : m.color;
  const ink = mono ? bg : '#fff';
  return `<g transform="translate(66 4) scale(1.5)" style="color:${ink}"><circle cx="10" cy="10" r="10" fill="${disc}" stroke="rgba(0,0,0,.35)" stroke-width="0.8"/>${m.glyph}</g>`;
}
