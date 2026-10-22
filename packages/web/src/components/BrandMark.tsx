import { APP_NAME } from '../lib/copy';

/*
 * The Control Core (README "Brand", docs/brand/): a dominant centre square, four smaller agent
 * nodes at the corners and straight diagonal connectors. The same geometry as the static SVGs in
 * public/brand, drawn here with `currentColor` (it follows the text color: white on the dark top
 * bar) and the theme's `accent-fill` (the accent blue) for the centre, so no color is
 * hard-coded and both themes work.
 *
 * Two constructions, as in the static files: the master on a 48 grid for 20px and up, and a
 * 16-grid one with integer coordinates for smaller sizes, crisp at 16 and 32 device pixels.
 */

interface Geometry {
  grid: number;
  /** Connector paths, drawn under the squares. */
  lines: string;
  nodes: string;
  stroke: number;
  /** The centre square: [x, y, size]. */
  centre: readonly [number, number, number];
}

const MASTER: Geometry = {
  grid: 48,
  lines: 'M7 7 24 24M41 7 24 24M7 41 24 24M41 41 24 24',
  nodes: 'M3 3h8v8H3zM37 3h8v8h-8zM3 37h8v8H3zM37 37h8v8h-8z',
  stroke: 2.5,
  centre: [16, 16, 16],
};

const SMALL: Geometry = {
  grid: 16,
  lines: 'M2.5 2.5 8 8M13.5 2.5 8 8M2.5 13.5 8 8M13.5 13.5 8 8',
  nodes: 'M1 1h3v3H1zM12 1h3v3h-3zM1 12h3v3H1zM12 12h3v3h-3z',
  stroke: 1,
  centre: [5, 5, 6],
};

/** Below this the 16-grid construction reads better (its connectors stay a whole pixel). */
const SMALL_BELOW = 20;

export function BrandMark({
  size = 28,
  label,
  tone = 'accent',
  className = '',
}: {
  size?: number;
  /** The accessible name when the mark stands alone; without it the mark is decorative. */
  label?: string;
  /** `accent`: an accent-blue centre. `mono`: one color (`currentColor`). */
  tone?: 'accent' | 'mono';
  className?: string;
}) {
  const g = size < SMALL_BELOW ? SMALL : MASTER;
  const [x, y, s] = g.centre;
  const w = g.stroke;
  const named = label !== undefined;
  return (
    <svg
      viewBox={`0 0 ${g.grid} ${g.grid}`}
      width={size}
      height={size}
      {...(named ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
      data-brand-mark=""
      className={`shrink-0 ${className}`}
    >
      <path d={g.lines} fill="none" stroke="currentColor" strokeWidth={w} />
      <path d={g.nodes} fill="currentColor" />
      {tone === 'accent' ? (
        // Framed in the mark's own color, so the centre stays a crisp square on any surface.
        <rect
          x={x + w / 2}
          y={y + w / 2}
          width={s - w}
          height={s - w}
          fill="var(--color-accent-fill)"
          stroke="currentColor"
          strokeWidth={w}
        />
      ) : (
        <rect x={x} y={y} width={s} height={s} fill="currentColor" />
      )}
    </svg>
  );
}

/**
 * The mark with the wordmark: the app name, set uppercase in the semibold system font with open tracking
 * (CSS only, so the text stays "Agent Control Plane" for screen readers and tests). `hideName`
 * keeps the name for screen readers only (the sidebar's icon rail).
 */
export function BrandLogo({
  size = 24,
  hideName = false,
  className = '',
}: {
  size?: number;
  hideName?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span
        className={
          hideName
            ? 'sr-only'
            : 'truncate text-[0.75rem] leading-none font-semibold tracking-[0.1em] whitespace-nowrap uppercase'
        }
      >
        {APP_NAME}
      </span>
    </span>
  );
}
