import type { TicketPriority, TicketStage, TicketType } from '@acp/core';
import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleEllipsis,
  CirclePlay,
  CircleX,
  Equal,
  Gauge,
  Play,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  AlertIcon,
  BoardNavIcon,
  BugIcon,
  ChoreIcon,
  FeatureIcon,
  HarnessIcon,
  MoveIcon,
  PlusSmallIcon,
  type IconProps,
} from '../../components/icons';

/*
 * The board's icons: lucide, like components/icons.tsx (24×24 strokes at 1.75px, decorative,
 * `aria-hidden`). Each one sits next to a word or an accessible name, so icons never add text.
 */

function icon(Lucide: LucideIcon, name: string): ComponentType<IconProps> {
  function BoardIcon({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
    return (
      <Lucide
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        focusable="false"
        {...rest}
      />
    );
  }
  BoardIcon.displayName = name;
  return BoardIcon;
}

export { AlertIcon, MoveIcon };
export const BoardIcon = BoardNavIcon;
export const PlusIcon = PlusSmallIcon;
export const HelpersIcon = icon(Users, 'HelpersIcon');
export const BudgetIcon = icon(Gauge, 'BudgetIcon');
export const StartIcon = icon(Play, 'StartIcon');
export const CheckCircleIcon = icon(CircleCheck, 'CheckCircleIcon');

export const TICKET_TYPE_ICON: Readonly<Record<TicketType, ComponentType<IconProps>>> = {
  feature: FeatureIcon,
  bug: BugIcon,
  chore: ChoreIcon,
  harness: HarnessIcon,
};

/**
 * One glyph per stage, in the familiar circle language (dashed = not started, play = agents at work,
 * check = done), with a status color. The column title always says the stage in words.
 */
export const STAGE_ICON: Readonly<
  Record<TicketStage, { Icon: ComponentType<IconProps>; tone: string }>
> = {
  BACKLOG: { Icon: icon(CircleDashed, 'BacklogIcon'), tone: 'text-dim' },
  READY: { Icon: icon(Circle, 'ReadyIcon'), tone: 'text-ink' },
  PLANNING: { Icon: icon(CircleDotDashed, 'PlanningIcon'), tone: 'text-accent' },
  PLAN_REVIEW: { Icon: icon(CircleEllipsis, 'PlanReviewIcon'), tone: 'text-warning' },
  WORKING: { Icon: icon(CirclePlay, 'WorkingIcon'), tone: 'text-status-active' },
  NEEDS_YOU: { Icon: AlertIcon, tone: 'text-warning' },
  IN_REVIEW: { Icon: icon(CircleDot, 'InReviewIcon'), tone: 'text-accent' },
  DONE: { Icon: CheckCircleIcon, tone: 'text-success' },
  CANCELLED: { Icon: icon(CircleX, 'CancelledIcon'), tone: 'text-dim' },
};

/** Chevrons per priority (down, level, up, double up); the word is always shown beside it. */
export const PRIORITY_ICON: Readonly<Record<TicketPriority, ComponentType<IconProps>>> = {
  low: icon(ChevronDown, 'LowPriorityIcon'),
  medium: icon(Equal, 'MediumPriorityIcon'),
  high: icon(ChevronUp, 'HighPriorityIcon'),
  urgent: icon(ChevronsUp, 'UrgentPriorityIcon'),
};
