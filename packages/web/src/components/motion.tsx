import { MotionConfig, type Transition, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

/*
 * Motion (DESIGN.md, "Motion"): subtle, 150–200 ms, and off for people who ask for reduced motion.
 * Pages, panels and list items use these presets so every animation in the app feels the same.
 * Tests set `MotionGlobalConfig.skipAnimations = true` (tests/setup.ts), so exits are synchronous.
 */

/** The app root: every `motion.*` element below follows the OS "reduce motion" setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Ease-out with a soft landing (also `--ease-out-soft` in index.css). */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const TRANSITION = {
  /** Menus, popovers, tooltips. */
  fast: { duration: 0.15, ease: EASE_OUT },
  /** Pages, dialogs, panels. */
  base: { duration: 0.2, ease: EASE_OUT },
} satisfies Record<string, Transition>;

/** Opacity only: content that swaps in place. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TRANSITION.fast },
  exit: { opacity: 0, transition: TRANSITION.fast },
};

/** A page or a card arriving: fade with a 4px rise. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: TRANSITION.base },
  exit: { opacity: 0, y: -2, transition: TRANSITION.fast },
};

/** A side panel sliding in from the right edge. */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0, transition: TRANSITION.base },
  exit: { opacity: 0, x: 16, transition: TRANSITION.fast },
};

/** A list whose items arrive one after another (pair with `listItem`). */
export const list: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.025 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 3 },
  visible: { opacity: 1, y: 0, transition: TRANSITION.fast },
  exit: { opacity: 0, transition: TRANSITION.fast },
};

/** Spread on a `motion.*` element: `<motion.div {...enter(fadeUp)}>`. */
export function enter(variants: Variants) {
  return { variants, initial: 'hidden', animate: 'visible', exit: 'exit' } as const;
}
