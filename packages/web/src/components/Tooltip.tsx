import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface Position {
  x: number;
  y: number;
  below: boolean;
}

/** Half the tooltip's max width (18rem) plus a margin: keeps it inside the viewport. */
const HALF_WIDTH = 152;

/**
 * Hover and keyboard-focus tooltip state. Hand-built rather than Radix Tooltip on purpose: it opens
 * at once on mouseenter, focus and (InfoTip) tap, and its text exists once, only while open; Radix
 * opens on pointer moves after a delay, never on tap, and renders the text twice. The bubble is portaled to <body> and only exists while
 * open, so it never adds text to its trigger (tests and screen readers read the trigger's own
 * text) and is never clipped by a scrolling table. While open, the trigger is `aria-describedby`
 * the bubble.
 */
export function useTooltip(content: ReactNode) {
  const id = useId();
  const ref = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 72;
    const width = window.innerWidth || 1024;
    const x = Math.min(Math.max(r.left + r.width / 2, HALF_WIDTH), width - HALF_WIDTH);
    setPos({ x, y: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (pos === null) return;
    // A fixed bubble would drift away from its trigger, so scrolling closes it.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [pos, hide]);

  const triggerProps = {
    ref: (el: HTMLElement | null) => {
      ref.current = el;
    },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    },
    'aria-describedby': pos ? id : undefined,
  };

  const bubble =
    pos === null
      ? null
      : createPortal(
          <span
            role="tooltip"
            id={id}
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              transform: pos.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            }}
            className="pointer-events-none z-[60] block w-max max-w-72 animate-fade-in rounded-control bg-tooltip px-2 py-1 text-caption leading-[1.125rem] font-normal tracking-normal text-tooltip-ink normal-case shadow-pop"
          >
            {content}
          </span>,
          document.body,
        );

  return { open: pos !== null, triggerProps, bubble };
}

/**
 * Wraps a value with a tooltip shown on hover and on keyboard focus (Escape closes it). Use for
 * extra precision on something already visible: an exact number or time. `focusable={false}` when
 * the child is itself focusable (a link or button).
 */
export function Tooltip({
  content,
  children,
  focusable = true,
  className = '',
}: {
  content: ReactNode;
  children: ReactNode;
  focusable?: boolean;
  className?: string;
}) {
  const { triggerProps, bubble } = useTooltip(content);
  return (
    <span {...triggerProps} tabIndex={focusable ? 0 : undefined} className={className}>
      {children}
      {bubble}
    </span>
  );
}
