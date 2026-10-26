/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createCssVariablesTheme } from 'shiki/core';
import { describe, expect, it } from 'vitest';

// Read from disk: Vitest replaces CSS imports with empty modules.
const css = readFileSync(`${import.meta.dirname}/../../../src/components/diff/diff.css`, 'utf8');

/*
 * The diff viewer's colors (diff.css) in both themes: every syntax color is text on every line
 * background (plain, added, removed, and the changed-word tints), and line numbers and +/− signs
 * are text on the line and hunk backgrounds, so each pair needs 4.5:1 (WCAG AA).
 */

function vars(opener: RegExp): Record<string, string> {
  const m = opener.exec(css);
  if (m === null) throw new Error(`block not found: ${String(opener)}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index));
  const out: Record<string, string> = {};
  for (const v of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    if (v[1] !== undefined && v[2] !== undefined) out[v[1]] = v[2].trim();
  }
  return out;
}

const THEMES = {
  light: vars(/^\.acp-diff\s*\{/m),
  dark: vars(/^\.dark \.acp-diff\s*\{/m),
};

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SYNTAX = [
  'shiki-foreground',
  'shiki-token-keyword',
  'shiki-token-string',
  'shiki-token-string-expression',
  'shiki-token-function',
  'shiki-token-constant',
  'shiki-token-comment',
  'shiki-token-parameter',
  'shiki-token-punctuation',
  'shiki-token-link',
  'shiki-token-inserted',
  'shiki-token-deleted',
  'shiki-token-changed',
];
const CODE_BACKGROUNDS = [
  'diff-bg',
  'diff-add-bg',
  'diff-add-word',
  'diff-del-bg',
  'diff-del-word',
];
const GUTTER = ['diff-number', 'diff-add-sign', 'diff-del-sign'];
const GUTTER_BACKGROUNDS = ['diff-bg', 'diff-add-bg', 'diff-del-bg', 'diff-hunk-bg'];

/** `top` (#rrggbb or #rrggbbaa) painted over the opaque `under`, as one #rrggbb. */
function over(top: string, under: string): string {
  if (top.length === 7) return top;
  const a = parseInt(top.slice(7, 9), 16) / 255;
  const mix = (i: number) =>
    Math.round(
      parseInt(top.slice(i, i + 2), 16) * a + parseInt(under.slice(i, i + 2), 16) * (1 - a),
    )
      .toString(16)
      .padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/*
 * What each background sits on as it is painted (DiffFileView): line and hunk backgrounds on the
 * viewer's `--diff-bg`, a changed word's tint on its line's background. GitHub's dark values are
 * translucent, so they are blended down to the color the text is actually read on.
 */
const UNDER: Record<string, string> = {
  'diff-add-bg': 'diff-bg',
  'diff-del-bg': 'diff-bg',
  'diff-hunk-bg': 'diff-bg',
  'diff-add-word': 'diff-add-bg',
  'diff-del-word': 'diff-del-bg',
};

describe.each(Object.entries(THEMES))('diff colors, %s theme', (_name, theme) => {
  const hex = (name: string): string => {
    const v = theme[name];
    if (v === undefined || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) {
      throw new Error(`--${name}: ${String(v)}`);
    }
    const under = UNDER[name];
    if (v.length === 9 && under === undefined) throw new Error(`--${name} must be opaque`);
    return under === undefined ? v : over(v, hex(under));
  };

  it.each(SYNTAX)('%s is readable on every line background', (fg) => {
    for (const bg of CODE_BACKGROUNDS) {
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(GUTTER)('%s is readable in the gutter', (fg) => {
    for (const bg of GUTTER_BACKGROUNDS) {
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('defines every token color Shiki’s CSS-variables theme uses', () => {
    const theme = createCssVariablesTheme({ variablePrefix: '--shiki-' });
    const used = new Set<string>();
    for (const rule of theme.tokenColors ?? []) {
      const m = /var\(--(shiki-[a-z-]+)/.exec(rule.settings.foreground ?? '');
      if (m?.[1] !== undefined) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(SYNTAX, name).toContain(name);
  });
});
