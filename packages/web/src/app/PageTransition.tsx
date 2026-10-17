import { useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { TRANSITION } from '../components/motion';

/**
 * A subtle fade with a 4px rise each time the page changes (DESIGN.md, "Motion"). It animates the
 * one wrapper in place instead of keying it, so the page is never remounted: state, focus and
 * scroll inside it are kept, and a query change (a filter, a selected item) doesn't animate. Off
 * with reduced motion; instant in tests (`MotionGlobalConfig.skipAnimations`).
 */
export function PageTransition({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotion() === true;

  useEffect(() => {
    if (reduce || scope.current === null) return;
    const controls = animate(scope.current, { opacity: [0, 1], y: [4, 0] }, TRANSITION.base);
    return () => controls.stop();
  }, [pageKey, reduce, animate, scope]);

  return <div ref={scope}>{children}</div>;
}
