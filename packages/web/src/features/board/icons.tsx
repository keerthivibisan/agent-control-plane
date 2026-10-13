import type { TicketType } from '@acp/core';
import type { ComponentType, ReactNode } from 'react';
import type { IconProps } from '../../components/icons';

/** Board icons, in the style of components/icons.tsx (24×24 strokes, decorative). */
function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Sidebar icon: three columns of cards. */
export const BoardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1.5" />
    <rect x="9.5" y="4" width="5" height="10" rx="1.5" />
    <rect x="16" y="4" width="5" height="13" rx="1.5" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M4.2 6.7l2.1 1.2M17.7 16.1l2.1 1.2M4.2 17.3l2.1-1.2M17.7 7.9l2.1-1.2" />
  </Svg>
);

export const MoveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M15 8l4 4-4 4M9 8 5 12l4 4" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);

const FeatureIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.8z" />
  </Svg>
);

const BugIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="13" rx="5" />
    <path d="M12 11v9M7 12H3M21 12h-4M7 17l-3 2M17 17l3 2M9 7l-2-3M15 7l2-3" />
  </Svg>
);

const ChoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6.5a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.5 2.5l5.6-5.6a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.3-.4-.4-2.3z" />
  </Svg>
);

const HarnessIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
);

export const TICKET_TYPE_ICON: Readonly<Record<TicketType, ComponentType<IconProps>>> = {
  feature: FeatureIcon,
  bug: BugIcon,
  chore: ChoreIcon,
  harness: HarnessIcon,
};
