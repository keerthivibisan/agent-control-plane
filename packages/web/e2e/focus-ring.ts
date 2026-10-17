import { expect, type Page } from '@playwright/test';

/*
 * U-V (UI refresh verification): the focused element's outline and its contrast with the surface
 * behind it, for the keyboard passes in pages.spec.ts and shell.spec.ts. WCAG 2.2 asks a focus
 * indicator to be visible; the app's is a 2px accent outline, so it must reach 3:1 against the
 * surface on ivory and on graphite.
 */

interface Ring {
  name: string;
  style: string;
  width: number;
  contrast: number;
  colors: string;
}

async function focusRing(page: Page): Promise<Ring | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return null;
    // Any CSS colour (rgb, oklab, color-mix…) to 0–255 RGBA, through a 1×1 canvas.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (c: string): number[] => {
      if (ctx === null) return [0, 0, 0, 255];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // The surface behind the ring: the element's own when the ring is drawn inside it (an inset
    // ring, as on menu items), else its parent's; translucent layers are blended down to the first
    // opaque one.
    const s = getComputedStyle(el);
    const layers: number[][] = [];
    const names: string[] = [];
    for (
      let n: Element | null = parseFloat(s.outlineOffset) < 0 ? el : el.parentElement;
      n !== null;
      n = n.parentElement
    ) {
      const c = getComputedStyle(n).backgroundColor;
      const v = rgba(c);
      if ((v[3] ?? 0) === 0) continue;
      layers.push(v);
      names.push(c);
      if (v[3] === 255) break;
    }
    let bg = [255, 255, 255];
    for (const [r = 0, g = 0, b = 0, a = 255] of layers.reverse()) {
      const k = a / 255;
      bg = [
        r * k + (bg[0] ?? 0) * (1 - k),
        g * k + (bg[1] ?? 0) * (1 - k),
        b * k + (bg[2] ?? 0) * (1 - k),
      ];
    }
    const [x, y] = [lum(rgba(s.outlineColor)), lum(bg)];
    return {
      name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
      style: s.outlineStyle,
      width: parseFloat(s.outlineWidth),
      contrast: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05),
      colors: `${s.outlineColor} on ${names.join(' over ')}`,
    };
  });
}

/** The focused element is `name` and shows a solid 2px ring at 3:1 or more. */
export async function expectFocusRing(page: Page, name: string | RegExp): Promise<void> {
  // Controls with `transition-colors` fade the outline colour in (150ms): measure once it landed.
  await page.waitForTimeout(250);
  const r = await focusRing(page);
  expect(r?.name ?? '').toMatch(name);
  expect(r?.style, `${String(name)}: outline style`).toBe('solid');
  expect(r?.width ?? 0, `${String(name)}: outline width`).toBeGreaterThanOrEqual(2);
  expect(
    r?.contrast ?? 0,
    `${String(name)}: ring contrast (${r?.colors ?? ''})`,
  ).toBeGreaterThanOrEqual(3);
}
