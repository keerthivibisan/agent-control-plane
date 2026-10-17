import {
  GitBranch,
  KeyRound,
  RotateCcw,
  SlidersHorizontal,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { IconProps } from '../../components/icons';

/*
 * Icons of the review loop's screens, in the style of components/icons.tsx (lucide, 1.75px
 * strokes, decorative): each sits next to a word or inside a labelled control.
 */
function icon(Lucide: LucideIcon, name: string) {
  function ReviewLoopIcon({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
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
  ReviewLoopIcon.displayName = name;
  return ReviewLoopIcon;
}

export const BranchIcon = icon(GitBranch, 'BranchIcon');
export const ApprovalsIcon = icon(KeyRound, 'ApprovalsIcon');
export const ReworkIcon = icon(RotateCcw, 'ReworkIcon');
export const OptionsIcon = icon(SlidersHorizontal, 'OptionsIcon');
export const CommandIcon = icon(SquareTerminal, 'CommandIcon');
export const RemoveCommandIcon = icon(X, 'RemoveCommandIcon');
