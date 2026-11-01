/** Original line icons (24x24, stroke = currentColor). */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Icon = {
  first: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M17 6l-6 6 6 6M7 6v12" />
    </svg>
  ),
  prev: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  next: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  last: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M7 6l6 6-6 6M17 6v12" />
    </svg>
  ),
  flip: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3" />
    </svg>
  ),
  play: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
    </svg>
  ),
  pause: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M8 5v14M16 5v14" />
    </svg>
  ),
  gear: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
    </svg>
  ),
  plus: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  close: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  upload: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  ),
  link: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  ),
  trash: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
    </svg>
  ),
  back: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  ),
  stop: () => (
    <svg viewBox="0 0 24 24" {...S} aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  ),
};

/** App mark: a disc split like an evaluation bar, with a notch for "looking back". */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M16 2a14 14 0 0 0 0 28z" fill="currentColor" />
      <path d="M21 11l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
