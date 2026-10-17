/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read from disk: Vitest replaces CSS imports (even `?raw`) with empty modules.
const css = readFileSync(`${import.meta.dirname}/../../src/index.css`, 'utf8');

/*
 * WCAG 2.x contrast of the theme's token pairs, read from the CSS itself (src/index.css), so a
 * palette change that breaks a pair fails here. Text pairs need 4.5:1 (AA, normal text); pairs that
 * only draw a line, a dot, a ring or a chart series need 3:1 (AA, non-text). The table with the
 * actual ratios is in DESIGN.md, "Visual system".
 */

type Theme = Record<string, string>;

/** The declarations inside the block that `opener` starts (braces balanced). */
function block(opener: RegExp): string {
  const m = opener.exec(css);
  if (m === null) throw new Error(`block not found: ${String(opener)}`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(start, i - 1);
}

function colors(text: string): Theme {
  const out: Theme = {};
  for (const m of text.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) out[name] = value.trim();
  }
  return out;
}

const LIGHT = colors(block(/@theme\s*\{/));
const DARK = { ...LIGHT, ...colors(block(/\n\.dark\s*\{/)) };

/** A token's hex value, following `var(--color-…)` references (the brand tokens). */
function hex(theme: Theme, name: string): string {
  let value = theme[name];
  for (let hops = 0; value !== undefined && hops < 5; hops += 1) {
    const ref = /^var\(--color-([a-z0-9-]+)\)$/.exec(value);
    if (ref === null) break;
    value = theme[ref[1] ?? ''];
  }
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`--color-${name} is not a 6-digit hex: ${String(value)}`);
  }
  return value;
}

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['canvas', 'panel', 'panel-raised', 'sunken', 'hover', 'sidebar'];

/** [foreground, background, minimum ratio] */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ...SURFACES.flatMap((bg) => [['ink', bg, 4.5] as const, ['dim', bg, 4.5] as const]),
  ['ink', 'accent-soft', 4.5],
  // `accent` is the text-safe accent: links, selected text, the focus ring.
  ...['canvas', 'panel', 'panel-raised', 'sunken', 'sidebar', 'accent-soft'].map(
    (bg) => ['accent', bg, 4.5] as const,
  ),
  ['accent-ink', 'accent', 4.5],
  // Graphite text on signal lime: the primary button, at rest and on hover.
  ['accent-fill-ink', 'accent-fill', 4.5],
  ['accent-fill-ink', 'accent-fill-hover', 4.5],
  // The light theme's tooltip: canvas text on an ink bubble.
  ['canvas', 'ink', 4.5],
  ['success', 'panel', 4.5],
  ['success', 'canvas', 4.5],
  ['warning', 'panel', 4.5],
  ['warning', 'canvas', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'panel', 4.5],
  ['danger', 'canvas', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['observed', 'panel', 4.5],
  ['derived', 'panel', 4.5],
  ['estimated', 'estimated-bg', 4.5],
  ['unavailable', 'panel', 4.5],
  ['unavailable', 'canvas', 4.5],
  // Non-text: the edge that outlines a lime fill or selection on ivory, status dots, chart series.
  ['accent-fill-edge', 'canvas', 3],
  ['accent-fill-edge', 'panel', 3],
  ['status-active', 'panel', 3],
  ['status-idle', 'panel', 3],
  ['status-stale', 'panel', 3],
  ['status-ended', 'panel', 3],
  ['token-input', 'panel', 3],
  ['token-output', 'panel', 3],
  ['token-cache-write', 'panel', 3],
  ['token-cache-read', 'panel', 3],
];

describe('design tokens: contrast (WCAG AA)', () => {
  it('the brand colors are the owner’s', () => {
    expect(hex(LIGHT, 'brand-graphite').toLowerCase()).toBe('#171717');
    expect(hex(LIGHT, 'brand-ivory').toLowerCase()).toBe('#f4f0e8');
    expect(hex(LIGHT, 'brand-lime').toLowerCase()).toBe('#d8ff64');
    // The surfaces are the brand: ivory canvas in the light theme, graphite in the dark.
    expect(hex(LIGHT, 'canvas')).toBe(hex(LIGHT, 'brand-ivory'));
    expect(hex(DARK, 'canvas')).toBe(hex(LIGHT, 'brand-graphite'));
    expect(hex(LIGHT, 'accent-fill')).toBe(hex(LIGHT, 'brand-lime'));
  });

  it('never uses lime as text on ivory', () => {
    expect(hex(LIGHT, 'accent')).not.toBe(hex(LIGHT, 'brand-lime'));
    expect(contrast(hex(LIGHT, 'brand-lime'), hex(LIGHT, 'canvas'))).toBeLessThan(3);
  });

  for (const [name, theme] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    it.each(PAIRS.map(([fg, bg, min]) => ({ fg, bg, min })))(
      `${name}: $fg on $bg is at least $min:1`,
      ({ fg, bg, min }) => {
        expect(contrast(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(min);
      },
    );
  }
});
